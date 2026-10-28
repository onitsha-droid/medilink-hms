'use strict';

process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_key';
process.env.STELLAR_NETWORK = 'TESTNET';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.HOSPITAL_STELLAR_SECRET = 'SD5RQO5SI4GXPSU5NGM5F526BE22BYKPKDVEKWBH2GAG63HPCJ5UJVMS';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Invoice } = require('../src/models/Invoice');
const { QueueEntry } = require('../src/models/QueueEntry');
const { DrugInventory } = require('../src/models/DrugInventory');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeAdmin() {
  return createUserAndToken({ role: 'Admin', email: `admin${uid()}@t.com` });
}
async function makeRegUser() {
  return createUserAndToken({ role: 'Front Desk', email: `fd${uid()}@t.com` });
}

describe('GET /admin/dashboard', () => {
  it('Admin gets a valid dashboard response', async () => {
    const { token } = await makeAdmin();

    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('patientsToday');
    expect(res.body).toHaveProperty('queue');
    expect(res.body).toHaveProperty('revenue');
    expect(res.body).toHaveProperty('claims');
    expect(res.body).toHaveProperty('lowStock');
    expect(typeof res.body.patientsToday).toBe('number');
    expect(Array.isArray(res.body.queue)).toBe(true);
    expect(Array.isArray(res.body.lowStock)).toBe(true);
  });

  it('returns 403 for non-Admin role', async () => {
    const { token } = await createUserAndToken({ role: 'Nurse', email: `nurse${uid()}@t.com` });
    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('counts patients registered today', async () => {
    const { token } = await makeAdmin();
    const { user: regUser } = await makeRegUser();

    await Patient.create({
      firstName: 'Test', lastName: 'Patient', dateOfBirth: '2000-01-01',
      gender: 'male', phone: `+234${uid()}`, registeredBy: regUser._id,
    });

    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.patientsToday).toBeGreaterThanOrEqual(1);
  });

  it('includes low stock drugs in dashboard', async () => {
    const { token } = await makeAdmin();

    await DrugInventory.create({
      drugName: 'Metronidazole',
      formulation: '400mg tablet',
      quantityOnHand: 2,
      lowStockThreshold: 10,
      unitPriceKobo: 500,
    });

    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.lowStock.length).toBeGreaterThanOrEqual(1);
    expect(res.body.lowStock[0]).toHaveProperty('drugName');
  });

  it('revenue totals include paid invoices', async () => {
    const { token } = await makeAdmin();
    const { user: regUser } = await makeRegUser();

    const patient = await Patient.create({
      firstName: 'Pay', lastName: 'Test', dateOfBirth: '1990-01-01',
      gender: 'female', phone: `+234${uid()}`, registeredBy: regUser._id,
    });

    await Invoice.create({
      patient: patient._id,
      lineItems: [{ description: 'Consultation', amountKobo: 500000 }],
      issuedBy: regUser._id,
      status: 'paid',
      paymentMethod: 'fiat',
      paidAt: new Date(),
    });

    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.revenue.fiat.totalKobo).toBeGreaterThanOrEqual(500000);
  });
});

describe('GET /admin/revenue', () => {
  it('returns revenue breakdown by payment method', async () => {
    const { token } = await makeAdmin();

    const res = await request(app)
      .get('/admin/revenue')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revenue');
    expect(Array.isArray(res.body.revenue)).toBe(true);
  });

  it('accepts from/to date filters', async () => {
    const { token } = await makeAdmin();
    const from = new Date(Date.now() - 86400000).toISOString();
    const to   = new Date().toISOString();

    const res = await request(app)
      .get(`/admin/revenue?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /admin/queue-metrics', () => {
  it('returns queue metrics per clinic', async () => {
    const { token } = await makeAdmin();
    const { user: regUser } = await makeRegUser();

    const patient = await Patient.create({
      firstName: 'Q', lastName: 'Patient', dateOfBirth: '1990-01-01',
      gender: 'male', phone: `+234${uid()}`, registeredBy: regUser._id,
    });
    const clinic = await Clinic.create({ name: `QClinic ${uid()}`, avgConsultationMinutes: 15 });

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    await QueueEntry.create({
      clinic: clinic._id, patient: patient._id,
      queueDate: today, position: 1, status: 'waiting',
      checkedInBy: regUser._id,
    });

    const res = await request(app)
      .get('/admin/queue-metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.metrics)).toBe(true);
    expect(res.body.metrics.length).toBeGreaterThanOrEqual(1);
  });
});
