'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Patient } = require('../models/Patient');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();

// All patient routes require authentication
router.use(authenticate);

// ── Validation helpers ────────────────────────────────────────────────────────
const createPatientRules = [
  body('firstName').trim().notEmpty().withMessage('First name is required')
    .isLength({ max: 60 }).withMessage('First name too long'),
  body('lastName').trim().notEmpty().withMessage('Last name is required')
    .isLength({ max: 60 }).withMessage('Last name too long'),
  body('dateOfBirth').isISO8601().withMessage('Valid date of birth required (ISO 8601)'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Gender must be male, female, or other'),
  body('phone').trim().notEmpty().withMessage('Phone is required')
    .matches(/^\+?[\d\s\-().]{7,20}$/).withMessage('Phone number is invalid'),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('hmo.provider').optional().isString(),
  body('hmo.memberNumber').optional().isString(),
  body('hmo.planType').optional().isString(),
  body('nhiaNumber').optional().isString(),
  body('address.street').optional().isString(),
  body('address.city').optional().isString(),
  body('address.state').optional().isString(),
];

// ── POST /patients — register a new patient ───────────────────────────────────
router.post(
  '/',
  authorize('Front Desk', 'Admin'),
  createPatientRules,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(createError(errors.array()[0].msg, 400));
      }

      const {
        firstName, lastName, dateOfBirth, gender, phone, email,
        hmo, nhiaNumber, address,
      } = req.body;

      const patient = await Patient.create({
        firstName,
        lastName,
        dateOfBirth,
        gender,
        phone,
        email,
        hmo,
        nhiaNumber,
        address,
        registeredBy: req.user.id,
      });

      return res.status(201).json({
        patient: {
          id: patient._id,
          hospitalId: patient.hospitalId,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          phone: patient.phone,
          email: patient.email,
          hmo: patient.hmo,
          nhiaNumber: patient.nhiaNumber,
          address: patient.address,
          qrPayload: patient.qrPayload(),
          createdAt: patient.createdAt,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /patients/by-hospital-id/:hospitalId — look up by QR scan ────────────
router.get(
  '/by-hospital-id/:hospitalId',
  authorize('Front Desk', 'Admin', 'Nurse', 'Doctor'),
  param('hospitalId')
    .trim()
    .matches(/^ML-[A-F0-9]{8}$/)
    .withMessage('Invalid hospital ID format'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(createError(errors.array()[0].msg, 400));
      }

      const patient = await Patient.findOne({
        hospitalId: req.params.hospitalId,
        isActive: true,
      }).lean();

      if (!patient) return next(createError('Patient not found', 404));

      return res.status(200).json({
        patient: {
          id: patient._id,
          hospitalId: patient.hospitalId,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          phone: patient.phone,
          email: patient.email,
          hmo: patient.hmo,
          nhiaNumber: patient.nhiaNumber,
          address: patient.address,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /patients/:id — get by Mongo ID ───────────────────────────────────────
router.get(
  '/:id',
  authorize('Front Desk', 'Admin', 'Nurse', 'Doctor', 'Billing Officer'),
  param('id').isMongoId().withMessage('Invalid patient ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(createError(errors.array()[0].msg, 400));
      }

      const patient = await Patient.findById(req.params.id).lean();
      if (!patient) return next(createError('Patient not found', 404));

      return res.status(200).json({ patient });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
