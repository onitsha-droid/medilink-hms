'use strict';

/**
 * Tests for HMO claims backend routes.
 *
 * The Soroban contract call is mocked via jest.mock — no real network access.
 * One integration path tests the manual-review fallback when the contract throws.
 */

process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_key';
process.env.STELLAR_NETWORK = 'TESTNET';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.HOSPITAL_STELLAR_SECRET = 'SD5RQO5SI4GXPSU5NGM5F526BE22BYKPKDVEKWBH2GAG63HPCJ5UJVMS';
process.env.HMO_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

// Mock hmoService so no real Soroban calls are made
jest.mock('../src/services/hmoService', () => ({
  submitHmoClaim: jest.fn(),
  REASON_TEXT: {
    0:    'Approved',
    1001: 'Policy not found',
    1002: 'Service code not covered by this policy',
    1003: 'Claim amount exceeds policy limit',
    1004: 'Duplicate claim reference',
    1005: 'Policy is inactive',
  },
}));

const { submitHmoClaim } = require('../src/services/hmoService');
const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Invoice } = require('../src/models/Invoice');
const { HmoClaim } = require('../src/models/HmoClaim');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

// Reset mock call counts between every test
beforeEach(() => jest.clearAllMocks());

async function makeFixtures({ hmoMemberNumber = 'HMO-TEST-001', invoiceStatus = 'pending' } = {}) {
  const id = uid();
  const { token: billingToken, user: billingUser } = await createUserAndToken({
    role: 'Billing Officer', email: `billing${id}@t.com`,
  });
  const { token: adminToken } = await createUserAndToken({
    role: 'Admin', email: `admin${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });
  const { user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `HMO Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Uche', lastName: 'Nwosu', dateOfBirth: '1985-03-15',
    gender: 'male', phone: `+2348${id}`, registeredBy: regUser._id,
    hmo: hmoMemberNumber
      ? { provider: 'Hygeia HMO', memberNumber: hmoMemberNumber }
      : undefined,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });
  const invoice = await Invoice.create({
    patient: patient._id,
    encounter: encounter._id,
    lineItems: [{ description: 'Consultation', amountKobo: 300000, itemType: 'consultation' }],
    issuedBy: billingUser._id,
    status: invoiceStatus,
  });

  return { billingToken, adminToken, billingUser, patient, encounter, invoice };
}

// ── Approved path ─────────────────────────────────────────────────────────────

describe('POST /hmo-claims — approved', () => {
  beforeEach(() => {
    submitHmoClaim.mockResolvedValue({
      status: 'approved',
      payoutAmountKobo: 300000,
      reasonCode: 0,
      reasonText: 'Approved',
      txHash: 'mock_tx_approved',
    });
  });

  it('creates an approved claim and marks invoice paid', async () => {
    const { billingToken, invoice } = await makeFixtures();

    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    expect(res.status).toBe(201);
    expect(res.body.claim.status).toBe('approved');
    expect(res.body.claim.payoutAmountKobo).toBe(300000);
    expect(res.body.claim.stellarTxHash).toBe('mock_tx_approved');

    const updatedInvoice = await Invoice.findById(invoice._id);
    expect(updatedInvoice.status).toBe('paid');
  });

  it('returns 401 for unauthenticated request', async () => {
    const { invoice } = await makeFixtures();
    const res = await request(app)
      .post('/hmo-claims')
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-Billing Officer role', async () => {
    const { invoice } = await makeFixtures();
    const { token: docToken } = await createUserAndToken({
      role: 'Doctor', email: `doc2${uid()}@t.com`,
    });
    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${docToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });
    expect(res.status).toBe(403);
  });
});

// ── Rejected paths ────────────────────────────────────────────────────────────

describe('POST /hmo-claims — rejected', () => {
  it('creates a rejected claim for uncovered service (code 1002)', async () => {
    submitHmoClaim.mockResolvedValue({
      status: 'rejected',
      payoutAmountKobo: 0,
      reasonCode: 1002,
      reasonText: 'Service code not covered by this policy',
      txHash: 'mock_tx_rejected',
    });

    const { billingToken, invoice } = await makeFixtures();
    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 9999 });

    expect(res.status).toBe(201);
    expect(res.body.claim.status).toBe('rejected');
    expect(res.body.claim.reasonCode).toBe(1002);

    // Invoice must NOT be marked paid on rejection
    const inv = await Invoice.findById(invoice._id);
    expect(inv.status).toBe('pending');
  });

  it('routes over-limit rejection (code 1003) to manual_review', async () => {
    submitHmoClaim.mockResolvedValue({
      status: 'rejected',
      payoutAmountKobo: 0,
      reasonCode: 1003,
      reasonText: 'Claim amount exceeds policy limit',
      txHash: 'mock_tx_overlimit',
    });

    const { billingToken, invoice } = await makeFixtures();
    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    expect(res.status).toBe(201);
    expect(res.body.claim.status).toBe('manual_review');
  });
});

