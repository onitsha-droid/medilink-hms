'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global rate limiter: 100 requests per IP per 15-minute window.
 * Auth endpoints get a tighter limit defined in the auth router.
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter limiter for auth endpoints to slow brute-force attempts.
 * 5 requests per IP per 15-minute window in production/development.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

/**
 * Stricter limiter for payment initialization and verification endpoints.
 * 10 requests per IP per 15-minute window in production/development.
 */
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later.' },
});

module.exports = { globalLimiter, authLimiter, paymentLimiter };

