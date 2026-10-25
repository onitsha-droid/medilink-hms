'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { mongodbUri } = require('../config');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  await mongoose.connect(mongodbUri, {
    // Atlas / replica-set connections require these for clean behaviour
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  isConnected = true;
  logger.info('MongoDB connected', { uri: mongodbUri.replace(/\/\/.*@/, '//***@') });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error', { err: err.message });
  });
}

async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected (graceful)');
}

module.exports = { connectDB, disconnectDB };
