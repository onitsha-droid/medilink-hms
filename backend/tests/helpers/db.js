'use strict';

/**
 * Shared test DB helper.
 *
 * Spins up a single-node MongoMemoryReplSet (replica set) so that Mongoose
 * multi-document transactions work in tests exactly as they do in production.
 * Tears everything down after the suite and wipes collections between tests.
 */

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replSet;

function setupTestDB() {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });
}

module.exports = { setupTestDB };
