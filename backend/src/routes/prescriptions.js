'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Prescription } = require('../models/Prescription');
const { Encounter } = require('../models/Encounter');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { emitRecordAccessed } = require('../services/recordAudit');

const router = express.Router();
router.use(authenticate);

// Allowed frequency values (kept in sync with the Prescription model)
const FREQUENCIES = [
  'once daily', 'twice daily', 'three times daily', 'four times daily',
  'every 6 hours', 'every 8 hours', 'every 12 hours',
  'as needed', 'stat', 'weekly', 'other',
];

const drugRules = [
  body('drugs').isArray({ min: 1 }).withMessage('At least one drug is required'),
  body('drugs.*.drugName').trim().notEmpty().withMessage('drugName is required'),
  body('drugs.*.dose').trim().notEmpty().withMessage('dose is required'),
  body('drugs.*.frequency')
    .isIn(FREQUENCIES)
    .withMessage(`frequency must be one of: ${FREQUENCIES.join(', ')}`),
  body('drugs.*.duration').trim().notEmpty().withMessage('duration is required'),
  body('drugs.*.quantity').isInt({ min: 1 }).withMessage('quantity must be ≥ 1'),
  body('drugs.*.unitPriceKobo').optional().isInt({ min: 0 }),
  body('drugs.*.instructions').optional().trim().isLength({ max: 300 }),
];

// ── POST /prescriptions — Doctor issues a prescription ────────────────────────
router.post(
  '/',
  authorize('Doctor'),
  [
    body('encounterId').isMongoId().withMessage('encounterId must be a valid Mongo ID'),
    body('notes').optional().trim().isLength({ max: 500 }),
    ...drugRules,
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { encounterId, drugs, notes } = req.body;

      const encounter = await Encounter.findById(encounterId);
      if (!encounter) return next(createError('Encounter not found', 404));
      if (encounter.doctor.toString() !== req.user.id) {
        return next(createError('You are not the treating doctor for this encounter', 403));
      }
      if (encounter.status !== 'open') {
        return next(createError('Cannot create prescription for a closed encounter', 400));
      }

      const prescription = await Prescription.create({
        encounter: encounterId,
        patient: encounter.patient,
        prescribedBy: req.user.id,
        drugs,
        notes,
        status: 'sent',
      });

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId: encounter.patient.toString(),
        action: 'write:prescription',
        encounterId,
      });

      return res.status(201).json({ prescription });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /prescriptions/inbox — Pharmacist inbox: 'sent' prescriptions ─────────
router.get(
  '/inbox',
  authorize('Pharmacist', 'Admin'),
  async (req, res, next) => {
    try {
      const prescriptions = await Prescription.find({ status: 'sent' })
        .populate('patient', 'firstName lastName hospitalId dateOfBirth')
        .populate('prescribedBy', 'name role')
        .populate('encounter', 'chiefComplaint createdAt')
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({ prescriptions });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /prescriptions/by-encounter/:encounterId ───────────────────────────────
router.get(
  '/by-encounter/:encounterId',
  authorize('Doctor', 'Nurse', 'Pharmacist', 'Admin', 'Patient'),
  param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const prescriptions = await Prescription.find({ encounter: req.params.encounterId })
        .populate('prescribedBy', 'name role')
        .populate('dispensedBy', 'name role')
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({ prescriptions });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /prescriptions/:id ─────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('Doctor', 'Nurse', 'Pharmacist', 'Admin', 'Patient'),
  param('id').isMongoId().withMessage('Invalid prescription ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const prescription = await Prescription.findById(req.params.id)
        .populate('patient', 'firstName lastName hospitalId')
        .populate('prescribedBy', 'name role')
        .populate('dispensedBy', 'name role')
        .lean();

      if (!prescription) return next(createError('Prescription not found', 404));
      return res.status(200).json({ prescription });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
