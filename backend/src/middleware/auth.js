'use strict';

const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config');
const { createError } = require('./errorHandler');

/**
 * authenticate — verifies the Bearer JWT in the Authorization header.
 * Attaches `req.user = { id, role, email }` on success.
 */
function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(createError('Authentication token required', 401));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, jwtConfig.secret);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    return next(err); // JsonWebTokenError / TokenExpiredError handled centrally
  }
}

/**
 * authorize(...roles) — returns a middleware that allows only the specified roles.
 * Must be used AFTER authenticate.
 *
 * Usage:
 *   router.post('/patients', authenticate, authorize('Front Desk', 'Admin'), handler)
 *
 * @param {...string} roles  One or more valid role strings from the ROLES list.
 */
function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        createError(
          `Role '${req.user.role}' is not authorized to access this resource`,
          403,
        ),
      );
    }
    return next();
  };
}

/**
 * signToken — generate a signed JWT for a user.
 * @param {object} user  Mongoose User document (or plain object with id/role/email)
 */
function signToken(user) {
  return jwt.sign(
    { role: user.role, email: user.email },
    jwtConfig.secret,
    {
      subject: user._id ? user._id.toString() : user.id,
      expiresIn: jwtConfig.expiresIn,
    },
  );
}

module.exports = { authenticate, authorize, signToken };
