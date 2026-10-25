'use strict';

const mongoose = require('mongoose');

/**
 * Vitals — recorded by a Nurse during triage.
 *
 * Linked to a QueueEntry (one triage per check-in session).
 * Sensible clinical ranges are validated here; the Nurse is warned
 * but not blocked if a value is outside the typical range — edge cases
 * exist. The `isUrgent` flag is set either manually or automatically
 * when a value is critically outside the danger thresholds.
 */
const vitalsSchema = new mongoose.Schema(
  {
    queueEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QueueEntry',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Blood pressure ────────────────────────────────────────────────────────
    bpSystolic: {
      type: Number,
      min: [50, 'Systolic BP too low (min 50)'],
      max: [300, 'Systolic BP too high (max 300)'],
    },
    bpDiastolic: {
      type: Number,
      min: [20, 'Diastolic BP too low (min 20)'],
      max: [200, 'Diastolic BP too high (max 200)'],
    },

    // ── SpO2 (%) ──────────────────────────────────────────────────────────────
    spo2: {
      type: Number,
      min: [50, 'SpO2 too low (min 50%)'],
      max: [100, 'SpO2 too high (max 100%)'],
    },

    // ── Weight (kg) ───────────────────────────────────────────────────────────
    weightKg: {
      type: Number,
      min: [0.5, 'Weight too low (min 0.5 kg)'],
      max: [500, 'Weight too high (max 500 kg)'],
    },

    // ── Temperature (°C) ──────────────────────────────────────────────────────
    temperatureCelsius: {
      type: Number,
      min: [30, 'Temperature too low (min 30°C)'],
      max: [45, 'Temperature too high (max 45°C)'],
    },

    // ── Heart rate (bpm) ──────────────────────────────────────────────────────
    heartRateBpm: {
      type: Number,
      min: [20, 'Heart rate too low (min 20 bpm)'],
      max: [300, 'Heart rate too high (max 300 bpm)'],
    },

    // ── Nurse's free-text notes ───────────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes must be at most 1000 characters'],
    },

    // ── Urgent flag ───────────────────────────────────────────────────────────
    isUrgent: {
      type: Boolean,
      default: false,
    },
    urgentReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Auto-flag as urgent when any value crosses a critical threshold.
 * Thresholds are conservative — a Nurse can always override manually.
 */
vitalsSchema.pre('save', function autoFlag(next) {
  const reasons = [];

  if (this.spo2 !== undefined && this.spo2 < 92) {
    reasons.push(`SpO2 critically low (${this.spo2}%)`);
  }
  if (this.bpSystolic !== undefined && (this.bpSystolic > 180 || this.bpSystolic < 80)) {
    reasons.push(`Systolic BP critical (${this.bpSystolic} mmHg)`);
  }
  if (this.temperatureCelsius !== undefined &&
      (this.temperatureCelsius > 39.5 || this.temperatureCelsius < 35)) {
    reasons.push(`Temperature critical (${this.temperatureCelsius}°C)`);
  }
  if (this.heartRateBpm !== undefined &&
      (this.heartRateBpm > 150 || this.heartRateBpm < 40)) {
    reasons.push(`Heart rate critical (${this.heartRateBpm} bpm)`);
  }

  if (reasons.length > 0 && !this.isUrgent) {
    this.isUrgent = true;
    this.urgentReason =
      (this.urgentReason ? `${this.urgentReason}; ` : '') + reasons.join('; ');
  }

  next();
});

const Vitals = mongoose.model('Vitals', vitalsSchema);

module.exports = { Vitals };
