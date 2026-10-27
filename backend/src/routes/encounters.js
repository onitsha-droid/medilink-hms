'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Encounter } = require('../models/Encounter');
const { ClinicalNote } = require('../models/ClinicalNote');
const { Vitals } = require('../models/Vitals');
const { Patient } = require('../models/Patient');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { emitRecordAccessed } = require('../services/recordAudit');

const router = express.Router();
router.use(authenticate);

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Verify the requesting user may access the given encounter.
 * Returns the encounter document or throws a 403/404 operational error.
 *
 * Rules:
 *   Doctor: must be encounter.doctor
 *   Nurse:  must be encounter.nurse
 *   Admin:  read-only, always allowed
 *   Patient: read-only, must be the patient on the encounter
 */
async function loadAuthorizedEncounter(encounterId, user, { readOnly = false } = {}) {
  const encounter = await Encounter.findById(encounterId)
    .populate('doctor', 'name role')
    .populate('nurse', 'name role')
    .populate('patient', 'firstName lastName hospitalId');

  if (!encounter) throw createError('Encounter not found', 404);

  const uid = user.id;
  const role = user.role;

  if (role === 'Admin') return encounter; // Admin always read-only
  if (role === 'Patient') {
    if (encounter.patient._id.toString() !== uid && encounter.patient.toString() !== uid) {
      throw createError('You may only access your own records', 403);
    }
    return encounter;
  }
  if (role === 'Doctor') {
    if (encounter.doctor._id.toString() !== uid && encounter.doctor.toString() !== uid) {
      throw createError('You are not the treating doctor for this encounter', 403);
    }
    return encounter;
  }
  if (role === 'Nurse') {
    const nurseId = encounter.nurse?._id?.toString() ?? encounter.nurse?.toString();
    if (nurseId !== uid) {
      throw createError('You are not the assigned nurse for this encounter', 403);
    }
    if (!readOnly) throw createError('Nurses have read-only access to encounter records', 403);
    return encounter;
  }

  throw createError('Access denied', 403);
}

// ── POST /encounters — Doctor opens an encounter ───────────────────────────────
router.post(
  '/',
  authorize('Doctor'),
  [
    body('patientId').isMongoId().withMessage('patientId must be a valid Mongo ID'),
    body('clinicId').isMongoId().withMessage('clinicId must be a valid Mongo ID'),
    body('queueEntryId').optional().isMongoId(),
    body('chiefComplaint').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { patientId, clinicId, queueEntryId, chiefComplaint } = req.body;

      const patient = await Patient.findById(patientId);
      if (!patient) return next(createError('Patient not found', 404));

      const encounter = await Encounter.create({
        patient: patientId,
        doctor: req.user.id,
        clinic: clinicId,
        queueEntry: queueEntryId || undefined,
        chiefComplaint,
      });

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId,
        action: 'write:encounter_opened',
        encounterId: encounter._id.toString(),
      });

      return res.status(201).json({ encounter });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /encounters/my-queue — Doctor's queue (open encounters + waiting patients) ──
