'use strict';

const { QueueEntry } = require('../models/QueueEntry');
const { Clinic } = require('../models/Clinic');

/** Normalize a date to midnight UTC */
function toMidnightUTC(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the ordered queue for a clinic on a given date.
 *
 * Ordering rules (in priority):
 *   1. Urgent cases first
 *   2. Within the same urgency tier, sort by position (check-in order)
 *
 * Only 'waiting' and 'in_progress' entries are included.
 *
 * @param {string} clinicId
 * @param {Date}   [date]     defaults to today
 * @returns {Promise<QueueEntry[]>}
 */
async function getQueue(clinicId, date = new Date()) {
  const entries = await QueueEntry.find({
    clinic: clinicId,
    queueDate: toMidnightUTC(date),
    status: { $in: ['waiting', 'in_progress'] },
  })
    .populate('patient', 'firstName lastName hospitalId')
    .sort({ isUrgent: -1, position: 1 }) // urgent first, then check-in order
    .lean();

  return entries;
}

/**
 * Calculate estimated wait time in minutes for a patient at a given position
 * in the queue.
 *
 * Uses the clinic's stored rolling average consultation time.
 * Patients currently in_progress count as half consumed.
 *
 * @param {string} clinicId
 * @param {number} queuePosition  1-based position after ordering (not raw position)
 * @returns {Promise<number>}     estimated wait in minutes
 */
async function estimateWait(clinicId, queuePosition) {
  const clinic = await Clinic.findById(clinicId).lean();
  const avgMinutes = clinic?.avgConsultationMinutes ?? 15;

  // Slots ahead = queuePosition - 1 (patient at pos 1 has no wait)
  const slotsAhead = Math.max(0, queuePosition - 1);
  return Math.round(slotsAhead * avgMinutes);
}

/**
 * Check a patient into a clinic queue.
 *
 * @param {object} opts
 * @param {string} opts.clinicId
 * @param {string} opts.patientId
 * @param {string} [opts.appointmentId]
 * @param {string} opts.checkedInBy   User ID performing the check-in
 * @param {Date}   [opts.date]
 * @returns {Promise<{ entry: QueueEntry, position: number, estimatedWaitMinutes: number }>}
 */
async function checkIn({ clinicId, patientId, appointmentId, checkedInBy, date = new Date() }) {
  const queueDate = toMidnightUTC(date);

  // Determine next position (max existing + 1)
  const lastEntry = await QueueEntry.findOne({ clinic: clinicId, queueDate })
    .sort({ position: -1 })
    .lean();
  const nextPosition = lastEntry ? lastEntry.position + 1 : 1;

  const entry = await QueueEntry.create({
    clinic: clinicId,
    patient: patientId,
    appointment: appointmentId,
    queueDate,
    position: nextPosition,
    checkedInBy,
  });

  // Determine ordered position (after urgency sort)
  const queue = await getQueue(clinicId, date);
  const orderedIndex = queue.findIndex(
    (e) => e._id.toString() === entry._id.toString(),
  );
  const orderedPosition = orderedIndex + 1; // 1-based

  const waitMinutes = await estimateWait(clinicId, orderedPosition);

  return { entry, position: orderedPosition, estimatedWaitMinutes: waitMinutes };
}

/**
 * Mark a patient as urgent in the queue.
 * Moves them to the front of the non-in_progress waiting list.
 *
 * @param {string} entryId        QueueEntry _id
 * @param {string} flaggedBy      User ID of the nurse
 * @param {string} [reason]
 * @returns {Promise<QueueEntry>}
 */
async function markUrgent(entryId, flaggedBy, reason) {
  const entry = await QueueEntry.findByIdAndUpdate(
    entryId,
    {
      isUrgent: true,
      urgentFlaggedBy: flaggedBy,
      urgentReason: reason,
    },
    { new: true },
  ).populate('patient', 'firstName lastName hospitalId');

  if (!entry) throw Object.assign(new Error('Queue entry not found'), { statusCode: 404 });
  return entry;
}

/**
 * Update the rolling average consultation time for a clinic after a
 * consultation completes. Uses an exponential moving average (α = 0.3)
 * so recent consultations have more weight.
 *
 * @param {string} clinicId
 * @param {number} actualMinutes
 */
async function updateRollingAverage(clinicId, actualMinutes) {
  const clinic = await Clinic.findById(clinicId);
  if (!clinic) return;
  const alpha = 0.3;
  const newAvg = Math.round(
    alpha * actualMinutes + (1 - alpha) * clinic.avgConsultationMinutes,
  );
  clinic.avgConsultationMinutes = newAvg;
  await clinic.save();
}

/**
 * Build a full queue snapshot for a clinic: ordered entries with their
 * current estimated wait times.
 *
 * @param {string} clinicId
 * @param {Date}   [date]
 * @returns {Promise<Array<{ entry, position, estimatedWaitMinutes }>>}
 */
async function getQueueSnapshot(clinicId, date = new Date()) {
  const entries = await getQueue(clinicId, date);
  const clinic = await Clinic.findById(clinicId).lean();
  const avgMinutes = clinic?.avgConsultationMinutes ?? 15;

  return entries.map((entry, idx) => ({
    entry,
    position: idx + 1,
    estimatedWaitMinutes: Math.round(idx * avgMinutes),
  }));
}

module.exports = {
  checkIn,
  getQueue,
  markUrgent,
  estimateWait,
  updateRollingAverage,
  getQueueSnapshot,
  toMidnightUTC,
};
