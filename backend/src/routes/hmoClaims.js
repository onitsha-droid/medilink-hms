'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { HmoClaim } = require('../models/HmoClaim');
const { Invoice } = require('../models/Invoice');
const { Patient } = require('../models/Patient');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { submitHmoClaim } = require('../services/hmoService');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// ── POST /hmo-claims — Billing Officer submits a claim ────────────────────────
router.post(
  '/',
  authorize('Billing Officer', 'Admin'),
  [
    body('invoiceId').isMongoId().withMessage('invoiceId must be a valid Mongo ID'),
    body('serviceCode')
      .isInt({ min: 1 })
      .withMessage('serviceCode must be a positive integer'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { invoiceId, serviceCode } = req.body;

      // ── Check for existing claim first (idempotency) ───────────────────
      const existing = await HmoClaim.findOne({ invoice: invoiceId }).lean();
      if (existing) {
        return res.status(200).json({ claim: existing, alreadySubmitted: true });
      }

      // ── Load invoice + patient ─────────────────────────────────────────
      const invoice = await Invoice.findById(invoiceId).lean();
      if (!invoice) return next(createError('Invoice not found', 404));
      if (invoice.status === 'paid') {
        return next(createError('Invoice is already fully paid', 400));
      }
      if (invoice.status === 'cancelled') {
        return next(createError('Cannot claim on a cancelled invoice', 400));
      }

      // ── Resolve pseudonymous policy ID from patient HMO record ─────────
      const patient = await Patient.findById(invoice.patient).lean();
      if (!patient) return next(createError('Patient not found for this invoice', 404));

      const policyId = patient.hmo?.memberNumber || patient.nhiaNumber;
      if (!policyId) {
        return next(
          createError(
            'Patient has no HMO member number or NHIA number on record. ' +
              'Update the patient record before submitting a claim.',
            400,
          ),
        );
      }

      // ── Submit to Soroban contract ─────────────────────────────────────
      let contractResult;
      try {
        contractResult = await submitHmoClaim({
          invoiceId,
          policyId,
          serviceCode,
          amountKobo: invoice.totalKobo,
        });
      } catch (sorobanErr) {
        logger.error('Soroban contract call failed', { message: sorobanErr.message });
        // Route to manual review when contract is unreachable
        const claim = await HmoClaim.create({
          invoice: invoiceId,
          policyId,
          serviceCode,
          requestedAmountKobo: invoice.totalKobo,
          status: 'manual_review',
          reasonText: 'Soroban contract unreachable — manual review required',
          submittedBy: req.user.id,
        });
        return res.status(202).json({ claim, manualReview: true });
      }

      // ── Determine final status ─────────────────────────────────────────
      // reasonCode 1003 (over-limit) → partially_paid (approved for partial amount)
      // reasonCode 1002/1001/1005 → rejected
      // Ambiguous (reasonCode 1003 with payout > 0) → partially_paid
      let status;
      if (contractResult.status === 'approved') {
        status = 'approved';
      } else if (contractResult.reasonCode === 1003) {
        // Over-limit — route to manual review for Billing Officer decision
        status = 'manual_review';
      } else {
        status = 'rejected';
      }

      // ── Persist claim record ───────────────────────────────────────────
      const claim = await HmoClaim.create({
        invoice: invoiceId,
        policyId,
        serviceCode,
        requestedAmountKobo: invoice.totalKobo,
        payoutAmountKobo: contractResult.payoutAmountKobo,
        status,
        reasonCode: contractResult.reasonCode,
        reasonText: contractResult.reasonText,
        stellarTxHash: contractResult.txHash,
        submittedBy: req.user.id,
      });

      // ── If approved, mark invoice paid ─────────────────────────────────
      if (status === 'approved') {
        await Invoice.findByIdAndUpdate(invoiceId, {
          $set: {
            status: 'paid',
            paymentMethod: 'fiat', // HMO payout is treated as fiat settlement
            paidAt: new Date(),
          },
        });
      }

      return res.status(201).json({ claim });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /hmo-claims — list claims (Billing Officer, Admin) ────────────────────
router.get(
  '/',
  authorize('Billing Officer', 'Admin'),
  [
    query('status')
      .optional()
      .isIn(['pending', 'approved', 'partially_paid', 'rejected', 'manual_review'])
      .withMessage('Invalid status'),
    query('invoiceId').optional().isMongoId().withMessage('Invalid invoice ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be an integer >= 1'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { status, invoiceId, page = 1, limit = 20 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (invoiceId) filter.invoice = invoiceId;

      const skip = (Number(page) - 1) * Number(limit);
      const [claims, total] = await Promise.all([
        HmoClaim.find(filter)
          .populate('invoice', 'totalKobo status receiptNumber')
          .populate('submittedBy', 'name role')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        HmoClaim.countDocuments(filter),
      ]);

      return res.status(200).json({
        claims,
        pagination: { total, page: Number(page), limit: Number(limit) },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /hmo-claims/:id ───────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('Billing Officer', 'Admin', 'Patient'),
  param('id').isMongoId().withMessage('Invalid claim ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const claim = await HmoClaim.findById(req.params.id)
        .populate('invoice', 'totalKobo status patient')
        .populate('submittedBy', 'name role')
        .lean();

      if (!claim) return next(createError('HMO claim not found', 404));
      return res.status(200).json({ claim });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /hmo-claims/:id/resolve — Billing Officer resolves manual review ────
router.patch(
  '/:id/resolve',
  authorize('Billing Officer', 'Admin'),
  [
    param('id').isMongoId().withMessage('Invalid claim ID'),
    body('resolution')
      .isIn(['approved', 'rejected'])
      .withMessage('resolution must be approved or rejected'),
    body('note').optional().trim().isLength({ max: 300 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const claim = await HmoClaim.findById(req.params.id);
      if (!claim) return next(createError('HMO claim not found', 404));
      if (claim.status !== 'manual_review') {
        return next(createError('Only manual_review claims can be resolved here', 400));
      }

      claim.status = req.body.resolution;
      if (req.body.note) claim.reasonText = req.body.note;
      await claim.save();

      if (req.body.resolution === 'approved') {
        await Invoice.findByIdAndUpdate(claim.invoice, {
          $set: { status: 'paid', paymentMethod: 'fiat', paidAt: new Date() },
        });
      }

      return res.status(200).json({ claim });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
