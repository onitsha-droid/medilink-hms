'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { QueueEntry } = require('../src/models/QueueEntry');
const { Vitals } = require('../src/models/Vitals');
const { toMidnightUTC } = require('../src/services/queueService');

setupTestDB();

const app = createApp();

let counter = 0;
function nextId() { return String(++counter).padStart(6, '0'); }

async function makeFixtures() {
  const id = nextId();
  const { token: nurseToken, user: nurseUser } =
    await createUserAndToken({ role: 'Nurse', email: `nurse${id}@t.com` });
  const { token: doctorToken } =
    await createUserAndToken({ role: 'Doctor', email: `doc${id}@t.com` });
  const { token: patientToken } =
    await createUserAndToken({ role: 'Patient', email: `pt${id}@t.com` });

  const { user: adminUser } = await createUserAndToken({
    role: 'Admin', email: `admin${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Triage-${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'T', lastName: 'P', dateOfBirth: '1990-01-01',
    gender: 'male', phone: `+2348${id}`, registeredBy: adminUser._id,
  });

  const queueEntry = await QueueEntry.create({
    clinic: clinic._id, patient: patient._id,
    queueDate: toMidnightUTC(), position: 1,
    checkedInBy: nurseUser._id, status: 'waiting',
  });

  return { nurseToken, nurseUser, doctorToken, patientToken, clinic, patient, queueEntry };
}

// ── POST /vitals/:queueEntryId ────────────────────────────────────────────────
describe('POST /vitals/:queueEntryId', () => {
  it('Nurse can record normal vitals', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ bpSystolic: 120, bpDiastolic: 80, spo2: 98, temperatureCelsius: 36.6, weightKg: 70 });

    expect(res.status).toBe(201);
    expect(res.body.vitals.isUrgent).toBe(false);
    expect(res.body.vitals.spo2).toBe(98);
  });

  it('auto-flags urgent when SpO2 is critically low', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ spo2: 85, bpSystolic: 120, bpDiastolic: 80 });

    expect(res.status).toBe(201);
    expect(res.body.vitals.isUrgent).toBe(true);
    expect(res.body.vitals.urgentReason).toMatch(/SpO2 critically low/i);
  });

  it('auto-flags urgent when systolic BP is critically high', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ bpSystolic: 190, bpDiastolic: 100, spo2: 97 });

    expect(res.status).toBe(201);
    expect(res.body.vitals.isUrgent).toBe(true);
    expect(res.body.vitals.urgentReason).toMatch(/Systolic BP critical/i);
  });

  it('manual urgent flag is respected', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ spo2: 97, isUrgent: true, urgentReason: 'Severe abdominal pain' });

    expect(res.status).toBe(201);
    expect(res.body.vitals.isUrgent).toBe(true);
    expect(res.body.vitals.urgentReason).toMatch(/Severe abdominal pain/i);
  });

  it('urgent vitals re-prioritize the queue entry', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ spo2: 85 });

    const updated = await QueueEntry.findById(queueEntry._id);
    expect(updated.isUrgent).toBe(true);
  });

  it('Doctor cannot record vitals (403)', async () => {
    const { doctorToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ spo2: 98 });

    expect(res.status).toBe(403);
  });

  it('returns 400 for out-of-range SpO2', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .post(`/vitals/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ spo2: 110 }); // > 100

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown queue entry', async () => {
    const { nurseToken } = await makeFixtures();

    const res = await request(app)
      .post('/vitals/64b1234567890abcde123456')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ spo2: 98 });

    expect(res.status).toBe(404);
  });
});

// ── GET /vitals/by-entry/:queueEntryId ────────────────────────────────────────
describe('GET /vitals/by-entry/:queueEntryId', () => {
  it('Nurse can retrieve recorded vitals', async () => {
    const { nurseToken, queueEntry, patient, nurseUser } = await makeFixtures();

    await Vitals.create({
      queueEntry: queueEntry._id,
      patient: patient._id,
      recordedBy: nurseUser._id,
      spo2: 97,
    });

    const res = await request(app)
      .get(`/vitals/by-entry/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.vitals.spo2).toBe(97);
  });

  it('returns 404 when no vitals recorded', async () => {
    const { nurseToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .get(`/vitals/by-entry/${queueEntry._id}`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(404);
  });

  it('Patient cannot access vitals (403)', async () => {
    const { patientToken, queueEntry } = await makeFixtures();

    const res = await request(app)
      .get(`/vitals/by-entry/${queueEntry._id}`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(403);
  });
});
