'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { Invoice } = require('../models/Invoice');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

// ── POST /invoices — create a manual invoice (Billing Officer / Admin) ─────────
// Auto-generation from lab/prescription is handled in those routes.
router.post(
  '/',
  authorize('Billing Officer', 'Admin'),
  [
    body('patientId').isMongoId().withMessage('patientId must be a valid Mongo ID'),
    body('encounterId').optional().isMongoId(),
    body('lineItems').isArray({ min: 1 }).withMessage('At least one line item is required'),
    body('lineItems.*.description').trim().notEmpty(),
    body('lineItems.*.amountKobo').isInt({ min: 0 }),
    body('lineItems.*.itemType').optional().isIn(['consultation', 'lab', 'prescription', 'other']),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { patientId, encounterId, lineItems } = req.body;

      const invoice = new Invoice({
        patient: patientId,
        encounter: encounterId,
        lineItems,
        issuedBy: req.user.id,
      });
      await invoice.save(); // pre-save computes total

      return res.status(201).json({ invoice });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /invoices — list invoices (Billing Officer, Admin) ─────────────────────
router.get(
  '/',
  authorize('Billing Officer', 'Admin'),
  [
    query('status').optional().isIn(['pending', 'paid', 'cancelled']),
    query('patientId').optional().isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res, next) => {
    try {
      const { status, patientId, page = 1, limit = 20 } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (patientId) filter.patient = patientId;

      const skip = (Number(page) - 1) * Number(limit);

      const [invoices, total] = await Promise.all([
        Invoice.find(filter)
          .populate('patient', 'firstName lastName hospitalId')
          .populate('issuedBy', 'name role')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        Invoice.countDocuments(filter),
      ]);

      return res.status(200).json({
        invoices,
        pagination: { total, page: Number(page), limit: Number(limit) },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /invoices/my — Patient's own invoices ──────────────────────────────────
router.get(
  '/my',
  authorize('Patient'),
  async (req, res, next) => {
    try {
      // We cannot resolve Patient._id from User._id without a join here.
      // The client must pass their patientId as a query param (set at login).
      const { patientId } = req.query;
      if (!patientId) {
        return next(createError('patientId query parameter is required', 400));
      }

      const invoices = await Invoice.find({ patient: patientId })
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({ invoices });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /invoices/:id — single invoice ────────────────────────────────────────
router.get(
  '/:id',
  authorize('Billing Officer', 'Admin', 'Patient'),
  param('id').isMongoId().withMessage('Invalid invoice ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.params.id)
        .populate('patient', 'firstName lastName hospitalId')
        .populate('issuedBy', 'name role')
        .populate('adjustments.adjustedBy', 'name role')
        .lean();

      if (!invoice) return next(createError('Invoice not found', 404));

      return res.status(200).json({ invoice });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /invoices/:id/adjust — Billing Officer adds adjustment with audit note
router.patch(
  '/:id/adjust',
  authorize('Billing Officer', 'Admin'),
  [
    param('id').isMongoId(),
    body('deltaKobo')
      .isInt()
      .withMessage('deltaKobo must be an integer (positive=increase, negative=discount)'),
    body('reason').trim().notEmpty().withMessage('Adjustment reason is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return next(createError('Invoice not found', 404));
      if (invoice.status !== 'pending') {
        return next(createError('Only pending invoices can be adjusted', 400));
      }

      invoice.adjustments.push({
        adjustedBy: req.user.id,
        deltaKobo: req.body.deltaKobo,
        reason: req.body.reason,
      });
      await invoice.save(); // pre-save recomputes total

      return res.status(200).json({ invoice });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /invoices/:id/cancel ──────────────────────────────────────────────────
router.post(
  '/:id/cancel',
  authorize('Billing Officer', 'Admin'),
  param('id').isMongoId(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return next(createError('Invoice not found', 404));
      if (invoice.status !== 'pending') {
        return next(createError('Only pending invoices can be cancelled', 400));
      }

      invoice.status = 'cancelled';
      await invoice.save();

      return res.status(200).json({ invoice });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
