'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { DrugInventory } = require('../models/DrugInventory');
const { Prescription } = require('../models/Prescription');
const { Invoice } = require('../models/Invoice');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

// ── GET /inventory — list all stock (Pharmacist, Admin) ───────────────────────
router.get(
  '/',
  authorize('Pharmacist', 'Admin'),
  async (req, res, next) => {
    try {
      const items = await DrugInventory.find().sort({ drugName: 1 }).lean();
      // Attach isLowStock from virtual (lean() bypasses virtuals)
      const itemsWithFlag = items.map((i) => ({
        ...i,
        isLowStock: i.quantityOnHand <= i.lowStockThreshold,
      }));
      return res.status(200).json({ inventory: itemsWithFlag });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /inventory/low-stock — items at or below threshold (Admin) ─────────────
router.get(
  '/low-stock',
  authorize('Admin', 'Pharmacist'),
  async (req, res, next) => {
    try {
      const items = await DrugInventory.find({
        $expr: { $lte: ['$quantityOnHand', '$lowStockThreshold'] },
      }).lean();
      return res.status(200).json({ lowStock: items });
    } catch (err) {
      return next(err);
    }
  },
);

// ── GET /inventory/check/:prescriptionId — stock check for a prescription ─────
router.get(
  '/check/:prescriptionId',
  authorize('Pharmacist', 'Admin'),
  param('prescriptionId').isMongoId().withMessage('Invalid prescription ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const prescription = await Prescription.findById(req.params.prescriptionId).lean();
      if (!prescription) return next(createError('Prescription not found', 404));

      // For each drug line find the matching inventory item
      const checks = await Promise.all(
        prescription.drugs.map(async (drug) => {
          const item = await DrugInventory.findOne({
            drugName: { $regex: new RegExp(`^${escapeRegex(drug.drugName)}$`, 'i') },
          }).lean();

          return {
            drugName: drug.drugName,
            dose: drug.dose,
            quantityRequired: drug.quantity,
            quantityOnHand: item ? item.quantityOnHand : null,
            inStock: item ? item.quantityOnHand >= drug.quantity : false,
            isLowStock: item
              ? item.quantityOnHand <= item.lowStockThreshold
              : null,
          };
        }),
      );

      return res.status(200).json({ checks });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /inventory — Admin adds a new stock item ─────────────────────────────
router.post(
  '/',
  authorize('Admin'),
  [
    body('drugName').trim().notEmpty().withMessage('drugName is required'),
    body('formulation').trim().notEmpty().withMessage('formulation is required'),
    body('quantityOnHand').isInt({ min: 0 }).withMessage('quantityOnHand must be ≥ 0'),
    body('lowStockThreshold').optional().isInt({ min: 0 }),
    body('unitPriceKobo').optional().isInt({ min: 0 }),
    body('batchNumber').optional().trim(),
    body('expiryDate').optional().isISO8601(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const item = await DrugInventory.create(req.body);
      return res.status(201).json({ item });
    } catch (err) {
      return next(err);
    }
  },
);

// ── PATCH /inventory/:id/restock — Admin adjusts stock upward ─────────────────
router.patch(
  '/:id/restock',
  authorize('Admin'),
  [
    param('id').isMongoId(),
    body('quantity').isInt({ min: 1 }).withMessage('quantity must be ≥ 1'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      const item = await DrugInventory.findByIdAndUpdate(
        req.params.id,
        { $inc: { quantityOnHand: req.body.quantity } },
        { new: true, runValidators: true },
      );
      if (!item) return next(createError('Inventory item not found', 404));
      return res.status(200).json({ item });
    } catch (err) {
      return next(err);
    }
  },
);

// ── POST /inventory/dispense/:prescriptionId ───────────────────────────────────
// Dispenses a prescription inside a Mongoose transaction.
// Requirements:
//   1. Prescription status must be 'sent' (not already dispensed).
//   2. The related invoice must be in 'paid' status (payment confirmed).
//   3. Each drug line must have sufficient stock — checked inside the transaction.
//   4. All stock decrements happen atomically — two concurrent dispenses of
//      the last unit must not both succeed.
router.post(
  '/dispense/:prescriptionId',
  authorize('Pharmacist'),
  param('prescriptionId').isMongoId().withMessage('Invalid prescription ID'),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return next(createError(errors.array()[0].msg, 400));

      let result;
      await session.withTransaction(async () => {
        const prescription = await Prescription.findById(
          req.params.prescriptionId,
        ).session(session);

        if (!prescription) throw createError('Prescription not found', 404);
        if (prescription.status !== 'sent') {
          throw createError(
            `Prescription is already ${prescription.status}`,
            400,
          );
        }

        // ── Payment gate ──────────────────────────────────────────────────
        if (prescription.invoice) {
          const invoice = await Invoice.findById(prescription.invoice).session(session);
          if (!invoice || invoice.status !== 'paid') {
            throw createError(
              'Payment must be confirmed before dispensing',
              402,
            );
          }
        } else {
          // No invoice linked — treat as unpaid
          throw createError(
            'No invoice linked to this prescription; payment required',
            402,
          );
        }

        // ── Stock check + decrement (inside transaction) ──────────────────
        for (const drug of prescription.drugs) {
          const item = await DrugInventory.findOneAndUpdate(
            {
              drugName: { $regex: new RegExp(`^${escapeRegex(drug.drugName)}$`, 'i') },
              quantityOnHand: { $gte: drug.quantity },
            },
            { $inc: { quantityOnHand: -drug.quantity } },
            { new: true, session },
          );

          if (!item) {
            throw createError(
              `Insufficient stock for ${drug.drugName} (need ${drug.quantity})`,
              409,
            );
          }

          // Emit low-stock alert to Admin room if threshold crossed
          const io = req.app.get('io');
          if (io && item.quantityOnHand <= item.lowStockThreshold) {
            io.to('admin:alerts').emit('inventory:low_stock', {
              drugName: item.drugName,
              formulation: item.formulation,
              quantityOnHand: item.quantityOnHand,
              lowStockThreshold: item.lowStockThreshold,
            });
          }
        }

        prescription.status = 'dispensed';
        prescription.dispensedBy = req.user.id;
        prescription.dispensedAt = new Date();
        await prescription.save({ session });

        result = prescription;
      });

      return res.status(200).json({ prescription: result });
    } catch (err) {
      return next(err);
    } finally {
      await session.endSession();
    }
  },
);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
