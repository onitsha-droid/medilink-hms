'use strict';

const { User } = require('../../src/models/User');
const { signToken } = require('../../src/middleware/auth');

let _seq = 0;

/**
 * @param {object} overrides  Partial user fields (role, email, etc.)
 * @returns {{ token: string, user: object }}
 */
async function createUserAndToken(overrides = {}) {
  _seq += 1;
  const defaults = {
    name: 'Test User',
    email: `test-${_seq}-${Date.now()}@example.com`,
    password: 'TestPass@123',
    role: 'Patient',
  };
  const user = await User.create({ ...defaults, ...overrides });
  const token = signToken(user);
  return { token, user };
}

module.exports = { createUserAndToken };
