'use strict';

const http = require('http');
const createApp = require('./app');
const { connectDB } = require('./config/database');
const { createSocketServer } = require('./socket/socketServer');
const { startAnchorJob } = require('./services/auditService');
const logger = require('./utils/logger');
const { port } = require('./config');

const app = createApp();
const server = http.createServer(app);

// Attach Socket.IO and make `io` accessible to route handlers via app.get('io')
const io = createSocketServer(server);
app.set('io', io);

async function start() {
  try {
    await connectDB();
    server.listen(port, () => {
      logger.info(`MediLink API listening on port ${port}`, {
        env: process.env.NODE_ENV,
      });
      startAnchorJob();
    });
  } catch (err) {
    logger.error('Failed to start server', { err: err.message });
    process.exit(1);
  }
}

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

module.exports = server;
