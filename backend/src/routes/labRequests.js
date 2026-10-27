'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { LabRequest } = require('../models/LabRequest');
const { Encounter } = require('../models/Encounter');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { emitRecordAccessed } = require('../services/recordAudit');

const router = express.Router();
router.use(authenticate);

// ── POST /lab-requests — Doctor creates a lab request ─────────────────────────
router.post(
  '/',
  authorize('Doctor'),
  [
    body('encounterId').isMongoId().withMessage('encounterId must be a valid Mongo ID'),
    body('tests').isArray({ min: 1 }).withMessage('At least one test is required'),
    body('tests.*.name').trim().notEmpty().withMessage('Each test must have a name'),
    body('tests.*.unitPriceKobo').optional().isInt({ min: 0 }),
    body('urgency').optional().isIn(['routine', 'urgent', 'stat']),
    body('clinicalNote').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { encounterId, tests, urgency, clinicalNote } = req.body;

      const encounter = await Encounter.findById(encounterId);
      if (!encounter) return next(createError('Encounter not found', 404));
      if (encounter.doctor.toString() !== req.user.id) {
        return next(createError('You are not the treating doctor for this encounter', 403));
      }
      if (encounter.status !== 'open') {
        return next(createError('Cannot create lab request for a closed encounter', 400));
      }

      const labRequest = await LabRequest.create({
        encounter: encounterId,
        patient: encounter.patient,
        requestedBy: req.user.id,
        tests,
        urgency,
        clinicalNote,
      });

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId: encounter.patient.toString(),
        action: 'write:lab_request',
        encounterId,
      });

      return res.status(201).json({ labRequest });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /lab-requests/worklist — Lab Scientist sees only PAID requests ─────────
