'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Patient — core demographic record.
 *
 * Privacy rules (README §Blockchain Design & Privacy):
 *  - No PHI is ever written to the blockchain.
 *  - The hospitalId is a random UUID; it is the only value exposed in QR codes.
 *  - HMO / NHIA fields are optional and stored only in MongoDB.
 */
const patientSchema = new mongoose.Schema(
  {
    // ── Unique identifiers ───────────────────────────────────────────────────
    hospitalId: {
      type: String,
      unique: true,
      index: true,
      // Generated server-side; never supplied by the client.
    },

    // ── Demographics ─────────────────────────────────────────────────────────
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [60, 'First name must be at most 60 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [60, 'Last name must be at most 60 characters'],
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: {
        values: ['male', 'female', 'other'],
        message: 'Gender must be male, female, or other',
      },
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+?[\d\s\-().]{7,20}$/, 'Phone number is invalid'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Email is invalid'],
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: { type: String, default: 'Nigeria' },
    },

    // ── HMO / NHIA ───────────────────────────────────────────────────────────
    hmo: {
      provider: String,       // e.g. "Hygeia HMO"
      memberNumber: String,
      planType: String,
    },
    nhiaNumber: {
      type: String,
      trim: true,
    },

    // ── Record metadata ───────────────────────────────────────────────────────
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// ── Generate hospitalId before first save ─────────────────────────────────────
patientSchema.pre('save', function generateHospitalId(next) {
  if (!this.hospitalId) {
    // Format: ML-XXXXXXXX (8 uppercase hex chars from a UUID)
    this.hospitalId = `ML-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }
  next();
});

// ── Virtual: full name ────────────────────────────────────────────────────────
patientSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`;
});

// ── QR payload — contains ONLY the hospitalId (no PHI) ───────────────────────
patientSchema.methods.qrPayload = function qrPayload() {
  return JSON.stringify({ hospitalId: this.hospitalId });
};

const Patient = mongoose.model('Patient', patientSchema);

module.exports = { Patient };
