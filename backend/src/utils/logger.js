'use strict';

const winston = require('winston');
const { nodeEnv } = require('../config');

const SENSITIVE_KEY_REGEX =
  /^(password|token|secret|authorization|cookie|apikey|privatekey|seed|stellarsecret|paystacksecretkey|hospitalstellarsecret|nin|phone|dateofbirth|medicalhistory|diagnoses|diagnosis|prescriptions|results|ssn)$/i;

/**
 * Recursively sanitize objects to prevent leaking secrets and PHI in logs.
 */
function sanitize(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, depth + 1));
  }
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      obj[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      obj[key] = sanitize(obj[key], depth + 1);
    }
  }
  return obj;
}

const redactFormat = winston.format((info) => {
  sanitize(info);
  if (typeof info.message === 'string') {
    info.message = info.message.replace(
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      'Bearer [REDACTED]',
    );
  }
  return info;
});

const logger = winston.createLogger({
  level: nodeEnv === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    nodeEnv === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(
            ({ timestamp, level, message, ...meta }) =>
              `${timestamp} [${level}]: ${message}` +
              (Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''),
          ),
        ),
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
module.exports.sanitize = sanitize;

