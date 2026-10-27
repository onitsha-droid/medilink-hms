'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { LabRequest } = require('../src/models/LabRequest');
const { flagAbnormal } = require('../src/routes/labRequests');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeFixtures() {
  const id = uid();
  const { token: doctorToken, user: doctorUser } = await createUserAndToken({
    role: 'Doctor', email: `doc${id}@t.com`,
  });
  const { token: labToken, user: labUser } = await createUserAndToken({
    role: 'Lab Scientist', email: `lab${id}@t.com`,
  });
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });

  const clinic = await Clinic.create({ name: `Lab Clinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Chidi', lastName: 'Eze', dateOfBirth: '1985-06-15',
    gender: 'male', phone: `+2349${id}`, registeredBy: regUser._id,
  });
  const encounter = await Encounter.create({
    patient: patient._id, doctor: doctorUser._id, clinic: clinic._id,
  });

  return { doctorToken, doctorUser, labToken, labUser, patientToken, clinic, patient, encounter };
}

// ── Unit tests: flagAbnormal ───────────────────────────────────────────────────
describe('flagAbnormal()', () => {
  it('within range → not abnormal', () => {
    expect(flagAbnormal(4.0, '3.5 - 5.0')).toEqual({ isAbnormal: false, flag: '' });
  });

  it('below low end → L', () => {
    expect(flagAbnormal(3.0, '3.5 - 5.0')).toEqual({ isAbnormal: true, flag: 'L' });
  });

  it('critically low (< 70% of lower bound) → LL', () => {
    expect(flagAbnormal(2.0, '3.5 - 5.0')).toEqual({ isAbnormal: true, flag: 'LL' });
  });

  it('above high end → H', () => {
    expect(flagAbnormal(6.0, '3.5 - 5.0')).toEqual({ isAbnormal: true, flag: 'H' });
  });

  it('critically high (> 130% of upper bound) → HH', () => {
    expect(flagAbnormal(7.0, '3.5 - 5.0')).toEqual({ isAbnormal: true, flag: 'HH' });
  });

  it('>N format: below threshold → L', () => {
    expect(flagAbnormal(55, '>60')).toEqual({ isAbnormal: true, flag: 'L' });
  });

  it('>N format: above threshold → not abnormal', () => {
    expect(flagAbnormal(75, '>60')).toEqual({ isAbnormal: false, flag: '' });
  });

  it('<N format: at or above threshold → H', () => {
    expect(flagAbnormal(200, '<200')).toEqual({ isAbnormal: true, flag: 'H' });
  });

  it('empty rangeStr → not abnormal', () => {
    expect(flagAbnormal(10, '')).toEqual({ isAbnormal: false, flag: '' });
  });

  it('unrecognised format → not abnormal', () => {
    expect(flagAbnormal(10, 'positive')).toEqual({ isAbnormal: false, flag: '' });
  });
});

// ── POST /lab-requests ─────────────────────────────────────────────────────────
describe('POST /lab-requests', () => {
  it('Doctor creates a lab request', async () => {
    const { doctorToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/lab-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        encounterId: encounter._id,
        tests: [{ name: 'FBC', unitPriceKobo: 500000 }, { name: 'LFT' }],
        urgency: 'urgent',
      });

    expect(res.status).toBe(201);
    expect(res.body.labRequest.tests).toHaveLength(2);
    expect(res.body.labRequest.status).toBe('requested');
    expect(res.body.labRequest.urgency).toBe('urgent');
  });

  it('Requires at least one test', async () => {
    const { doctorToken, encounter } = await makeFixtures();

    const res = await request(app)
      .post('/lab-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ encounterId: encounter._id, tests: [] });

    expect(res.status).toBe(400);
  });

  it('Different doctor cannot create request for another doctor encounter (403)', async () => {
    const { encounter } = await makeFixtures();
    const { token: otherDoc } = await createUserAndToken({
      role: 'Doctor', email: `otherdoc${uid()}@t.com`,
    });

    const res = await request(app)
      .post('/lab-requests')
      .set('Authorization', `Bearer ${otherDoc}`)
      .send({ encounterId: encounter._id, tests: [{ name: 'FBC' }] });

    expect(res.status).toBe(403);
  });
});

// ── GET /lab-requests/worklist ────────────────────────────────────────────────
describe('GET /lab-requests/worklist', () => {
  it('Only shows paid requests to Lab Scientist', async () => {
    const { doctorUser, labToken, patient, encounter } = await makeFixtures();

    // Create one requested (unpaid) and one paid
    await LabRequest.create({
      encounter: encounter._id, patient: patient._id, requestedBy: doctorUser._id,
      tests: [{ name: 'ESR' }], status: 'requested',
    });
    await LabRequest.create({
      encounter: encounter._id, patient: patient._id, requestedBy: doctorUser._id,
      tests: [{ name: 'Malaria RDT' }], status: 'paid',
    });

    const res = await request(app)
      .get('/lab-requests/worklist')
      .set('Authorization', `Bearer ${labToken}`);

    expect(res.status).toBe(200);
    expect(res.body.labRequests).toHaveLength(1);
    expect(res.body.labRequests[0].tests[0].name).toBe('Malaria RDT');
  });

  it('Patient cannot access worklist (403)', async () => {
    const { patientToken } = await makeFixtures();

    const res = await request(app)
      .get('/lab-requests/worklist')
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(403);
  });
});

// ── PATCH pick-up + POST results ──────────────────────────────────────────────
describe('Lab Scientist workflow: pick-up → results', () => {
  async function makePaydLabRequest() {
    const { doctorUser, labToken, labUser, patient, encounter } = await makeFixtures();
    const lr = await LabRequest.create({
      encounter: encounter._id, patient: patient._id, requestedBy: doctorUser._id,
      tests: [{ name: 'Glucose' }], status: 'paid',
    });
    return { lr, labToken, labUser };
  }

  it('Lab Scientist picks up a paid request → in_progress', async () => {
    const { lr, labToken } = await makePaydLabRequest();

    const res = await request(app)
      .patch(`/lab-requests/${lr._id}/pick-up`)
      .set('Authorization', `Bearer ${labToken}`);

    expect(res.status).toBe(200);
    expect(res.body.labRequest.status).toBe('in_progress');
  });

  it('Cannot pick up a non-paid request (400)', async () => {
    const { lr, labToken, labUser } = await makePaydLabRequest();
    lr.status = 'requested';
    await lr.save();

    const res = await request(app)
      .patch(`/lab-requests/${lr._id}/pick-up`)
      .set('Authorization', `Bearer ${labToken}`);

    expect(res.status).toBe(400);
  });

  it('Entering results auto-flags abnormal values and completes request', async () => {
    const { lr, labToken, labUser } = await makePaydLabRequest();
    lr.status = 'in_progress';
    lr.assignedTo = labUser._id;
    await lr.save();

    const res = await request(app)
      .post(`/lab-requests/${lr._id}/results`)
      .set('Authorization', `Bearer ${labToken}`)
      .send({
        results: [
          { testName: 'Glucose', value: '2.0', unit: 'mmol/L', referenceRange: '3.9 - 6.1' },
          { testName: 'Sodium', value: '140', unit: 'mmol/L', referenceRange: '136 - 145' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.labRequest.status).toBe('completed');

    const glucose = res.body.labRequest.results.find((r) => r.testName === 'Glucose');
    expect(glucose.isAbnormal).toBe(true);
    expect(glucose.abnormalFlag).toBe('LL'); // 2.0 < 70% of 3.9

    const sodium = res.body.labRequest.results.find((r) => r.testName === 'Sodium');
    expect(sodium.isAbnormal).toBe(false);
  });

  it('A different lab scientist cannot enter results for another scientist request (403)', async () => {
    const { lr, labUser } = await makePaydLabRequest();
    lr.status = 'in_progress';
    lr.assignedTo = labUser._id;
    await lr.save();

    const { token: otherLab } = await createUserAndToken({
      role: 'Lab Scientist', email: `otherlab${uid()}@t.com`,
    });

    const res = await request(app)
      .post(`/lab-requests/${lr._id}/results`)
      .set('Authorization', `Bearer ${otherLab}`)
      .send({ results: [{ testName: 'Glucose', value: '5.0' }] });

    expect(res.status).toBe(403);
  });
});
