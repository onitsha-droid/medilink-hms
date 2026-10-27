'use strict';

const mongoose = require('mongoose');

/**
 * DrugInventory — stock record for a single drug/formulation.
 *
 * Stock decrements happen inside Mongoose transactions (see inventory route)
 * to prevent overselling when two dispenses race against each other.
 *
 * Low-stock threshold defaults to 10 units; Admin is notified when
 * quantityOnHand falls at or below this threshold.
 */
const drugInventorySchema = new mongoose.Schema(
  {
    drugName: {
      type: String,
      required: [true, 'Drug name is required'],
      trim: true,
      maxlength: 150,
      index: true,
    },
    // Strength + form e.g. "500mg capsule", "250mg/5ml suspension"
    formulation: {
      type: String,
      required: [true, 'Formulation is required'],
      trim: true,
      maxlength: 100,
    },
    quantityOnHand: {
      type: Number,
      required: [true, 'quantityOnHand is required'],
      min: [0, 'Stock cannot be negative'],
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: [0, 'Threshold cannot be negative'],
    },
    unitPriceKobo: {
      type: Number,
      min: [0, 'Price cannot be negative'],
      default: 0,
    },
    // Batch / expiry tracking (optional)
    batchNumber: { type: String, trim: true },
    expiryDate: { type: Date },
  },
  { timestamps: true },
);

// Compound unique index: same drug name + formulation should appear once
drugInventorySchema.index({ drugName: 1, formulation: 1 }, { unique: true });

// Virtual: is stock low?
drugInventorySchema.virtual('isLowStock').get(function () {
  return this.quantityOnHand <= this.lowStockThreshold;
});

const DrugInventory = mongoose.model('DrugInventory', drugInventorySchema);

module.exports = { DrugInventory };
