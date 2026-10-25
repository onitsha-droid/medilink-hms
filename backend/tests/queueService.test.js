'use strict';

const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const {
  checkIn,
  markUrgent,
  getQueue,
  estimateWait,
  getQueueSnapshot,
  toMidnightUTC,
} = require('../src/services/queueService');

setupTestDB();

let clinic, patient1, patient2, patient3, staffUser;

beforeEach(async () => {
  const { user } = await createUserAndToken({ role: 'Front Desk' });
  staffUser = user;

  clinic = await Clinic.create({
    name: `Queue-Clinic-${Date.now()}`,
    avgConsultationMinutes: 10,
  });

  const makePatient = async (suffix) =>
    Patient.create({
      firstName: 'P',
      lastName: suffix,
      dateOfBirth: '1990-01-01',
      gender: 'male',
      phone: `+234${String(Date.now()).slice(-7)}${suffix}`,
      registeredBy: staffUser._id,
    });

  patient1 = await makePatient('1');
  patient2 = await makePatient('2');
  patient3 = await makePatient('3');
});

// ── checkIn ───────────────────────────────────────────────────────────────────
describe('queueService.checkIn', () => {
  it('assigns position 1 to the first check-in', async () => {
    const result = await checkIn({
      clinicId: clinic._id.toString(),
      patientId: patient1._id.toString(),
      checkedInBy: staffUser._id.toString(),
    });
    expect(result.position).toBe(1);
    expect(result.estimatedWaitMinutes).toBe(0);
  });

  it('assigns incrementing positions for subsequent check-ins', async () => {
    const r1 = await checkIn({
      clinicId: clinic._id.toString(),
      patientId: patient1._id.toString(),
      checkedInBy: staffUser._id.toString(),
    });
    const r2 = await checkIn({
      clinicId: clinic._id.toString(),
      patientId: patient2._id.toString(),
      checkedInBy: staffUser._id.toString(),
    });
    expect(r1.position).toBe(1);
    expect(r2.position).toBe(2);
    expect(r2.estimatedWaitMinutes).toBe(10); // 1 slot ahead × 10 min
  });

  it('throws on duplicate check-in (same patient, clinic, day)', async () => {
    await checkIn({
      clinicId: clinic._id.toString(),
      patientId: patient1._id.toString(),
      checkedInBy: staffUser._id.toString(),
    });

    await expect(
      checkIn({
        clinicId: clinic._id.toString(),
        patientId: patient1._id.toString(),
        checkedInBy: staffUser._id.toString(),
      }),
    ).rejects.toThrow();
  });
});

// ── markUrgent ────────────────────────────────────────────────────────────────
describe('queueService.markUrgent', () => {
  it('moves an urgent patient to the front of the ordered queue', async () => {
    const { user: nurseUser } = await createUserAndToken({ role: 'Nurse' });

    // Check in three patients in order
    await checkIn({ clinicId: clinic._id.toString(), patientId: patient1._id.toString(), checkedInBy: staffUser._id.toString() });
    const r2 = await checkIn({ clinicId: clinic._id.toString(), patientId: patient2._id.toString(), checkedInBy: staffUser._id.toString() });
    await checkIn({ clinicId: clinic._id.toString(), patientId: patient3._id.toString(), checkedInBy: staffUser._id.toString() });

    // Mark patient2 as urgent
    await markUrgent(r2.entry._id.toString(), nurseUser._id.toString(), 'Chest pain');

    // Get ordered queue — patient2 should now be first
    const queue = await getQueue(clinic._id.toString());
    expect(queue[0].patient._id.toString()).toBe(patient2._id.toString());
    expect(queue[0].isUrgent).toBe(true);
  });

  it('throws 404 for unknown entry ID', async () => {
    await expect(
      markUrgent('64b1234567890abcde123456', staffUser._id.toString()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── estimateWait ─────────────────────────────────────────────────────────────
describe('queueService.estimateWait', () => {
  it('returns 0 for position 1', async () => {
    const wait = await estimateWait(clinic._id.toString(), 1);
    expect(wait).toBe(0);
  });

  it('returns avgConsultationMinutes × slots ahead for position > 1', async () => {
    // clinic.avgConsultationMinutes = 10
    const wait = await estimateWait(clinic._id.toString(), 4);
    expect(wait).toBe(30); // 3 slots ahead × 10 min
  });
});

// ── getQueueSnapshot ──────────────────────────────────────────────────────────
describe('queueService.getQueueSnapshot', () => {
  it('returns entries with position and estimated wait', async () => {
    await checkIn({ clinicId: clinic._id.toString(), patientId: patient1._id.toString(), checkedInBy: staffUser._id.toString() });
    await checkIn({ clinicId: clinic._id.toString(), patientId: patient2._id.toString(), checkedInBy: staffUser._id.toString() });

    const snapshot = await getQueueSnapshot(clinic._id.toString());
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].position).toBe(1);
    expect(snapshot[0].estimatedWaitMinutes).toBe(0);
    expect(snapshot[1].position).toBe(2);
    expect(snapshot[1].estimatedWaitMinutes).toBe(10);
  });

  it('returns empty array when no one is in the queue', async () => {
    const snapshot = await getQueueSnapshot(clinic._id.toString());
    expect(snapshot).toHaveLength(0);
  });
});
