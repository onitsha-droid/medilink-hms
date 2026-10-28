'use strict';

const logger = require('../utils/logger');
const { createAuditLog } = require('./auditService');

/**
 * emitRecordAccessed — fires record.accessed via Socket.IO and persists an
 * AuditLog document with a salted SHA-256 hash.
 *
 * Only non-PHI metadata is emitted or stored:
 *   userId, patientId (both Mongo ObjectId strings), action string, timestamp.
 *
 * @param {object} io   Socket.IO server instance (may be null in tests)
 * @param {{ userId, patientId, action, encounterId? }} params
 */
function emitRecordAccessed(io, { userId, patientId, action, encounterId }) {
  const payload = {
    userId,
    patientId,
    action,
    encounterId: encounterId || null,
    timestamp: new Date().toISOString(),
  };

  logger.info('record.accessed', payload);

  if (io) {
    io.to('audit:records').emit('record.accessed', payload);
  }

  // Persist asynchronously — do not await so callers are never blocked
  createAuditLog({
    userId,
    patientId,
    action,
    encounterId: encounterId || null,
    timestamp: new Date(),
  }).catch((err) =>
    logger.error('Failed to persist AuditLog', { message: err.message }),
  );
}

module.exports = { emitRecordAccessed };
