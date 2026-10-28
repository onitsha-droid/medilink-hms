'use strict';

/**
 * auditService.js
 *
 * Consumes record.accessed events, persists AuditLog documents with a
 * SHA-256 hash over a canonical string (salted, pseudonymous IDs only),
 * and asynchronously anchors batches of hashes to the Stellar ledger.
 *
 * Privacy guarantee:
 *   - The canonical string hashed is:
 *       "<userId>|<patientId>|<action>|<isoTimestamp>|<salt>"
 *   - No names, clinical data, or PHI appear in hashPayload or on-chain.
 *   - salt is a fresh 16-byte random hex string per event.
 *
 * Anchor strategy:
 *   - A retryable job runs every ANCHOR_INTERVAL_MS, batches up to
 *     ANCHOR_BATCH_SIZE pending logs, and anchors each hash individually
 *     as a Stellar transaction memo.  Failures increment anchorAttempts and
 *     set anchorStatus='failed' after MAX_ATTEMPTS retries.
 */

const crypto = require('crypto');
const { AuditLog } = require('../models/AuditLog');
const stellar = require('./stellar');
const logger = require('../utils/logger');

const ANCHOR_INTERVAL_MS = 30_000; // 30 s between anchor sweeps
const ANCHOR_BATCH_SIZE  = 10;     // max logs anchored per sweep
const MAX_ATTEMPTS       = 3;      // give up after 3 Horizon failures

// ── Hash computation ──────────────────────────────────────────────────────────

/**
 * Build the canonical string and compute its SHA-256 hash.
 * Inputs are pseudonymous IDs only — no PHI.
 *
 * @returns {{ canonical: string, hash: string, salt: string }}
 */
function computeHash({ userId, patientId, action, timestamp, salt }) {
  const ts = timestamp instanceof Date
    ? timestamp.toISOString()
    : new Date(timestamp).toISOString();
  const canonical = `${userId}|${patientId}|${action}|${ts}|${salt}`;
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { canonical, hash, salt };
}

// ── Create an AuditLog from a record.accessed event ──────────────────────────

/**
 * @param {{ userId, patientId, action, encounterId?, timestamp? }} event
 * @returns {Promise<AuditLog>}
 */
async function createAuditLog(event) {
  const { userId, patientId, action, encounterId = null, timestamp = new Date() } = event;
  const salt = crypto.randomBytes(16).toString('hex');
  const { canonical, hash } = computeHash({ userId, patientId, action, timestamp, salt });

  const log = await AuditLog.create({
    userId,
    patientId,
    action,
    encounterId,
    timestamp,
    salt,
    hashPayload: canonical,
    hash,
  });

  return log;
}

// ── Verify a log entry against its anchor ────────────────────────────────────

/**
 * Recompute the hash from the stored hashPayload and confirm it matches
 * the stored hash.  Does NOT re-query Stellar — the txHash is stored in
 * the document for reference.
 *
 * @param {string} logId  AuditLog._id
 * @returns {{ valid: boolean, recomputedHash: string, storedHash: string }}
 */
async function verifyAuditLog(logId) {
  const log = await AuditLog.findById(logId).lean();
  if (!log) throw Object.assign(new Error('Audit log not found'), { statusCode: 404 });

  const recomputedHash = crypto
    .createHash('sha256')
    .update(log.hashPayload)
    .digest('hex');

  return {
    valid: recomputedHash === log.hash,
    recomputedHash,
    storedHash: log.hash,
    anchorStatus: log.anchorStatus,
    stellarTxHash: log.stellarTxHash || null,
  };
}

// ── Anchor sweep (retryable background job) ───────────────────────────────────

/**
 * Anchor one batch of pending AuditLog hashes to Stellar.
 * Called by the background interval; also exported for tests.
 */
async function anchorPendingLogs() {
  const pending = await AuditLog.find({
    anchorStatus: { $in: ['pending', 'failed'] },
    anchorAttempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(ANCHOR_BATCH_SIZE)
    .lean();

  if (pending.length === 0) return;

  logger.debug(`Anchoring ${pending.length} audit log(s) to Stellar`);

  await Promise.allSettled(
    pending.map(async (log) => {
      try {
        const txHash = await stellar.anchorHash(log.hash);
        await AuditLog.findByIdAndUpdate(log._id, {
          $set:  { anchorStatus: 'anchored', stellarTxHash: txHash },
          $inc:  { anchorAttempts: 1 },
        });
        logger.info('Audit log anchored', { logId: log._id, txHash });
      } catch (err) {
        await AuditLog.findByIdAndUpdate(log._id, {
          $set: { anchorStatus: 'failed' },
          $inc: { anchorAttempts: 1 },
        });
        logger.warn('Audit log anchor failed', { logId: log._id, error: err.message });
      }
    }),
  );
}

// ── Background job lifecycle ──────────────────────────────────────────────────

let _intervalHandle = null;

function startAnchorJob() {
  if (_intervalHandle) return; // already running
  _intervalHandle = setInterval(() => {
    anchorPendingLogs().catch((err) =>
      logger.error('anchorPendingLogs error', { message: err.message }),
    );
  }, ANCHOR_INTERVAL_MS);
  logger.info('Audit anchor job started', { intervalMs: ANCHOR_INTERVAL_MS });
}

function stopAnchorJob() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

module.exports = {
  computeHash,
  createAuditLog,
  verifyAuditLog,
  anchorPendingLogs,
  startAnchorJob,
  stopAnchorJob,
};