// ── Soroban unreachable → manual_review ──────────────────────────────────────

describe('POST /hmo-claims — Soroban unreachable', () => {
  it('routes to manual_review and returns 202 when contract throws', async () => {
    submitHmoClaim.mockRejectedValue(new Error('Soroban RPC timeout'));

    const { billingToken, invoice } = await makeFixtures();
    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    expect(res.status).toBe(202);
    expect(res.body.manualReview).toBe(true);
    expect(res.body.claim.status).toBe('manual_review');
  });
});

// ── No HMO record ─────────────────────────────────────────────────────────────

describe('POST /hmo-claims — no HMO record', () => {
  it('returns 400 when patient has no HMO member number', async () => {
    submitHmoClaim.mockResolvedValue({ status: 'approved', payoutAmountKobo: 0, reasonCode: 0, reasonText: '', txHash: '' });

    const { billingToken, invoice } = await makeFixtures({ hmoMemberNumber: '' });
    const res = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HMO member number/i);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('POST /hmo-claims — idempotency', () => {
  it('returns existing claim without calling contract a second time', async () => {
    submitHmoClaim.mockResolvedValue({
      status: 'approved',
      payoutAmountKobo: 300000,
      reasonCode: 0,
      reasonText: 'Approved',
      txHash: 'mock_tx_idem',
    });

    const { billingToken, invoice } = await makeFixtures();

    await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    const res2 = await request(app)
      .post('/hmo-claims')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ invoiceId: invoice._id.toString(), serviceCode: 1001 });

    expect(res2.status).toBe(200);
    expect(res2.body.alreadySubmitted).toBe(true);
    // submitHmoClaim should have been called exactly once across both requests
    expect(submitHmoClaim).toHaveBeenCalledTimes(1);
  });
});

// ── Manual review resolve ─────────────────────────────────────────────────────

describe('PATCH /hmo-claims/:id/resolve', () => {
  it('Billing Officer approves a manual_review claim and marks invoice paid', async () => {
    const { billingToken, invoice, billingUser } = await makeFixtures();

    const claim = await HmoClaim.create({
      invoice: invoice._id,
      policyId: 'HMO-TEST-001',
      serviceCode: 1001,
      requestedAmountKobo: 300000,
      status: 'manual_review',
      reasonText: 'Requires review',
      submittedBy: billingUser._id,
    });

    const res = await request(app)
      .patch(`/hmo-claims/${claim._id}/resolve`)
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ resolution: 'approved', note: 'Manager approved manually' });

    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('approved');

    const inv = await Invoice.findById(invoice._id);
    expect(inv.status).toBe('paid');
  });

  it('returns 400 when trying to resolve a non-manual_review claim', async () => {
    const { billingToken, invoice, billingUser } = await makeFixtures();

    const claim = await HmoClaim.create({
      invoice: invoice._id,
      policyId: 'HMO-TEST-002',
      serviceCode: 1001,
      requestedAmountKobo: 300000,
      status: 'approved',
      submittedBy: billingUser._id,
    });

    const res = await request(app)
      .patch(`/hmo-claims/${claim._id}/resolve`)
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ resolution: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/manual_review/i);
  });
});

// ── GET /hmo-claims list + filter ─────────────────────────────────────────────

describe('GET /hmo-claims', () => {
  it('Billing Officer lists claims filtered by status', async () => {
    const { billingToken, invoice, billingUser } = await makeFixtures();

    await HmoClaim.insertMany([
      { invoice: invoice._id, policyId: 'P1', serviceCode: 1001,
        requestedAmountKobo: 100, status: 'approved', submittedBy: billingUser._id },
      { invoice: invoice._id, policyId: 'P1', serviceCode: 1002,
        requestedAmountKobo: 100, status: 'rejected', submittedBy: billingUser._id },
    ]);

    const res = await request(app)
      .get('/hmo-claims?status=approved')
      .set('Authorization', `Bearer ${billingToken}`);

    expect(res.status).toBe(200);
    expect(res.body.claims.every((c) => c.status === 'approved')).toBe(true);
  });

  it('returns 403 for non-billing roles', async () => {
    const { token: patientToken } = await createUserAndToken({
      role: 'Patient', email: `pt${uid()}@t.com`,
    });
    const res = await request(app)
      .get('/hmo-claims')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });
});
