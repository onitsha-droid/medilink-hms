'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Vitals } = require('../models/Vitals');
const { QueueEntry } = require('../models/QueueEntry');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { markUrgent, getQueueSnapshot } = require('../services/queueService');

const router = express.Router();
router.use(authenticate);

// ── Validation rules ──────────────────────────────────────────────────────────
const vitalsRules = [
  param('queueEntryId').isMongoId().withMessage('Invalid queue entry ID'),
  body('bpSystolic').optional().isFloat({ min: 50, max: 300 })
    .withMessage('bpSystolic must be 50–300'),
  body('bpDiastolic').optional().isFloat({ min: 20, max: 200 })
    .withMessage('bpDiastolic must be 20–200'),
  body('spo2').optional().isFloat({ min: 50, max: 100 })
    .withMessage('SpO2 must be 50–100'),
  body('weightKg').optional().isFloat({ min: 0.5, max: 500 })
    .withMessage('Weight must be 0.5–500 kg'),
  body('temperatureCelsius').optional().isFloat({ min: 30, max: 45 })
    .withMessage('Temperature must be 30–45°C'),
  body('heartRateBpm').optional().isFloat({ min: 20, max: 300 })
    .withMessage('Heart rate must be 20–300 bpm'),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('isUrgent').optional().isBoolean(),
  body('urgentReason').optional().trim().isLength({ max: 300 }),
];

// ── POST /vitals/:queueEntryId — Nurse records vitals for a queue slot ────────
router.post(
  '/:queueEntryId',
  authorize('Nurse'),
  vitalsRules,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const queueEntry = await QueueEntry.findById(req.params.queueEntryId);
      if (!queueEntry) return next(createError('Queue entry not found', 404));

      const {
        bpSystolic, bpDiastolic, spo2, weightKg,
        temperatureCelsius, heartRateBpm, notes,
        isUrgent: manualUrgent, urgentReason,
      } = req.body;

      const vitals = new Vitals({
        queueEntry: queueEntry._id,
        patient: queueEntry.patient,
        recordedBy: req.user.id,
        bpSystolic,
        bpDiastolic,
        spo2,
        weightKg,
        temperatureCelsius,
        heartRateBpm,
        notes,
        isUrgent: manualUrgent,
        urgentReason,
      });

      await vitals.save(); // pre-save auto-flag runs here

      // If urgent (auto or manual), re-prioritize in the queue
      if (vitals.isUrgent && !queueEntry.isUrgent) {
        await markUrgent(
          queueEntry._id.toString(),
          req.user.id,
          vitals.urgentReason,
        );

        // Broadcast queue update and patient notification
        const io = req.app.get('io');
        if (io) {
          const snapshot = await getQueueSnapshot(queueEntry.clinic.toString());
          io.to(`clinic:${queueEntry.clinic}`).emit('queue:update', {
            clinicId: queueEntry.clinic,
            queue: snapshot,
          });
          io.to(`patient:${queueEntry.patient}`).emit('queue:urgent', {
            message: 'Your case has been flagged as urgent.',
          });
        }
      }

      return res.status(201).json({ vitals });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /vitals/by-entry/:queueEntryId ────────────────────────────────────────
router.get(
  '/by-entry/:queueEntryId',
  authorize('Nurse', 'Doctor', 'Admin'),
  param('queueEntryId').isMongoId().withMessage('Invalid queue entry ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const vitals = await Vitals.findOne({
        queueEntry: req.params.queueEntryId,
      }).populate('recordedBy', 'name role');

      if (!vitals) return next(createError('Vitals not found for this entry', 404));
      return res.status(200).json({ vitals });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /vitals/triage-queue/:clinicId — Nurse's triage list ─────────────────
// Returns today's queue entries that have NOT yet had vitals recorded.
router.get(
  '/triage-queue/:clinicId',
  authorize('Nurse', 'Admin'),
  param('clinicId').isMongoId().withMessage('Invalid clinic ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const snapshot = await getQueueSnapshot(req.params.clinicId);

      // Annotate each entry with whether vitals have been recorded
      const entryIds = snapshot.map((s) => s.entry._id);
      const recordedVitals = await Vitals.find({
        queueEntry: { $in: entryIds },
      }).select('queueEntry').lean();

      const recordedSet = new Set(
        recordedVitals.map((v) => v.queueEntry.toString()),
      );

      const triageQueue = snapshot.map((s) => ({
        ...s,
        vitalsRecorded: recordedSet.has(s.entry._id.toString()),
      }));

      return res.status(200).json({ triageQueue });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
