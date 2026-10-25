'use strict';

const mongoose = require('mongoose');

/**
 * Clinic — a department or consulting unit within the hospital.
 * Created and managed by Admin only.
 */
const clinicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Clinic name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Clinic name must be at most 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description must be at most 300 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Average consultation duration in minutes — used for wait-time estimates
    avgConsultationMinutes: {
      type: Number,
      default: 15,
      min: [1, 'Average consultation must be at least 1 minute'],
    },
  },
  {
    timestamps: true,
  },
);

const Clinic = mongoose.model('Clinic', clinicSchema);

module.exports = { Clinic };
