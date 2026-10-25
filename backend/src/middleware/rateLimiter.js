'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global rate limiter: 100 requests per IP per 15-minute window.
 * Auth endpoints get a tighter limit defined in the auth router.
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter limiter for auth endpoints to slow brute-force attempts.
 * 10 requests per IP per 15-minute window.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

module.exports = { globalLimiter, authLimiter };
