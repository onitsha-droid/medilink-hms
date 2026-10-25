'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Exactly the 8 roles specified in the README.
 * Keep this list in sync with the RBAC middleware and seed script.
 */
const ROLES = Object.freeze([
  'Patient',
  'Front Desk',
  'Nurse',
  'Doctor',
  'Lab Scientist',
  'Pharmacist',
  'Billing Officer',
  'Admin',
]);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name must be at most 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email is invalid'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // never returned in queries by default
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: { values: ROLES, message: 'Role {VALUE} is not a valid role' },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// ── Hash password before saving ───────────────────────────────────────────────
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ── Instance method: compare plaintext password ───────────────────────────────
userSchema.methods.comparePassword = async function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

// ── Remove sensitive fields from JSON output ──────────────────────────────────
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
