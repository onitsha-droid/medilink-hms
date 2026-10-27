'use strict';

const mongoose = require('mongoose');

/**
 * Payment — records a completed payment event.
 *
 * One Payment document is created per successful Paystack webhook event.
 * The idempotency check lives on Invoice.lastWebhookEventId to prevent
 * double-counting duplicate webhook deliveries.
 */
const paymentSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    amountKobo: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [1, 'Payment amount must be positive'],
    },
    method: {
      type: String,
      enum: ['fiat', 'stablecoin'],
      required: true,
    },
    // Paystack reference / Stellar txHash
    reference: {
      type: String,
      required: [true, 'Payment reference is required'],
      trim: true,
    },
    // Gateway event id — used for idempotency
    gatewayEventId: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'refunded'],
      default: 'success',
    },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { Payment };
