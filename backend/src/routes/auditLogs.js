'use strict';

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { AuditLog } = require('../models/AuditLog');
const { verifyAuditLog } = require('../services/auditService');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

// ── GET /audit-logs — list logs (Admin only) ──────────────────────────────────
router.get(
  '/',
  authorize('Admin'),
  [
    query('userId').optional().isString(),
    query('patientId').optional().isString(),
    query('anchorStatus').optional().isIn(['pending', 'anchored', 'failed']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res, next) => {
    try {
      const { userId, patientId, anchorStatus, page = 1, limit = 20 } = req.query;
      const filter = {};
      if (userId) filter.userId = userId;
      if (patientId) filter.patientId = patientId;
      if (anchorStatus) filter.anchorStatus = anchorStatus;

      const skip = (Number(page) - 1) * Number(limit);
      const [logs, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        AuditLog.countDocuments(filter),
      ]);

      return res.status(200).json({
        logs,
        pagination: { total, page: Number(page), limit: Number(limit) },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /audit-logs/:id/verify — recompute hash and confirm integrity ─────────
router.get(
  '/:id/verify',
  authorize('Admin'),
  param('id').isMongoId().withMessage('Invalid audit log ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const result = await verifyAuditLog(req.params.id);
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