router.get(
  '/worklist',
  authorize('Lab Scientist', 'Admin'),
  async (req, res, next) => {
    try {
      const labRequests = await LabRequest.find({ status: 'paid' })
        .populate('patient', 'firstName lastName hospitalId dateOfBirth')
        .populate('requestedBy', 'name role')
        .populate('encounter', 'chiefComplaint createdAt')
        .sort({ createdAt: 1 })
        .lean();

      // Sort stat → urgent → routine within the result set
      const urgencyOrder = { stat: 0, urgent: 1, routine: 2 };
      labRequests.sort(
        (a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2),
      );

      return res.status(200).json({ labRequests });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /lab-requests/by-encounter/:encounterId ────────────────────────────────
router.get(
  '/by-encounter/:encounterId',
  authorize('Doctor', 'Nurse', 'Lab Scientist', 'Admin', 'Patient'),
  param('encounterId').isMongoId().withMessage('Invalid encounter ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const labRequests = await LabRequest.find({ encounter: req.params.encounterId })
        .populate('requestedBy', 'name role')
        .populate('assignedTo', 'name role')
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({ labRequests });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /lab-requests/:id/pick-up — Lab Scientist picks up a paid request ────
router.patch(
  '/:id/pick-up',
  authorize('Lab Scientist'),
  param('id').isMongoId().withMessage('Invalid lab request ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const labRequest = await LabRequest.findById(req.params.id);
      if (!labRequest) return next(createError('Lab request not found', 404));
      if (labRequest.status !== 'paid') {
        return next(createError('Only paid requests can be picked up', 400));
      }

      labRequest.status = 'in_progress';
      labRequest.assignedTo = req.user.id;
      await labRequest.save();

      return res.status(200).json({ labRequest });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /lab-requests/:id/results — Lab Scientist enters results ──────────────
router.post(
  '/:id/results',
  authorize('Lab Scientist'),
  [
    param('id').isMongoId().withMessage('Invalid lab request ID'),
    body('results').isArray({ min: 1 }).withMessage('At least one result is required'),
    body('results.*.testName').trim().notEmpty().withMessage('testName is required'),
    body('results.*.value').trim().notEmpty().withMessage('value is required'),
    body('results.*.unit').optional().trim().isLength({ max: 50 }),
    body('results.*.referenceRange').optional().trim().isLength({ max: 100 }),
    body('results.*.notes').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const labRequest = await LabRequest.findById(req.params.id);
      if (!labRequest) return next(createError('Lab request not found', 404));
      if (labRequest.status !== 'in_progress') {
        return next(
          createError('Request must be in_progress before results can be entered', 400),
        );
      }
      if (labRequest.assignedTo?.toString() !== req.user.id) {
        return next(createError('Only the assigned lab scientist may enter results', 403));
      }

      // Auto-flag abnormal values
      const processedResults = req.body.results.map((r) => {
        const result = { ...r };
        const numVal = parseFloat(result.value);
        if (!Number.isNaN(numVal) && result.referenceRange) {
          const flagInfo = flagAbnormal(numVal, result.referenceRange);
          result.isAbnormal = flagInfo.isAbnormal;
          result.abnormalFlag = flagInfo.flag;
        }
        return result;
      });

      labRequest.results = processedResults;
      labRequest.status = 'completed';
      labRequest.completedAt = new Date();
      labRequest.completedBy = req.user.id;
      await labRequest.save();

      // Broadcast to Doctor and Patient via Socket.IO
      const io = req.app.get('io');
      if (io) {
        const enc = await Encounter.findById(labRequest.encounter)
          .select('doctor patient')
          .lean();
        if (enc) {
          const payload = {
            labRequestId: labRequest._id.toString(),
            patientId: labRequest.patient.toString(),
            hasAbnormal: processedResults.some((r) => r.isAbnormal),
          };
          io.to(`doctor:${enc.doctor}`).emit('lab:results_ready', payload);
          io.to(`patient:${enc.patient}`).emit('lab:results_ready', payload);
        }
      }

      emitRecordAccessed(req.app.get('io'), {
        userId: req.user.id,
        patientId: labRequest.patient.toString(),
        action: 'write:lab_results',
        encounterId: labRequest.encounter?.toString(),
      });

      return res.status(200).json({ labRequest });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /lab-requests/:id ──────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('Doctor', 'Nurse', 'Lab Scientist', 'Admin', 'Patient'),
  param('id').isMongoId().withMessage('Invalid lab request ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const labRequest = await LabRequest.findById(req.params.id)
        .populate('patient', 'firstName lastName hospitalId')
        .populate('requestedBy', 'name role')
        .populate('assignedTo', 'name role')
        .lean();

      if (!labRequest) return next(createError('Lab request not found', 404));
      return res.status(200).json({ labRequest });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * flagAbnormal — derive an abnormal flag from a numeric value and a
 * reference-range string such as "3.5 - 5.0", ">60", or "<200".
 *
 * Exported for unit testing.
 *
 * @param {number} value
 * @param {string} rangeStr
 * @returns {{ isAbnormal: boolean, flag: string }}
 */
function flagAbnormal(value, rangeStr) {
  if (!rangeStr) return { isAbnormal: false, flag: '' };

  // "lo - hi" or "lo – hi"
  const rangeMatch = rangeStr.trim().match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    if (value < lo) return { isAbnormal: true, flag: value < lo * 0.7 ? 'LL' : 'L' };
    if (value > hi) return { isAbnormal: true, flag: value > hi * 1.3 ? 'HH' : 'H' };
    return { isAbnormal: false, flag: '' };
  }

  // ">N"
  const gtMatch = rangeStr.trim().match(/^>\s*([\d.]+)$/);
  if (gtMatch) {
    const threshold = parseFloat(gtMatch[1]);
    if (value <= threshold) return { isAbnormal: true, flag: 'L' };
    return { isAbnormal: false, flag: '' };
  }

  // "<N"
  const ltMatch = rangeStr.trim().match(/^<\s*([\d.]+)$/);
  if (ltMatch) {
    const threshold = parseFloat(ltMatch[1]);
    if (value >= threshold) return { isAbnormal: true, flag: 'H' };
    return { isAbnormal: false, flag: '' };
  }

  return { isAbnormal: false, flag: '' };
}

module.exports = router;
module.exports.flagAbnormal = flagAbnormal;
