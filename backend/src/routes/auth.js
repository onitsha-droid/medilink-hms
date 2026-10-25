'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { User } = require('../models/User');
const { signToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────
const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
];

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, name, email, role } }
 */
router.post('/login', authLimiter, loginRules, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError(errors.array()[0].msg, 400));
    }

    const { email, password } = req.body;

    // Explicitly select password (it's excluded by default via `select: false`)
    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      return next(createError('Invalid credentials', 401));
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      return next(createError('Invalid credentials', 401));
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user);

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /auth/me
 * Returns the authenticated user's profile (no password).
 */
const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return next(createError('User not found', 404));
    return res.status(200).json({ user });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
