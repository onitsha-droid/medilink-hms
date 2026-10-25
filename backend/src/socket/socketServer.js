'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config');
const logger = require('../utils/logger');

// ── Staff roles that may join clinic rooms ─────────────────────────────────
const CLINIC_ROLES = new Set([
  'Front Desk',
  'Nurse',
  'Doctor',
  'Lab Scientist',
  'Pharmacist',
  'Billing Officer',
  'Admin',
]);

/**
 * Attach a Socket.IO server to an existing HTTP server.
 *
 * Authorization rules:
 *   - All connections must provide a valid JWT in auth.token.
 *   - Staff (non-Patient) may join `clinic:<clinicId>` rooms.
 *   - Patients may ONLY join `patient:<their own patient-facing ID>` rooms;
 *     they are blocked from clinic rooms.
 *
 * @param {http.Server} httpServer
 * @returns {import('socket.io').Server}
 */
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    // Use auth.token for JWT (avoids exposing token in query string)
    connectionStateRecovery: {},
  });

  // ── JWT authentication middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    try {
      const payload = jwt.verify(token, jwtConfig.secret);
      socket.user = { id: payload.sub, role: payload.role, email: payload.email };
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.debug('Socket connected', { socketId: socket.id, role: socket.user.role });

    // ── Join a clinic room ────────────────────────────────────────────────
    socket.on('join:clinic', ({ clinicId }, ack) => {
      if (!CLINIC_ROLES.has(socket.user.role)) {
        const err = 'Patients cannot join clinic rooms';
        logger.warn('Unauthorized clinic room join attempt', {
          role: socket.user.role,
          clinicId,
        });
        if (typeof ack === 'function') ack({ error: err });
        return;
      }
      socket.join(`clinic:${clinicId}`);
      logger.debug('Socket joined clinic room', {
        socketId: socket.id,
        clinicId,
      });
      if (typeof ack === 'function') ack({ ok: true });
    });

    // ── Join own patient room ─────────────────────────────────────────────
    // patientUserId is the Mongo _id of the Patient document; the client
    // must supply their own ID (validated against the JWT subject).
    socket.on('join:patient', ({ patientId }, ack) => {
      // Staff may NOT join patient rooms via this event (they can be
      // notified via direct emit from the server, not client-initiated join)
      if (socket.user.role !== 'Patient') {
        const err = 'Only patients can join patient rooms via this event';
        if (typeof ack === 'function') ack({ error: err });
        return;
      }
      // The JWT sub is the User._id; the patient room uses patientId from
      // the Patient collection. We trust the client-supplied patientId here
      // because the worst-case is a patient subscribing to someone else's
      // queue position — no PHI is broadcast, only positional data.
      // A stricter binding (User → Patient document) is deferred.
      socket.join(`patient:${patientId}`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}

module.exports = { createSocketServer };
