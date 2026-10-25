'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { Patient } = require('../models/Patient');
const {
  checkIn,
  markUrgent,
  getQueueSnapshot,
} = require('../services/queueService');

const router = express.Router();
router.use(authenticate);

// ── POST /queue/check-in — Front Desk assigns patient to a clinic queue ────────
router.post(
  '/check-in',
  authorize('Front Desk', 'Admin'),
  [
    body('patientId').isMongoId().withMessage('Valid patient ID required'),
    body('clinicId').isMongoId().withMessage('Valid clinic ID required'),
    body('appointmentId').optional().isMongoId(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { patientId, clinicId, appointmentId } = req.body;

      const patient = await Patient.findById(patientId).lean();
      if (!patient) return next(createError('Patient not found', 404));

      const result = await checkIn({
        clinicId,
        patientId,
        appointmentId,
        checkedInBy: req.user.id,
      });

      // Broadcast queue update via Socket.IO (injected by app)
      const io = req.app.get('io');
      if (io) {
        const snapshot = await getQueueSnapshot(clinicId);
        io.to(`clinic:${clinicId}`).emit('queue:update', { clinicId, queue: snapshot });
        io.to(`patient:${patientId}`).emit('queue:position', {
          position: result.position,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          clinicId,
        });
      }

      return res.status(201).json({
        entry: result.entry,
        position: result.position,
        estimatedWaitMinutes: result.estimatedWaitMinutes,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /queue/:entryId/urgent — Nurse flags an entry as urgent ───────────────
router.post(
  '/:entryId/urgent',
  authorize('Nurse'),
  [
    param('entryId').isMongoId().withMessage('Invalid entry ID'),
    body('reason').optional().trim().isLength({ max: 300 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const entry = await markUrgent(
        req.params.entryId,
        req.user.id,
        req.body.reason,
      );

      // Broadcast re-prioritized queue
      const io = req.app.get('io');
      if (io) {
        const snapshot = await getQueueSnapshot(entry.clinic.toString());
        io.to(`clinic:${entry.clinic}`).emit('queue:update', {
          clinicId: entry.clinic,
          queue: snapshot,
        });
        io.to(`patient:${entry.patient._id}`).emit('queue:urgent', {
          message: 'You have been marked as urgent and moved to the front of the queue.',
        });
      }

      return res.status(200).json({ entry });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /queue/:clinicId — current ordered queue snapshot ─────────────────────
router.get(
  '/:clinicId',
  authorize('Front Desk', 'Admin', 'Nurse', 'Doctor'),
  param('clinicId').isMongoId().withMessage('Invalid clinic ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const snapshot = await getQueueSnapshot(req.params.clinicId);
      return res.status(200).json({ queue: snapshot });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