router.get(
  '/my-queue',
  authorize('Doctor'),
  async (req, res, next) => {
    try {
      const encounters = await Encounter.find({
        doctor: req.user.id,
        status: 'open',
      })
        .populate('patient', 'firstName lastName hospitalId dateOfBirth gender')
        .populate('clinic', 'name')
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({ encounters });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /encounters/patient/:patientId/history — full patient history ──────────
router.get(
  '/patient/:patientId/history',
  authorize('Doctor', 'Nurse', 'Admin', 'Patient'),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { patientId } = req.params;
      const { role, id: userId } = req.user;

      // Patient may only see their own records
      if (role === 'Patient') {
        const patient = await Patient.findById(patientId);
        if (!patient) return next(createError('Patient not found', 404));
        // We cannot verify patient userId === patient._id (User ≠ Patient model);
        // for now we allow the patient to fetch their record if they know their
        // patientId. A stricter User→Patient binding is in DEFERRED.
      }

      const [encounters, vitals] = await Promise.all([
        Encounter.find({ patient: patientId })
          .populate('doctor', 'name role')
          .populate('nurse', 'name role')
          .populate('clinic', 'name')
          .sort({ createdAt: -1 })
          .lean(),
        Vitals.find({ patient: patientId })
          .populate('recordedBy', 'name role')
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      const encounterIds = encounters.map((e) => e._id);
      const notes = await ClinicalNote.find({ encounter: { $in: encounterIds } })
        .populate('author', 'name role')
        .sort({ createdAt: -1 })
        .lean();

      emitRecordAccessed(req.app.get('io'), {
        userId,
        patientId,
        action: 'read:patient_history',
      });

      return res.status(200).json({ encounters, vitals, notes });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /encounters/:encounterId — single encounter detail ─────────────────────
router.get(
  '/:encounterId',
  authorize('Doctor', 'Nurse', 'Admin', 'Patient'),
  param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const encounter = await loadAuthorizedEncounter(req.params.encounterId, req.user, {
        readOnly: req.user.role !== 'Doctor',
      });

      // Fetch all notes and vitals for this encounter
      const [notes, vitals] = await Promise.all([
        ClinicalNote.find({ encounter: encounter._id })
          .populate('author', 'name role')
          .sort({ createdAt: -1 })
          .lean(),
        Vitals.findOne({ queueEntry: encounter.queueEntry }).lean(),
      ]);

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId: encounter.patient._id?.toString() ?? encounter.patient.toString(),
        action: 'read:encounter',
        encounterId: encounter._id.toString(),
      });

      return res.status(200).json({ encounter, notes, vitals });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /encounters/:encounterId/notes — Doctor adds a clinical note ──────────
router.post(
  '/:encounterId/notes',
  authorize('Doctor'),
  [
    param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
    body('subjective').optional().trim().isLength({ max: 3000 }),
    body('objective').optional().trim().isLength({ max: 3000 }),
    body('assessment').optional().trim().isLength({ max: 3000 }),
    body('plan').optional().trim().isLength({ max: 3000 }),
    body('diagnosis.code').optional().trim().isLength({ max: 20 }),
    body('diagnosis.description').optional().trim().isLength({ max: 300 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const encounter = await loadAuthorizedEncounter(req.params.encounterId, req.user);

      if (encounter.status !== 'open') {
        return next(createError('Cannot add notes to a closed encounter', 400));
      }

      const { subjective, objective, assessment, plan, diagnosis } = req.body;

      const note = await ClinicalNote.create({
        encounter: encounter._id,
        patient: encounter.patient._id ?? encounter.patient,
        author: req.user.id,
        subjective,
        objective,
        assessment,
        plan,
        diagnosis,
      });

      const patientId = (encounter.patient._id ?? encounter.patient).toString();

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId,
        action: 'write:clinical_note',
        encounterId: encounter._id.toString(),
      });

      return res.status(201).json({ note });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /encounters/:encounterId/diagnosis — Doctor sets/updates diagnosis ───
router.patch(
  '/:encounterId/diagnosis',
  authorize('Doctor'),
  [
    param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
    body('primaryDiagnosis').optional().isObject(),
    body('primaryDiagnosis.code').optional().trim().isLength({ max: 20 }),
    body('primaryDiagnosis.description').optional().trim().isLength({ max: 300 }),
    body('secondaryDiagnoses').optional().isArray(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const encounter = await loadAuthorizedEncounter(req.params.encounterId, req.user);

      if (encounter.status !== 'open') {
        return next(createError('Cannot update a closed encounter', 400));
      }

      const { primaryDiagnosis, secondaryDiagnoses } = req.body;
      if (primaryDiagnosis !== undefined) encounter.primaryDiagnosis = primaryDiagnosis;
      if (secondaryDiagnoses !== undefined) encounter.secondaryDiagnoses = secondaryDiagnoses;

      await encounter.save();

      const patientId = (encounter.patient._id ?? encounter.patient).toString();
      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId,
        action: 'write:diagnosis',
        encounterId: encounter._id.toString(),
      });

      return res.status(200).json({ encounter });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /encounters/:encounterId/complete — Doctor closes an encounter ───────
router.patch(
  '/:encounterId/complete',
  authorize('Doctor'),
  param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const encounter = await loadAuthorizedEncounter(req.params.encounterId, req.user);

      if (encounter.status !== 'open') {
        return next(createError('Encounter is already closed', 400));
      }

      encounter.status = 'completed';
      encounter.completedAt = new Date();
      await encounter.save();

      return res.status(200).json({ encounter });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
