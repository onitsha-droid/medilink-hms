'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Prescription } = require('../src/models/Prescription');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

const VALID_DRUG = {
  drugName: 'Amoxicillin',
  dose: '500mg capsule',
  frequency: 'three times daily',
  duration: '7 days',
  quantity: 21,
  unitPriceKobo: 5000,
};

async function makeFixtures() {
  const id = uid();
  const { token: doctorToken, user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { token: pharmacistToken } = await createUserAndToken({
    role: 'Pharmacist', email: `ph${id}@t.com`,
  });
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Rx Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Ngozi', lastName: 'Dike', dateOfBirth: '1992-03-20',
    gender: 'female', phone: `+2347${id}`, registeredBy: regUser._id,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });

  return { doctorToken, doctorUser, pharmacistToken, patientToken, clinic, patient, encounter };
}

// ── POST /prescriptions ────────────────────────────────────────────────────────
describe('POST /prescriptions', () => {
  it('Doctor creates a valid prescription', async () => {
    const { doctorToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ encounterId: encounter._id, drugs: [VALID_DRUG] });

    expect(res.status).toBe(201);
    expect(res.body.prescription.status).toBe('sent');
    expect(res.body.prescription.drugs).toHaveLength(1);
    expect(res.body.prescription.drugs[0].drugName).toBe('Amoxicillin');
  });

  it('Rejects prescription with invalid frequency', async () => {
    const { doctorToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        encounterId: encounter._id,
        drugs: [{ ...VALID_DRUG, frequency: 'whenever I feel like it' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/frequency/i);
  });

  it('Rejects prescription with empty drugs array', async () => {
    const { doctorToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ encounterId: encounter._id, drugs: [] });

    expect(res.status).toBe(400);
  });

  it('Rejects drug with missing required field (dose)', async () => {
    const { doctorToken, encounter } = await makeFixtures();
    const { dose: _removed, ...drugNoDose } = VALID_DRUG;

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ encounterId: encounter._id, drugs: [drugNoDose] });

    expect(res.status).toBe(400);
  });

  it('Pharmacist cannot create prescription (403)', async () => {
    const { pharmacistToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ encounterId: encounter._id, drugs: [VALID_DRUG] });

    expect(res.status).toBe(403);
  });

  it('Doctor cannot prescribe for another doctor encounter (403)', async () => {
    const { encounter } = await makeFixtures();
    const { token: otherDoc } = await createUserAndToken({
      role: 'Doctor', email: `otherdoc${uid()}@t.com`,
    });

    const res = await request(app)
      .post('/prescriptions')
      .set('Authorization', `Bearer ${otherDoc}`)
      .send({ encounterId: encounter._id, drugs: [VALID_DRUG] });

    expect(res.status).toBe(403);
  });
});

// ── GET /prescriptions/inbox ───────────────────────────────────────────────────
describe('GET /prescriptions/inbox', () => {
  it('Pharmacist sees only sent prescriptions', async () => {
    const { doctorUser, pharmacistToken, patient, encounter } = await makeFixtures();

    await Prescription.create({
      encounter: encounter._id, patient: patient._id,
      prescribedBy: doctorUser._id, drugs: [VALID_DRUG], status: 'sent',
    });
    await Prescription.create({
      encounter: encounter._id, patient: patient._id,
      prescribedBy: doctorUser._id, drugs: [VALID_DRUG], status: 'dispensed',
    });

    const res = await request(app)
      .get('/prescriptions/inbox')
      .set('Authorization', `Bearer ${pharmacistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.prescriptions).toHaveLength(1);
    expect(res.body.prescriptions[0].status).toBe('sent');
  });

  it('Patient cannot access pharmacist inbox (403)', async () => {
    const { patientToken } = await makeFixtures();

    const res = await request(app)
      .get('/prescriptions/inbox')
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /prescriptions/by-encounter/:id ───────────────────────────────────────
describe('GET /prescriptions/by-encounter/:encounterId', () => {
  it('Returns prescriptions for an encounter', async () => {
    const { doctorToken, doctorUser, patient, encounter } = await makeFixtures();

    await Prescription.create({
      encounter: encounter._id, patient: patient._id,
      prescribedBy: doctorUser._id, drugs: [VALID_DRUG], status: 'sent',
    });

    const res = await request(app)
      .get(`/prescriptions/by-encounter/${encounter._id}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.prescriptions).toHaveLength(1);
  });
});
