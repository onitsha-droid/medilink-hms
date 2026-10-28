'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Clinic } = require('../models/Clinic');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

const clinicRules = [
  body('name').trim().notEmpty().withMessage('Clinic name is required')
    .isLength({ max: 100 }).withMessage('Name too long'),
  body('description').optional().trim().isLength({ max: 300 }),
  body('avgConsultationMinutes').optional().isInt({ min: 1 })
    .withMessage('avgConsultationMinutes must be a positive integer'),
];

// ── POST /clinics — Admin only ────────────────────────────────────────────────
router.post(
  '/',
  authorize('Admin'),
  clinicRules,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { name, description, avgConsultationMinutes } = req.body;
      const clinic = await Clinic.create({ name, description, avgConsultationMinutes });
      return res.status(201).json({ clinic });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /clinics — any authenticated user ─────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const clinics = await Clinic.find({ isActive: true }).lean();
    return res.status(200).json({ clinics });
  } catch (err) {
    return next(err);
  }
});

// ── GET /clinics/:id ──────────────────────────────────────────────────────────
router.get(
  '/:id',
  param('id').isMongoId().withMessage('Invalid clinic ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const clinic = await Clinic.findById(req.params.id).lean();
      if (!clinic) return next(createError('Clinic not found', 404));
      return res.status(200).json({ clinic });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /clinics/:id — Admin updates a clinic ───────────────────────────────
router.patch(
  '/:id',
  authorize('Admin'),
  [param('id').isMongoId(), ...clinicRules.map((r) => r.optional())],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const updates = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.avgConsultationMinutes !== undefined) {
        updates.avgConsultationMinutes = req.body.avgConsultationMinutes;
      }
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

      const clinic = await Clinic.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true },
      );
      if (!clinic) return next(createError('Clinic not found', 404));
      return res.status(200).json({ clinic });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
