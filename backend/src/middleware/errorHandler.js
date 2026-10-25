'use strict';

const logger = require('../utils/logger');

/**
 * Central Express error handler.
 * Must be registered AFTER all routes (4-argument signature).
 *
 * Operational errors (validation, auth, not-found) return a structured JSON
 * body with an appropriate HTTP status. Unexpected errors log a stack trace
 * and return 500 without leaking internals in production.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // ── Mongoose validation error ───────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  // ── Mongoose duplicate key ──────────────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ error: `Duplicate value for ${field}` });
  }

  // ── JWT errors ──────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // ── Operational / known errors with a statusCode ────────────────────────
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // ── Unexpected errors ───────────────────────────────────────────────────
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  return res.status(500).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message,
  });
}

/**
 * Create a lightweight operational error with an HTTP status code.
 * @param {string} message
 * @param {number} statusCode
 */
function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { errorHandler, createError };
