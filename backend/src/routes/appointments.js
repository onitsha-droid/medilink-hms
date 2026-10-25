'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const { Appointment } = require('../models/Appointment');
const { Patient } = require('../models/Patient');
const { Clinic } = require('../models/Clinic');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

/** Normalize a Date to midnight UTC so day-level uniqueness works. */
function toMidnightUTC(dateInput) {
  const d = new Date(dateInput);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const appointmentRules = [
  body('patientId').isMongoId().withMessage('Valid patient ID required'),
  body('clinicId').isMongoId().withMessage('Valid clinic ID required'),
  body('scheduledDate')
    .isISO8601()
    .withMessage('Valid scheduled date required (ISO 8601)'),
  body('notes').optional().trim().isLength({ max: 500 }),
];

// ── POST /appointments ────────────────────────────────────────────────────────
router.post(
  '/',
  authorize('Patient', 'Front Desk', 'Admin'),
  appointmentRules,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(createError(errors.array()[0].msg, 400));
      }

      const { patientId, clinicId, scheduledDate, notes } = req.body;
      const type = req.user.role === 'Patient' ? 'online' : 'walk_in';
      const scheduledDateUTC = toMidnightUTC(scheduledDate);

      // Use withTransaction which handles session lifecycle and retries
      let createdAppointment = null;
      let operationalError = null;

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const [patient, clinic] = await Promise.all([
            Patient.findById(patientId).session(session),
            Clinic.findById(clinicId).session(session),
          ]);

          if (!patient) {
            operationalError = createError('Patient not found', 404);
            return; // withTransaction will abort on thrown errors only; we handle this below
          }
          if (!clinic || !clinic.isActive) {
            operationalError = createError('Clinic not found or inactive', 404);
            return;
          }

          const existing = await Appointment.findOne({
            patient: patientId,
            clinic: clinicId,
            scheduledDate: scheduledDateUTC,
            status: 'scheduled',
          }).session(session);

          if (existing) {
            operationalError = createError(
              'Patient already has a scheduled appointment at this clinic on this date',
              409,
            );
            return;
          }

          if (operationalError) return;

          const [appt] = await Appointment.create(
            [
              {
                patient: patientId,
                clinic: clinicId,
                scheduledDate: scheduledDateUTC,
                type,
                notes,
                createdBy: req.user.id,
                status: 'scheduled',
              },
            ],
            { session },
          );
          createdAppointment = appt;
        });
      } finally {
        session.endSession();
      }

      if (operationalError) return next(operationalError);

      await createdAppointment.populate(['patient', 'clinic']);
      return res.status(201).json({ appointment: createdAppointment });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /appointments ─────────────────────────────────────────────────────────
router.get(
  '/',
  authorize('Patient', 'Front Desk', 'Admin', 'Nurse', 'Doctor'),
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.clinicId) filter.clinic = req.query.clinicId;
      if (req.query.patientId) filter.patient = req.query.patientId;
      if (req.query.date) filter.scheduledDate = toMidnightUTC(req.query.date);
      if (req.query.status) filter.status = req.query.status;

      const appointments = await Appointment.find(filter)
        .populate('patient', 'firstName lastName hospitalId')
        .populate('clinic', 'name')
        .sort({ scheduledDate: 1 })
        .lean();

      return res.status(200).json({ appointments });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /appointments/:id ─────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('Patient', 'Front Desk', 'Admin', 'Nurse', 'Doctor'),
  param('id').isMongoId().withMessage('Invalid appointment ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(createError(errors.array()[0].msg, 400));
      }
      const appointment = await Appointment.findById(req.params.id)
        .populate('patient', 'firstName lastName hospitalId phone')
        .populate('clinic', 'name');

      if (!appointment) return next(createError('Appointment not found', 404));
      return res.status(200).json({ appointment });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
