'use strict';

const mongoose = require('mongoose');

/**
 * Encounter — one clinical visit/episode for a patient.
 *
 * An Encounter is opened when a Doctor begins a consultation and closed when
 * they mark it complete. Lab requests, prescriptions, vitals, and clinical
 * notes all reference an Encounter so the full history is recoverable.
 *
 * Access control (enforced in the route layer):
 *   - The treating Doctor (encounter.doctor)
 *   - The Nurse who recorded vitals on the same encounter (encounter.nurse)
 *   - Admin — read-only
 *   - The Patient themselves — read-only (their own records only)
 */
const encounterSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Nurse on this encounter (optional — set at triage time)
    nurse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    queueEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QueueEntry',
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    chiefComplaint: {
      type: String,
      trim: true,
      maxlength: [500, 'Chief complaint must be at most 500 characters'],
    },
    // Primary ICD-10-ish diagnosis code + description written by the Doctor
    primaryDiagnosis: {
      code: { type: String, trim: true, maxlength: 20 },
      description: { type: String, trim: true, maxlength: 300 },
    },
    secondaryDiagnoses: [
      {
        code: { type: String, trim: true, maxlength: 20 },
        description: { type: String, trim: true, maxlength: 300 },
      },
    ],
    status: {
      type: String,
      enum: ['open', 'completed', 'cancelled'],
      default: 'open',
      index: true,
    },
    // Set when status transitions to 'completed'
    completedAt: { type: Date },
  },
  { timestamps: true },
);

const Encounter = mongoose.model('Encounter', encounterSchema);

module.exports = { Encounter };
