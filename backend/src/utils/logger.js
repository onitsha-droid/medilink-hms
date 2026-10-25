'use strict';

const winston = require('winston');
const { nodeEnv } = require('../config');

const logger = winston.createLogger({
  level: nodeEnv === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
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
