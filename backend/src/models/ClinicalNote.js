'use strict';

const mongoose = require('mongoose');

/**
 * ClinicalNote — a structured note written by the Doctor during or after
 * an Encounter.
 *
 * Notes are append-only: Doctors may not delete their own notes.
 * Access control mirrors Encounter (treating Doctor, encounter Nurse,
 * Admin read-only, Patient read-only own records).
 */
const clinicalNoteSchema = new mongoose.Schema(
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
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Structured note sections (SOAP-style)
    subjective: {
      type: String,
      trim: true,
      maxlength: [3000, 'Subjective section must be at most 3000 characters'],
    },
    objective: {
      type: String,
      trim: true,
      maxlength: [3000, 'Objective section must be at most 3000 characters'],
    },
    assessment: {
      type: String,
      trim: true,
      maxlength: [3000, 'Assessment section must be at most 3000 characters'],
    },
    plan: {
      type: String,
      trim: true,
      maxlength: [3000, 'Plan section must be at most 3000 characters'],
    },
    // Diagnosis captured directly on the note (mirrors Encounter.primaryDiagnosis
    // for convenience; the Encounter is the authoritative source).
    diagnosis: {
      code: { type: String, trim: true, maxlength: 20 },
      description: { type: String, trim: true, maxlength: 300 },
    },
  },
  { timestamps: true },
);

const ClinicalNote = mongoose.model('ClinicalNote', clinicalNoteSchema);

module.exports = { ClinicalNote };
