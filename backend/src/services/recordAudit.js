'use strict';

const logger = require('../utils/logger');

/**
 * emitRecordAccessed — fires an internal "record.accessed" event via
 * Socket.IO (if available) and logs it locally.
 *
 * Only non-PHI metadata is emitted. The Stellar anchoring of this event
 * is DEFERRED (Day 3 / blockchain sprint).
 *
 * @param {object} io          Socket.IO server instance (may be undefined in tests)
 * @param {object} params
 * @param {string} params.userId      User._id performing the action
 * @param {string} params.patientId   Patient._id being accessed
 * @param {string} params.action      e.g. 'read:patient_history', 'write:clinical_note'
 * @param {string} [params.encounterId]  Optional Encounter._id
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
    // Emit to an internal audit room that admin clients may subscribe to.
    // No PHI is included in the event payload.
    io.to('audit:records').emit('record.accessed', payload);
  }
}

module.exports = { emitRecordAccessed };
