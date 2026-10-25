'use strict';

const mongoose = require('mongoose');

/**
 * QueueEntry — one patient's slot in a clinic queue for a given day.
 *
 * Position is 1-based and immutable once assigned; re-prioritization
 * for urgent cases is handled by the `isUrgent` flag and the service
 * sorting logic, not by reassigning position numbers.
 */
const queueEntrySchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
    },
    queueDate: {
      // Date-only (midnight UTC) — used to scope queries to today's queue
      type: Date,
      required: true,
      index: true,
    },
    position: {
      // Raw sequence number in order of check-in; used for stable ordering
      type: Number,
      required: true,
    },
    isUrgent: {
      // Nurse-flagged urgent cases sort before non-urgent ones
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['waiting', 'in_progress', 'completed', 'cancelled'],
      default: 'waiting',
      index: true,
    },
    checkedInBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    urgentFlaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    urgentReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    // Rolling average slot: records how long this patient's consultation took
    actualConsultationMinutes: {
      type: Number,
    },
  },
  {
    timestamps: true,
  },
);

// A patient can only appear once per clinic per day
queueEntrySchema.index(
  { clinic: 1, patient: 1, queueDate: 1 },
  { unique: true, name: 'unique_queue_slot' },
);

const QueueEntry = mongoose.model('QueueEntry', queueEntrySchema);

module.exports = { QueueEntry };
