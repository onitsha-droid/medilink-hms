'use strict';

// Set required env vars before any module that calls validateEnv is loaded.
process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret_for_jest';

const crypto = require('crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Invoice } = require('../src/models/Invoice');
const { Payment } = require('../src/models/Payment');
const { LabRequest } = require('../src/models/LabRequest');

setupTestDB();
const app = createApp();

// TEST_SECRET must match PAYSTACK_SECRET_KEY set above
const TEST_SECRET = 'test_paystack_secret_for_jest';

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

function makeWebhookBody(overrides = {}) {
  return {
    event: 'charge.success',
    data: {
      id: `evt_${uid()}`,
      reference: `ML-ref-${uid()}`,
      amount: 200000,
      ...overrides,
    },
  };
}

function signPayload(body) {
  return crypto
    .createHmac('sha512', TEST_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

async function makeFixtures() {
  const id = uid();
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Pay Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Kelechi', lastName: 'Eze', dateOfBirth: '1990-01-01',
    gender: 'male', phone: `+2341${id}`, registeredBy: regUser._id,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });
  const invoice = await Invoice.create({
    patient: patient._id, encounter: encounter._id,
    lineItems: [{ description: 'Consultation', amountKobo: 200000 }],
    issuedBy: doctorUser._id,
    status: 'pending',
  });

  return { patientToken, patient, encounter, invoice, doctorUser };
}

// ── Webhook: signature rejection ──────────────────────────────────────────────
describe('POST /payments/webhook — signature', () => {
  it('Rejects webhook with wrong signature (400)', async () => {
    const body = makeWebhookBody();

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'bad_sig')
      .send(JSON.stringify(body));

    expect(res.status).toBe(400);
  });

  it('Accepts valid signature and returns 200', async () => {
    const { invoice } = await makeFixtures();
    const ref = `ML-ref-${uid()}`;

    // Pre-set the reference on the invoice so the webhook can find it
    invoice.paystackReference = ref;
    await invoice.save();

    const body = makeWebhookBody({ reference: ref, id: `evt_${uid()}` });
    const sig = signPayload(body);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(JSON.stringify(body));

    expect(res.status).toBe(200);
  });
});

// ── Webhook: payment success flow ─────────────────────────────────────────────
describe('POST /payments/webhook — charge.success', () => {
  it('Marks invoice as paid and creates a Payment record', async () => {
    const { invoice } = await makeFixtures();
    const ref = `ML-ref-${uid()}`;
    const evtId = `evt_${uid()}`;

    invoice.paystackReference = ref;
    await invoice.save();

    const body = makeWebhookBody({ reference: ref, id: evtId, amount: 200000 });
    const sig = signPayload(body);

    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(JSON.stringify(body));

    // Poll briefly for the async transaction
    await new Promise((r) => setTimeout(r, 200));

    const updatedInvoice = await Invoice.findById(invoice._id);
    expect(updatedInvoice.status).toBe('paid');
    expect(updatedInvoice.paidAt).toBeDefined();
    expect(updatedInvoice.lastWebhookEventId).toBe(evtId);

    const payment = await Payment.findOne({ reference: ref });
    expect(payment).not.toBeNull();
    expect(payment.amountKobo).toBe(200000);
  });

  it('Unlocks related LabRequests from requested → paid', async () => {
    const { invoice, patient, encounter, doctorUser } = await makeFixtures();
    const ref = `ML-ref-${uid()}`;
    const evtId = `evt_${uid()}`;

    invoice.paystackReference = ref;
    await invoice.save();

    const lr = await LabRequest.create({
      encounter: encounter._id, patient: patient._id,
      requestedBy: doctorUser._id,
      tests: [{ name: 'FBC' }],
      status: 'requested',
      invoice: invoice._id,
    });

    const body = makeWebhookBody({ reference: ref, id: evtId });
    const sig = signPayload(body);

    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(JSON.stringify(body));

    await new Promise((r) => setTimeout(r, 200));

    const updatedLR = await LabRequest.findById(lr._id);
    expect(updatedLR.status).toBe('paid');
  });
});

// ── Webhook: idempotency ──────────────────────────────────────────────────────
describe('POST /payments/webhook — idempotency', () => {
  it('Duplicate event with same id is ignored (no double Payment)', async () => {
    const { invoice } = await makeFixtures();
    const ref = `ML-ref-${uid()}`;
    const evtId = `evt_same_${uid()}`;

    invoice.paystackReference = ref;
    await invoice.save();

    const body = makeWebhookBody({ reference: ref, id: evtId });
    const sig = signPayload(body);

    // Send same event twice
    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(JSON.stringify(body));

    await new Promise((r) => setTimeout(r, 200));

    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(JSON.stringify(body));

    await new Promise((r) => setTimeout(r, 200));

    const payments = await Payment.find({ reference: ref });
    expect(payments.length).toBe(1); // only one Payment created
  });
});
