'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Invoice } = require('../src/models/Invoice');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeFixtures() {
  const id = uid();
  const { token: billingToken, user: billingUser } = await createUserAndToken({
    role: 'Billing Officer', email: `billing${id}@t.com`,
  });
  const { token: adminToken } = await createUserAndToken({
    role: 'Admin', email: `admin${id}@t.com`,
  });
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Billing Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Blessing', lastName: 'Uzo', dateOfBirth: '1995-07-12',
    gender: 'female', phone: `+2345${id}`, registeredBy: regUser._id,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });

  return { billingToken, billingUser, adminToken, patientToken, doctorUser, patient, encounter };
}

// ── Invoice total computation ──────────────────────────────────────────────────
describe('Invoice total computation', () => {
  it('totalKobo is sum of lineItems', async () => {
    const { patient, encounter, billingUser } = await makeFixtures();

    const invoice = new Invoice({
      patient: patient._id,
      encounter: encounter._id,
      lineItems: [
        { description: 'Consultation', amountKobo: 200000 },
        { description: 'FBC', amountKobo: 150000 },
      ],
      issuedBy: billingUser._id,
    });
    await invoice.save();

    expect(invoice.totalKobo).toBe(350000);
  });

  it('Adjustment updates total correctly', async () => {
    const { patient, encounter, billingUser } = await makeFixtures();

    const invoice = new Invoice({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 200000 }],
      issuedBy: billingUser._id,
    });
    await invoice.save();

    invoice.adjustments.push({
      adjustedBy: billingUser._id, deltaKobo: -20000, reason: 'HMO discount',
    });
    await invoice.save();

    expect(invoice.totalKobo).toBe(180000);
  });

  it('Total cannot go below zero (clamped)', async () => {
    const { patient, encounter, billingUser } = await makeFixtures();

    const invoice = new Invoice({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 100 }],
      issuedBy: billingUser._id,
    });
    await invoice.save();

    invoice.adjustments.push({
      adjustedBy: billingUser._id, deltaKobo: -99999, reason: 'huge discount',
    });
    await invoice.save();

    expect(invoice.totalKobo).toBe(0);
  });
});

// ── Status transitions ─────────────────────────────────────────────────────────
describe('Invoice status transitions', () => {
  it('Can cancel a pending invoice', async () => {
    const { billingToken, patient, encounter, billingUser } = await makeFixtures();

    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 200000 }],
      issuedBy: billingUser._id,
    });

    const res = await request(app)
      .post(`/invoices/${invoice._id}/cancel`)
      .set('Authorization', `Bearer ${billingToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('cancelled');
  });

  it('Cannot cancel an already-paid invoice', async () => {
    const { billingToken, patient, encounter, billingUser } = await makeFixtures();

    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 200000 }],
      issuedBy: billingUser._id, status: 'paid',
    });

    const res = await request(app)
      .post(`/invoices/${invoice._id}/cancel`)
      .set('Authorization', `Bearer ${billingToken}`);

    expect(res.status).toBe(400);
  });
});

// ── Billing Officer: list + adjust ────────────────────────────────────────────
describe('GET /invoices', () => {
  it('Billing Officer can list invoices with status filter', async () => {
    const { billingToken, patient, encounter, billingUser } = await makeFixtures();

    await Invoice.insertMany([
      { patient: patient._id, encounter: encounter._id,
        lineItems: [{ description: 'A', amountKobo: 100 }], issuedBy: billingUser._id, status: 'pending' },
      { patient: patient._id, encounter: encounter._id,
        lineItems: [{ description: 'B', amountKobo: 200 }], issuedBy: billingUser._id, status: 'paid' },
    ]);

    const res = await request(app)
      .get('/invoices?status=pending')
      .set('Authorization', `Bearer ${billingToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invoices.every((i) => i.status === 'pending')).toBe(true);
  });
});

describe('PATCH /invoices/:id/adjust', () => {
  it('Billing Officer can add an adjustment with a reason', async () => {
    const { billingToken, patient, encounter, billingUser } = await makeFixtures();

    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 500000 }],
      issuedBy: billingUser._id,
    });

    const res = await request(app)
      .patch(`/invoices/${invoice._id}/adjust`)
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ deltaKobo: -50000, reason: 'Staff discount' });

    expect(res.status).toBe(200);
    expect(res.body.invoice.totalKobo).toBe(450000);
    expect(res.body.invoice.adjustments[0].reason).toBe('Staff discount');
  });

  it('Requires a reason for adjustment', async () => {
    const { billingToken, patient, encounter, billingUser } = await makeFixtures();

    const invoice = await Invoice.create({
      patient: patient._id, encounter: encounter._id,
      lineItems: [{ description: 'Consultation', amountKobo: 500000 }],
      issuedBy: billingUser._id,
    });

    const res = await request(app)
      .patch(`/invoices/${invoice._id}/adjust`)
      .set('Authorization', `Bearer ${billingToken}`)
      .send({ deltaKobo: -50000, reason: '' });

    expect(res.status).toBe(400);
  });
});
