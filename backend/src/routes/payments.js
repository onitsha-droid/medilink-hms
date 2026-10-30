'use strict';

const express = require('express');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { Invoice } = require('../models/Invoice');
const { Payment } = require('../models/Payment');
const { LabRequest } = require('../models/LabRequest');
const { Prescription } = require('../models/Prescription');
const stellar = require('../services/stellar');
const { authenticate, authorize } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { createError } = require('../middleware/errorHandler');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// ── POST /payments/initialize — Patient initiates Paystack payment ─────────────
router.post(
  '/initialize',
  paymentLimiter,
  authenticate,
  authorize('Patient', 'Billing Officer', 'Admin'),
  [
    body('invoiceId').isMongoId().withMessage('invoiceId must be a valid Mongo ID'),
    body('email').isEmail().withMessage('A valid email is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const { invoiceId, email } = req.body;

      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) return next(createError('Invoice not found', 404));
      if (invoice.status !== 'pending') {
        return next(createError(`Invoice is already ${invoice.status}`, 400));
      }
      if (invoice.totalKobo <= 0) {
        return next(createError('Invoice amount must be greater than zero', 400));
      }

      const paystackKey = config.paystack?.secretKey;
      if (!paystackKey) {
        return next(createError('Payment gateway not configured', 503));
      }

      // Generate a unique reference for this transaction
      const reference = `ML-${invoice._id}-${Date.now()}`;

      // Call Paystack initialize endpoint
      const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: invoice.totalKobo, // kobo
          reference,
          metadata: { invoiceId: invoiceId.toString() },
        }),
      });

      const paystackData = await paystackRes.json();

      if (!paystackData.status) {
        logger.error('Paystack initialize failed', paystackData);
        return next(createError('Payment initialization failed', 502));
      }

      // Persist the Paystack reference on the invoice
      invoice.paystackReference = paystackData.data.reference;
      await invoice.save();

      return res.status(200).json({
        authorizationUrl: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
        accessCode: paystackData.data.access_code,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /payments/webhook — Paystack webhook handler ─────────────────────────
// Mounted BEFORE express.json() in app.js so req.body is a raw Buffer.
// The route uses express.raw() here as a safety net for direct mounting,
// but app.js must ensure this route receives the raw body.
router.post(
  '/webhook',
  (req, res, next) => {
    // If body is already a Buffer (raw middleware ran), pass through.
    // Otherwise, collect raw bytes manually (fallback for test harness).
    if (Buffer.isBuffer(req.body)) return next();
    let data = Buffer.alloc(0);
    req.on('data', (chunk) => { data = Buffer.concat([data, chunk]); });
    req.on('end', () => { req.body = data; next(); });
  },
  async (req, res, next) => {
    try {
      const secret = config.paystack?.secretKey;
      if (!secret) {
        // Cannot verify; reject
        return res.status(400).json({ error: 'Webhook not configured' });
      }

      // ── Signature verification ────────────────────────────────────────────
      const signature = req.headers['x-paystack-signature'];
      const expectedSig = crypto
        .createHmac('sha512', secret)
        .update(req.body)
        .digest('hex');

      if (signature !== expectedSig) {
        logger.warn('Paystack webhook: invalid signature', { signature });
        return res.status(400).json({ error: 'Invalid signature' });
      }

      const event = JSON.parse(req.body.toString());

      // Acknowledge immediately — Paystack expects a 200 within 5 s
      res.status(200).json({ received: true });

      if (event.event !== 'charge.success') return; // ignore other events

      const { reference, id: gatewayEventId } = event.data;
      const amountKobo = event.data.amount;

      // ── Idempotency: skip duplicate events ────────────────────────────────
      const invoice = await Invoice.findOne({ paystackReference: reference });
      if (!invoice) {
        logger.warn('Paystack webhook: invoice not found for reference', { reference });
        return;
      }
      if (invoice.lastWebhookEventId === String(gatewayEventId)) {
        logger.info('Paystack webhook: duplicate event ignored', { gatewayEventId });
        return;
      }
      if (invoice.status === 'paid') {
        // Already paid, just update idempotency key
        invoice.lastWebhookEventId = String(gatewayEventId);
        await invoice.save();
        return;
      }

      // ── Mark invoice paid + create Payment record (transactional) ─────────
      const session = await mongoose.startSession();
      await session.withTransaction(async () => {
        invoice.status = 'paid';
        invoice.paymentMethod = 'fiat';
        invoice.paidAt = new Date();
        invoice.lastWebhookEventId = String(gatewayEventId);
        await invoice.save({ session });

        await Payment.create(
          [
            {
              invoice: invoice._id,
              patient: invoice.patient,
              amountKobo,
              method: 'fiat',
              reference,
              gatewayEventId: String(gatewayEventId),
              status: 'success',
              paidAt: new Date(),
            },
          ],
          { session },
        );

        // Unlock related LabRequests: requested → paid
        await LabRequest.updateMany(
          { invoice: invoice._id, status: 'requested' },
          { $set: { status: 'paid' } },
          { session },
        );

        // Unlock related Prescriptions: they stay 'sent' (payment gate is
        // checked at dispense time by reading invoice.status directly).
      });
      await session.endSession();

      logger.info('Paystack webhook: invoice paid', {
        invoiceId: invoice._id.toString(),
        reference,
      });
    } catch (err) {
      logger.error('Paystack webhook error', { message: err.message, stack: err.stack });
      // Do not call next(err) — Paystack has already received 200
    }
  },
);

// ── GET /payments/status/:invoiceId — Patient checks payment status ────────────
router.get(
  '/status/:invoiceId',
  authenticate,
  authorize('Patient', 'Billing Officer', 'Admin'),
  param('invoiceId').isMongoId().withMessage('Invalid invoice ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.params.invoiceId)
        .select('status paidAt totalKobo receiptNumber paymentMethod paystackReference')
        .lean();

      if (!invoice) return next(createError('Invoice not found', 404));
      return res.status(200).json({ invoice });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /payments/stablecoin/request — generate a USDC payment request ───────
// Patient (or Billing Officer) asks for the hospital wallet address + amount.
// No money moves here — this just returns the payment details.
router.post(
  '/stablecoin/request',
  paymentLimiter,
  authenticate,
  authorize('Patient', 'Billing Officer', 'Admin'),
  [body('invoiceId').isMongoId().withMessage('invoiceId must be a valid Mongo ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.body.invoiceId);
      if (!invoice) return next(createError('Invoice not found', 404));
      if (invoice.status !== 'pending') {
        return next(createError(`Invoice is already ${invoice.status}`, 400));
      }
      if (invoice.totalKobo <= 0) {
        return next(createError('Invoice amount must be greater than zero', 400));
      }

      let paymentRequest;
      try {
        paymentRequest = stellar.buildPaymentRequest(invoice);
      } catch (stellarErr) {
        logger.error('Stellar config error', { message: stellarErr.message });
        return next(createError('Stellar payment not configured on this server', 503));
      }

      return res.status(200).json({ paymentRequest });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /payments/stablecoin/confirm — poll Horizon and confirm payment ──────
// Idempotent: calling again on an already-paid invoice is a no-op.
router.post(
  '/stablecoin/confirm',
  paymentLimiter,
  authenticate,
  authorize('Patient', 'Billing Officer', 'Admin'),
  [body('invoiceId').isMongoId().withMessage('invoiceId must be a valid Mongo ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const invoice = await Invoice.findById(req.body.invoiceId);
      if (!invoice) return next(createError('Invoice not found', 404));

      // Idempotency: already paid via stablecoin
      if (invoice.status === 'paid' && invoice.paymentMethod === 'stablecoin') {
        return res.status(200).json({ invoice, alreadyPaid: true });
      }
      if (invoice.status === 'paid') {
        return next(createError('Invoice already paid via another method', 400));
      }
      if (invoice.status !== 'pending') {
        return next(createError(`Invoice is ${invoice.status}`, 400));
      }

      const expectedMemo = invoice._id.toString().slice(0, 28);
      const expectedUsdc = invoice.totalKobo / 100;

      let verifyResult;
      try {
        verifyResult = await stellar.verifyPaymentToHospital({
          expectedMemo,
          expectedUsdcAmount: expectedUsdc,
        });
      } catch (stellarErr) {
        logger.error('Horizon verification error', { message: stellarErr.message });
        return next(createError('Could not reach Stellar network to verify payment', 503));
      }

      if (!verifyResult.found) {
        return res.status(202).json({
          confirmed: false,
          message: 'Payment not yet detected on Horizon. Try again shortly.',
        });
      }

      // ── Mark paid + create Payment + unlock dependents (transaction) ──────
      const session = await mongoose.startSession();
      await session.withTransaction(async () => {
        // Re-check inside transaction to prevent race
        const fresh = await Invoice.findById(invoice._id).session(session);
        if (fresh.status === 'paid') return; // already handled

        fresh.status = 'paid';
        fresh.paymentMethod = 'stablecoin';
        fresh.paidAt = new Date();
        fresh.lastWebhookEventId = verifyResult.txHash; // reuse idempotency field
        await fresh.save({ session });

        await Payment.create(
          [
            {
              invoice: fresh._id,
              patient: fresh.patient,
              amountKobo: fresh.totalKobo,
              method: 'stablecoin',
              reference: verifyResult.txHash,
              gatewayEventId: verifyResult.txHash,
              status: 'success',
              paidAt: new Date(),
            },
          ],
          { session },
        );

        await LabRequest.updateMany(
          { invoice: fresh._id, status: 'requested' },
          { $set: { status: 'paid' } },
          { session },
        );
      });
      await session.endSession();

      const updated = await Invoice.findById(invoice._id).lean();
      return res.status(200).json({ confirmed: true, invoice: updated });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
