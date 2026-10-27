'use strict';

const mongoose = require('mongoose');

/**
 * LabRequest — a test order placed by a Doctor during an Encounter.
 *
 * Status machine:
 *   requested → paid → in_progress → completed
 *
 * The Lab Scientist's worklist shows only PAID requests.
 * The billing invoice hook (Day 4) transitions requested → paid.
 */
const labRequestSchema = new mongoose.Schema(
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
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // Tests requested e.g. ['FBC', 'Lipid profile', 'HbA1c']
    tests: {
      type: [
        {
          name: {
            type: String,
            required: [true, 'Test name is required'],
            trim: true,
            maxlength: 100,
          },
          // Unit price for billing (in Naira kobo, integer to avoid float issues)
          unitPriceKobo: {
            type: Number,
            min: 0,
            default: 0,
          },
        },
      ],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one test is required',
      },
    },
    status: {
      type: String,
      enum: {
        values: ['requested', 'paid', 'in_progress', 'completed'],
        message: 'Invalid status transition',
      },
      default: 'requested',
      index: true,
    },
    // Invoice reference — set by the billing hook
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
    },
    urgency: {
      type: String,
      enum: ['routine', 'urgent', 'stat'],
      default: 'routine',
    },
    clinicalNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Results array — populated by Lab Scientist when completing
    results: [
      {
        testName: { type: String, trim: true, maxlength: 100 },
        value: { type: String, trim: true, maxlength: 200 },
        unit: { type: String, trim: true, maxlength: 50 },
        referenceRange: { type: String, trim: true, maxlength: 100 },
        isAbnormal: { type: Boolean, default: false },
        abnormalFlag: {
          type: String,
          enum: ['', 'L', 'H', 'LL', 'HH', 'A'],
          default: '',
        },
        notes: { type: String, trim: true, maxlength: 500 },
      },
    ],
    completedAt: { type: Date },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

const LabRequest = mongoose.model('LabRequest', labRequestSchema);

module.exports = { LabRequest };
