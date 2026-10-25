'use strict';

/**
 * Jest global setup — sets env vars that the config validator requires
 * before any test module is loaded. This runs before setupFilesAfterEnv.
 */
module.exports = async function globalSetup() {
  process.env.PORT = process.env.PORT || '3000';
  process.env.NODE_ENV = 'test';
  // A placeholder URI; tests use MongoMemoryReplSet and override the
  // connection before any route handler runs.
  process.env.MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
};
