'use strict';

const mongoose = require('mongoose');

/**
 * Appointment
 *
 * Supports two booking paths:
 *   1. Online booking by Patient (type: 'online')
 *   2. Walk-in created by Front Desk (type: 'walk_in')
 *
 * Double-booking is prevented by a unique compound index on
 * { patient, clinic, scheduledDate, status: 'scheduled' }.
 * For walk-ins on the same date we also guard in the route handler
 * using a Mongoose transaction so the check and insert are atomic.
 */
const APPOINTMENT_STATUSES = Object.freeze([
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
]);

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
      index: true,
    },
    status: {
      type: String,
      enum: { values: APPOINTMENT_STATUSES, message: 'Invalid status' },
      default: 'scheduled',
      index: true,
    },
    type: {
      type: String,
      enum: { values: ['online', 'walk_in'], message: 'Type must be online or walk_in' },
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes must be at most 500 characters'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// ── Prevent double-booking ────────────────────────────────────────────────────
// A patient cannot have two SCHEDULED appointments at the same clinic on the
// same calendar day.  We store the date-only by normalizing to midnight UTC in
// the route handler before inserting.
appointmentSchema.index(
  { patient: 1, clinic: 1, scheduledDate: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'scheduled' },
    name: 'unique_scheduled_appointment',
  },
);

const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = { Appointment, APPOINTMENT_STATUSES };
