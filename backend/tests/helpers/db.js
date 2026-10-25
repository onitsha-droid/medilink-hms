'use strict';

/**
 * Shared test helper: spins up an in-memory MongoDB instance for the duration
 * of a Jest test suite, and tears it down afterwards.
 *
 * Usage in a test file:
 *   const { setupTestDB } = require('./helpers/db');
 *   setupTestDB();
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

function setupTestDB() {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    // Clean all collections between tests for isolation
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });
}

module.exports = { setupTestDB };
