'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { ClinicalNote } = require('../src/models/ClinicalNote');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeFixtures() {
  const id = uid();
  const { token: doctorToken, user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { token: doctor2Token, user: doctor2User } = await createUserAndToken({
    role: 'Doctor', email: `doc2${id}@t.com`,
  });
  const { token: nurseToken, user: nurseUser } = await createUserAndToken({
    role: 'Nurse', email: `nurse${id}@t.com`,
  });
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { token: adminToken } = await createUserAndToken({
    role: 'Admin', email: `admin${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Clinic-${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Ada', lastName: 'Obi', dateOfBirth: '1990-01-01',
    gender: 'female', phone: `+2348${id}`, registeredBy: regUser._id,
  });

  return {
    doctorToken, doctorUser,
    doctor2Token, doctor2User,
    nurseToken, nurseUser,
    patientToken, adminToken,
    clinic, patient,
  };
}

describe('POST /encounters', () => {
  it('Doctor can open an encounter', async () => {
    const { doctorToken, clinic, patient } = await makeFixtures();

    const res = await request(app)
      .post('/encounters')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: patient._id, clinicId: clinic._id, chiefComplaint: 'Headache' });

    expect(res.status).toBe(201);
    expect(res.body.encounter.status).toBe('open');
    expect(res.body.encounter.chiefComplaint).toBe('Headache');
  });

  it('Nurse cannot open an encounter (403)', async () => {
    const { nurseToken, clinic, patient } = await makeFixtures();

    const res = await request(app)
      .post('/encounters')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ patientId: patient._id, clinicId: clinic._id });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown patient', async () => {
    const { doctorToken, clinic } = await makeFixtures();

    const res = await request(app)
      .post('/encounters')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: '64b1234567890abcde123456', clinicId: clinic._id });

    expect(res.status).toBe(404);
  });
});

describe('GET /encounters/my-queue', () => {
  it("Returns only the doctor's own open encounters", async () => {
    const { doctorToken, doctorUser, doctor2User, clinic, patient } = await makeFixtures();

    await Encounter.create([
      { patient: patient._id, doctor: doctorUser._id, clinic: clinic._id, status: 'open' },
      { patient: patient._id, doctor: doctor2User._id, clinic: clinic._id, status: 'open' },
    ]);

    const res = await request(app)
      .get('/encounters/my-queue')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.encounters).toHaveLength(1);
  });
});

describe('GET /encounters/patient/:patientId/history', () => {
  it('Doctor can retrieve full patient history', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();

    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
    });
    await ClinicalNote.create({
      encounter: enc._id, patient: patient._id, author: doctorUser._id,
      subjective: 'Patient reports fever',
    });

    const res = await request(app)
      .get(`/encounters/patient/${patient._id}/history`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.encounters).toHaveLength(1);
    expect(res.body.notes).toHaveLength(1);
  });

  it('Admin can read patient history', async () => {
    const { adminToken, doctorUser, clinic, patient } = await makeFixtures();
    await Encounter.create({ patient: patient._id, doctor: doctorUser._id, clinic: clinic._id });

    const res = await request(app)
      .get(`/encounters/patient/${patient._id}/history`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('Pharmacist is denied (403)', async () => {
    const { patient } = await makeFixtures();
    const { token } = await createUserAndToken({
      role: 'Pharmacist', email: `ph-${uid()}@t.com`,
    });

    const res = await request(app)
      .get(`/encounters/patient/${patient._id}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /encounters/:encounterId/notes', () => {
  it('Treating doctor can add a clinical note', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
    });

    const res = await request(app)
      .post(`/encounters/${enc._id}/notes`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        subjective: 'Complains of fever',
        assessment: 'Likely viral',
        plan: 'Rest and fluids',
        diagnosis: { code: 'J06.9', description: 'Upper respiratory infection' },
      });

    expect(res.status).toBe(201);
    expect(res.body.note.subjective).toBe('Complains of fever');
  });

  it('Different doctor cannot add notes (403)', async () => {
    const { doctor2Token, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
    });

    const res = await request(app)
      .post(`/encounters/${enc._id}/notes`)
      .set('Authorization', `Bearer ${doctor2Token}`)
      .send({ subjective: 'Sneaky note' });

    expect(res.status).toBe(403);
  });

  it('Cannot add notes to a completed encounter (400)', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
      status: 'completed', completedAt: new Date(),
    });

    const res = await request(app)
      .post(`/encounters/${enc._id}/notes`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ subjective: 'Late note' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /encounters/:encounterId/diagnosis', () => {
  it('Treating doctor can set primary diagnosis', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
    });

    const res = await request(app)
      .patch(`/encounters/${enc._id}/diagnosis`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ primaryDiagnosis: { code: 'A09', description: 'Gastroenteritis' } });

    expect(res.status).toBe(200);
    expect(res.body.encounter.primaryDiagnosis.code).toBe('A09');
  });
});

describe('PATCH /encounters/:encounterId/complete', () => {
  it('Treating doctor can complete encounter', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
    });

    const res = await request(app)
      .patch(`/encounters/${enc._id}/complete`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.encounter.status).toBe('completed');
  });

  it('Cannot complete an already-completed encounter (400)', async () => {
    const { doctorToken, doctorUser, clinic, patient } = await makeFixtures();
    const enc = await Encounter.create({
      patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
      status: 'completed', completedAt: new Date(),
    });

    const res = await request(app)
      .patch(`/encounters/${enc._id}/complete`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(400);
  });
});
