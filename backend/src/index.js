'use strict';

const http = require('http');
const createApp = require('./app');
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const { port } = require('./config');

const app = createApp();
const server = http.createServer(app);

async function start() {
  try {
    await connectDB();
    server.listen(port, () => {
      logger.info(`MediLink API listening on port ${port}`, {
        env: process.env.NODE_ENV,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { err: err.message });
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    const { disconnectDB } = require('./config/database');
    await disconnectDB();
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();

module.exports = server; // exported for tests
