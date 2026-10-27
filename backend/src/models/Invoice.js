'use strict';

const mongoose = require('mongoose');

/**
 * Invoice — aggregates billable line items for an Encounter.
 *
 * Line items are created by hooks in the lab-request and prescription routes
 * (Day 4+). Fiat payment is handled by Paystack; stablecoin by Stellar
 * (DEFERRED to blockchain sprint).
 *
 * Status machine:
 *   pending → paid | cancelled
 *
 * Adjustments are append-only audit entries; totals are recomputed from
 * line items after each adjustment.
 */
const lineItemSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: [true, 'Line item description is required'],
      trim: true,
      maxlength: 200,
    },
    amountKobo: {
      type: Number,
      required: [true, 'Line item amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    itemType: {
      type: String,
      enum: ['consultation', 'lab', 'prescription', 'other'],
      default: 'other',
    },
    // Reference to the source document (LabRequest, Prescription, etc.)
    sourceId: { type: mongoose.Schema.Types.ObjectId },
    sourceModel: { type: String, enum: ['LabRequest', 'Prescription', 'Encounter'] },
  },
  { _id: true },
);

const adjustmentSchema = new mongoose.Schema(
  {
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deltaKobo: {
      type: Number,
      required: true, // positive = increase, negative = discount
    },
    reason: {
      type: String,
      required: [true, 'Adjustment reason is required'],
      trim: true,
      maxlength: 300,
    },
    adjustedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const invoiceSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    encounter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Encounter',
      index: true,
    },
    lineItems: [lineItemSchema],
    adjustments: [adjustmentSchema],
    // Recomputed on save from lineItems + adjustments
    totalKobo: {
      type: Number,
      min: [0, 'Invoice total cannot be negative'],
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['fiat', 'stablecoin', null],
      default: null,
    },
    // Paystack payment reference (set when payment is initiated)
    paystackReference: { type: String, sparse: true, index: true },
    // Idempotency key for Paystack webhook (stores last processed event ID)
    lastWebhookEventId: { type: String },
    paidAt: { type: Date },
    receiptNumber: { type: String, sparse: true },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

// ── Recompute total before save ────────────────────────────────────────────────
invoiceSchema.pre('save', function recomputeTotal() {
  const lineTotal = this.lineItems.reduce((sum, item) => sum + item.amountKobo, 0);
  const adjustmentTotal = this.adjustments.reduce((sum, adj) => sum + adj.deltaKobo, 0);
  this.totalKobo = Math.max(0, lineTotal + adjustmentTotal);
});

// ── Generate receipt number on payment ───────────────────────────────────────
invoiceSchema.pre('save', function generateReceipt() {
  if (this.isModified('status') && this.status === 'paid' && !this.receiptNumber) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    this.receiptNumber = `RCP-${datePart}-${rand}`;
  }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

module.exports = { Invoice };
