'use strict';

/**
 * Shared test helper: creates a user via the User model and returns a signed
 * JWT so tests can call protected endpoints without going through /auth/login.
 */

const { User } = require('../../src/models/User');
const { signToken } = require('../../src/middleware/auth');

/**
 * @param {object} overrides  Partial user fields (role, email, etc.)
 * @returns {{ token: string, user: object }}
 */
async function createUserAndToken(overrides = {}) {
  const defaults = {
    name: 'Test User',
    email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'TestPass@123',
    role: 'Patient',
  };
  const user = await User.create({ ...defaults, ...overrides });
  const token = signToken(user);
  return { token, user };
}

module.exports = { createUserAndToken };
