'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');

setupTestDB();

const app = createApp();

// ── Unique counter for test fixtures ──────────────────────────────────────────
let counter = 0;
function nextId() {
  return String(++counter).padStart(6, '0');
}

async function makeFixtures() {
  const id = nextId();
  const { token: adminToken, user: adminUser } =
    await createUserAndToken({ role: 'Admin', email: `admin${id}@t.com` });
  const { token: frontDeskToken } =
    await createUserAndToken({ role: 'Front Desk', email: `fd${id}@t.com` });
  const { token: patientToken } =
    await createUserAndToken({ role: 'Patient', email: `pt${id}@t.com` });
  const { token: nurseToken } =
    await createUserAndToken({ role: 'Nurse', email: `nr${id}@t.com` });

  const clinic = await Clinic.create({
    name: `OPD-${id}`,
    avgConsultationMinutes: 10,
  });

  const patient = await Patient.create({
    firstName: 'Test',
    lastName: 'Patient',
    dateOfBirth: '1985-01-01',
    gender: 'male',
    phone: `+2348${id}`,
    registeredBy: adminUser._id,
  });

  return { adminToken, frontDeskToken, patientToken, nurseToken, clinic, patient };
}

function tomorrow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Clinic endpoints ──────────────────────────────────────────────────────────
describe('POST /clinics', () => {
  it('Admin can create a clinic', async () => {
    const { adminToken } = await makeFixtures();
    const res = await request(app)
      .post('/clinics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Cardiology-${Date.now()}`, avgConsultationMinutes: 20 });
    expect(res.status).toBe(201);
  });

  it('Front Desk cannot create a clinic (403)', async () => {
    const { frontDeskToken } = await makeFixtures();
    const res = await request(app)
      .post('/clinics')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({ name: `Denied-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it('returns 409 for duplicate clinic name', async () => {
    const { adminToken, clinic } = await makeFixtures();
    const res = await request(app)
      .post('/clinics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: clinic.name });
    expect(res.status).toBe(409);
  });
});

describe('GET /clinics', () => {
  it('any authenticated user can list clinics', async () => {
    const { patientToken } = await makeFixtures();
    const res = await request(app)
      .get('/clinics')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clinics)).toBe(true);
  });
});

// ── Appointment endpoints ─────────────────────────────────────────────────────
describe('POST /appointments', () => {
  it('Front Desk can create a walk-in appointment', async () => {
    const { frontDeskToken, patient, clinic } = await makeFixtures();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({
        patientId: patient._id.toString(),
        clinicId: clinic._id.toString(),
        scheduledDate: tomorrow(),
      });
    expect(res.status).toBe(201);
    expect(res.body.appointment.type).toBe('walk_in');
  });

  it('Patient can book an online appointment', async () => {
    const { patientToken, patient, clinic } = await makeFixtures();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        patientId: patient._id.toString(),
        clinicId: clinic._id.toString(),
        scheduledDate: tomorrow(),
      });
    expect(res.status).toBe(201);
    expect(res.body.appointment.type).toBe('online');
  });

  it('prevents double-booking same patient/clinic/date', async () => {
    const { frontDeskToken, patient, clinic } = await makeFixtures();
    const date = tomorrow();

    const r1 = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({
        patientId: patient._id.toString(),
        clinicId: clinic._id.toString(),
        scheduledDate: date,
      });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({
        patientId: patient._id.toString(),
        clinicId: clinic._id.toString(),
        scheduledDate: date,
      });
    expect(r2.status).toBe(409);
  });

  it('Nurse cannot create an appointment (403)', async () => {
    const { nurseToken, patient, clinic } = await makeFixtures();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({
        patientId: patient._id.toString(),
        clinicId: clinic._id.toString(),
        scheduledDate: tomorrow(),
      });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown patient', async () => {
    const { frontDeskToken, clinic } = await makeFixtures();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({
        patientId: '64b1234567890abcde123456',
        clinicId: clinic._id.toString(),
        scheduledDate: tomorrow(),
      });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing fields', async () => {
    const { frontDeskToken, patient } = await makeFixtures();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${frontDeskToken}`)
      .send({ patientId: patient._id.toString() });
    expect(res.status).toBe(400);
  });
});
