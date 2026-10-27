'use strict';

const mongoose = require('mongoose');

/**
 * Prescription — a structured medication order from a Doctor.
 *
 * Each drug entry is fully structured (no free-text-only drug names) so
 * pharmacists can unambiguously dispense the right product.
 *
 * Status:
 *   draft → sent → dispensed
 *
 * The Pharmacist can only see 'sent' prescriptions.
 * Dispensing requires confirmed payment (checked in the dispense route).
 */
const drugLineSchema = new mongoose.Schema(
  {
    // Generic or brand drug name — must be non-empty
    drugName: {
      type: String,
      required: [true, 'Drug name is required'],
      trim: true,
      maxlength: [150, 'Drug name must be at most 150 characters'],
    },
    // Strength + form e.g. "500mg tablet"
    dose: {
      type: String,
      required: [true, 'Dose is required'],
      trim: true,
      maxlength: [100, 'Dose must be at most 100 characters'],
    },
    // Structured frequency — must be one of the allowed values
    frequency: {
      type: String,
      required: [true, 'Frequency is required'],
      enum: {
        values: [
          'once daily',
          'twice daily',
          'three times daily',
          'four times daily',
          'every 6 hours',
          'every 8 hours',
          'every 12 hours',
          'as needed',
          'stat',
          'weekly',
          'other',
        ],
        message: 'Frequency "{VALUE}" is not a recognised value',
      },
    },
    // Duration string e.g. "7 days", "2 weeks"
    duration: {
      type: String,
      required: [true, 'Duration is required'],
      trim: true,
      maxlength: [60, 'Duration must be at most 60 characters'],
    },
    // Quantity to dispense (units, tablets, bottles…)
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    // Unit price for billing (kobo)
    unitPriceKobo: {
      type: Number,
      min: 0,
      default: 0,
    },
    // Optional free-text instructions (e.g. "take with food")
    instructions: {
      type: String,
      trim: true,
      maxlength: [300, 'Instructions must be at most 300 characters'],
    },
  },
  { _id: true },
);

const prescriptionSchema = new mongoose.Schema(
  {
    encounter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Encounter',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    prescribedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    dispensedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    drugs: {
      type: [drugLineSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A prescription must contain at least one drug',
      },
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'dispensed'],
      default: 'sent', // created as 'sent' so pharmacist sees it immediately
      index: true,
    },
    // Invoice reference — set by the billing hook
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes must be at most 500 characters'],
    },
    dispensedAt: { type: Date },
  },
  { timestamps: true },
);

const Prescription = mongoose.model('Prescription', prescriptionSchema);

module.exports = { Prescription };
