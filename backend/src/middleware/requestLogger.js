'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');

// Stream morgan output through winston
const stream = {
  write: (message) => logger.http(message.trim()),
};

/**
 * Returns a morgan middleware configured for the current environment.
 * Uses "combined" format in production (includes remote IP and user-agent)
 * and the more readable "dev" format elsewhere.
 */
function requestLogger() {
  return morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream,
    // Don't log health-check polls to reduce noise
    skip: (req) => req.url === '/health' && process.env.NODE_ENV === 'production',
  });
}

module.exports = requestLogger;
