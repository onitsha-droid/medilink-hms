'use strict';

const mongoose = require('mongoose');

/**
 * AuditLog — immutable record of every record.accessed event.
 *
 * Privacy rules (README §Blockchain Design & Privacy):
 *   - hashPayload contains ONLY pseudonymous IDs (Mongo ObjectIds) + random
 *     salt + action string + timestamp. No names, diagnoses, or PHI.
 *   - The on-chain anchor is a SHA-256 hash of hashPayload only.
 *   - Tamper detection: re-compute hash from off-chain hashPayload and
 *     compare with the value in stellarTxHash's memo.
 *
 * anchorStatus machine:  pending → anchored | failed
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Pseudonymous IDs only — ObjectId strings, never real names
    userId:      { type: String, required: true, index: true },
    patientId:   { type: String, required: true, index: true },
    action:      { type: String, required: true, trim: true, maxlength: 100 },
    encounterId: { type: String, default: null },
    timestamp:   { type: Date,   required: true, default: Date.now },

    // Per-event random salt (32 hex chars) — prevents hash pre-computation
    salt:        { type: String, required: true },
    // Canonical string hashed: "<userId>|<patientId>|<action>|<ts>|<salt>"
    hashPayload: { type: String, required: true },
    // SHA-256 hex digest of hashPayload
    hash:        { type: String, required: true, index: true },

    // Stellar anchoring
    anchorStatus: {
      type: String,
      enum: ['pending', 'anchored', 'failed'],
      default: 'pending',
      index: true,
    },
    stellarTxHash: { type: String, sparse: true },
    anchorAttempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
module.exports = { AuditLog };
