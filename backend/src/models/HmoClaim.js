'use strict';

const mongoose = require('mongoose');

/**
 * HmoClaim — records an NHIA/HMO claim submitted via the Soroban contract.
 *
 * Privacy rules:
 *   - No patient identity stored here. Only pseudonymous policy IDs (opaque
 *     strings), invoice references, and numeric service codes.
 *   - The on-chain ref_id is the invoice MongoDB ObjectId, used as opaque bytes.
 *
 * Status machine:
 *   pending → approved | partially_paid | rejected | manual_review
 */
const hmoClaimSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    // Pseudonymous policy ID from the patient's HMO record (not a real patient ID)
    policyId: {
      type: String,
      required: [true, 'policyId is required'],
      trim: true,
      maxlength: 64,
    },
    // Numeric service code (ICD-10-style, e.g. 1001 = "outpatient consultation")
    serviceCode: {
      type: Number,
      required: [true, 'serviceCode is required'],
      min: 1,
    },
    // Amount requested in kobo
    requestedAmountKobo: {
      type: Number,
      required: true,
      min: 0,
    },
    // Approved payout amount from the contract (0 if rejected)
    payoutAmountKobo: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'partially_paid', 'rejected', 'manual_review'],
      default: 'pending',
      index: true,
    },
    // Soroban contract rejection reason code (0 if approved)
    reasonCode: {
      type: Number,
      default: 0,
    },
    // Human-readable reason mapped from reasonCode
    reasonText: {
      type: String,
      trim: true,
    },
    // Stellar transaction hash from the on-chain submission
    stellarTxHash: {
      type: String,
      trim: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

const HmoClaim = mongoose.model('HmoClaim', hmoClaimSchema);

module.exports = { HmoClaim };
