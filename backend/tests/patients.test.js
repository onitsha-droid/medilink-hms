'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');

setupTestDB();

const app = createApp();

// ── Shared token fixtures ─────────────────────────────────────────────────────
let frontDeskToken, adminToken, patientToken, nurseToken;

beforeEach(async () => {
  ({ token: frontDeskToken } = await createUserAndToken({ role: 'Front Desk' }));
  ({ token: adminToken } = await createUserAndToken({ role: 'Admin' }));
  ({ token: patientToken } = await createUserAndToken({ role: 'Patient' }));
  ({ token: nurseToken } = await createUserAndToken({ role: 'Nurse' }));
});

const validPayload = {
  firstName: 'Amara',
  lastName: 'Obi',
  dateOfBirth: '1990-05-15',
  gender: 'female',
  phone: '+2348012345678',
  email: 'amara.obi@example.com',
};

// ── POST /patients ─────────────────────────────────────────────────────────────
describe('POST /patients', () => {
  it('Front Desk can create a patient and receives a hospitalId', async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.patient.hospitalId).toMatch(/^ML-[A-F0-9]{8}$/);
    expect(res.body.patient.firstName).toBe('Amara');
    expect(res.body.patient.qrPayload).toBeDefined();

    // QR payload must only contain hospitalId — no PHI
    const qr = JSON.parse(res.body.patient.qrPayload);
    expect(Object.keys(qr)).toEqual(['hospitalId']);
  });

  it('Admin can create a patient', async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, email: 'admin-created@example.com' });
    expect(res.status).toBe(201);
  });

  it('Patient role is denied (403)', async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${patientToken}`)
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({ firstName: 'Only' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid gender', async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({ ...validPayload, gender: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('hospitalId is unique across two registrations', async () => {
    const r1 = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send(validPayload);

    const r2 = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({ ...validPayload, email: 'different@example.com', phone: '+2348099999999' });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.patient.hospitalId).not.toBe(r2.body.patient.hospitalId);
  });
});

// ── GET /patients/by-hospital-id/:id ─────────────────────────────────────────
describe('GET /patients/by-hospital-id/:id', () => {
  let hospitalId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/patients')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send(validPayload);
    hospitalId = res.body.patient.hospitalId;
  });

  it('Front Desk can look up a patient by hospitalId', async () => {
    const res = await request(app)
      .get(`/patients/by-hospital-id/${hospitalId}`)
      .set('Authorization', `Bearer ${frontDeskToken}`);
    expect(res.status).toBe(200);
    expect(res.body.patient.hospitalId).toBe(hospitalId);
  });

  it('Nurse can look up a patient', async () => {
    const res = await request(app)
      .get(`/patients/by-hospital-id/${hospitalId}`)
      .set('Authorization', `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
  });

  it('Patient role is denied (403)', async () => {
    const res = await request(app)
      .get(`/patients/by-hospital-id/${hospitalId}`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown hospitalId', async () => {
    const res = await request(app)
      .get('/patients/by-hospital-id/ML-FFFFFFFF')
      .set('Authorization', `Bearer ${frontDeskToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed hospitalId', async () => {
    const res = await request(app)
      .get('/patients/by-hospital-id/NOT-VALID')
      .set('Authorization', `Bearer ${frontDeskToken}`);
    expect(res.status).toBe(400);
  });
});
