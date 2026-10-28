'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { Patient } = require('../models/Patient');
const { QueueEntry } = require('../models/QueueEntry');
const { Invoice } = require('../models/Invoice');
const { HmoClaim } = require('../models/HmoClaim');
const { DrugInventory } = require('../models/DrugInventory');
const { Clinic } = require('../models/Clinic');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate, authorize('Admin'));

// ── helpers ───────────────────────────────────────────────────────────────────

function todayMidnightUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── GET /admin/dashboard — all metrics in one call ────────────────────────────
router.get('/dashboard', async (_req, res, next) => {
  try {
    const today = todayMidnightUTC();

    const [
      patientsToday,
      queueStats,
      revenueFiat,
      revenueStablecoin,
      claimsStats,
      lowStockItems,
    ] = await Promise.all([
      // Patients registered today
      Patient.countDocuments({ createdAt: { $gte: today } }),

      // Queue stats per clinic (waiting + avg wait)
      QueueEntry.aggregate([
        { $match: { queueDate: { $gte: today }, status: { $in: ['waiting', 'in_progress'] } } },
        {
          $group: {
            _id: '$clinic',
            queueLength: { $sum: 1 },
            urgent: { $sum: { $cond: ['$isUrgent', 1, 0] } },
          },
        },
        {
          $lookup: {
            from: 'clinics',
            localField: '_id',
            foreignField: '_id',
            as: 'clinicInfo',
          },
        },
        { $unwind: { path: '$clinicInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            clinicId: '$_id',
            clinicName: { $ifNull: ['$clinicInfo.name', 'Unknown'] },
            queueLength: 1,
            urgent: 1,
            avgConsultationMinutes: { $ifNull: ['$clinicInfo.avgConsultationMinutes', 15] },
          },
        },
      ]),

      // Revenue today — fiat paid invoices
      Invoice.aggregate([
        {
          $match: {
            status: 'paid',
            paymentMethod: 'fiat',
            paidAt: { $gte: today },
          },
        },
        { $group: { _id: null, totalKobo: { $sum: '$totalKobo' }, count: { $sum: 1 } } },
      ]),

      // Revenue today — stablecoin paid invoices
      Invoice.aggregate([
        {
          $match: {
            status: 'paid',
            paymentMethod: 'stablecoin',
            paidAt: { $gte: today },
          },
        },
        { $group: { _id: null, totalKobo: { $sum: '$totalKobo' }, count: { $sum: 1 } } },
      ]),

      // HMO claims status breakdown
      HmoClaim.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalKobo: { $sum: '$requestedAmountKobo' },
          },
        },
      ]),

      // Low stock items
      DrugInventory.find({
        $expr: { $lte: ['$quantityOnHand', '$lowStockThreshold'] },
      })
        .select('drugName formulation quantityOnHand lowStockThreshold')
        .lean(),
    ]);

    // Compute estimated wait time per clinic
    const queueWithWait = queueStats.map((q) => ({
      ...q,
      estimatedWaitMinutes: q.queueLength * q.avgConsultationMinutes,
    }));

    return res.status(200).json({
      patientsToday,
      queue: queueWithWait,
      revenue: {
        fiat: {
          totalKobo: revenueFiat[0]?.totalKobo ?? 0,
          count: revenueFiat[0]?.count ?? 0,
        },
        stablecoin: {
          totalKobo: revenueStablecoin[0]?.totalKobo ?? 0,
          count: revenueStablecoin[0]?.count ?? 0,
        },
      },
      claims: claimsStats.reduce((acc, s) => {
        acc[s._id] = { count: s.count, totalKobo: s.totalKobo };
        return acc;
      }, {}),
      lowStock: lowStockItems,
    });
  } catch (err) {
    return next(err);
  }
});

// ── GET /admin/revenue — revenue by payment method with date range ────────────
router.get(
  '/revenue',
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const from = req.query.from ? new Date(req.query.from) : todayMidnightUTC();
      const to   = req.query.to   ? new Date(req.query.to)   : new Date();

      const result = await Invoice.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$paymentMethod',
            totalKobo: { $sum: '$totalKobo' },
            count: { $sum: 1 },
          },
        },
      ]);

      return res.status(200).json({ revenue: result, from, to });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /admin/queue-metrics — live queue lengths per clinic ──────────────────
router.get('/queue-metrics', async (_req, res, next) => {
  try {
    const today = todayMidnightUTC();
    const metrics = await QueueEntry.aggregate([
      { $match: { queueDate: { $gte: today } } },
      {
        $group: {
          _id: { clinic: '$clinic', status: '$status' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.clinic',
          statuses: {
            $push: { status: '$_id.status', count: '$count' },
          },
        },
      },
      {
        $lookup: {
          from: 'clinics',
          localField: '_id',
          foreignField: '_id',
          as: 'clinicInfo',
        },
      },
      { $unwind: { path: '$clinicInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          clinicId: '$_id',
          clinicName: { $ifNull: ['$clinicInfo.name', 'Unknown'] },
          statuses: 1,
        },
      },
    ]);

    // Emit to admin socket room as well
    const io = _req.app.get('io');
    if (io) {
      io.to('admin:alerts').emit('admin:queue_metrics', { metrics });
    }

    return res.status(200).json({ metrics });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
