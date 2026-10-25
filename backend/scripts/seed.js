'use strict';

/**
 * Seed script — creates one development user per role.
 * Run with: npm run seed
 *
 * Credentials follow the pattern:
 *   email:    <role-slug>@medilink.dev
 *   password: Medilink@2026
 *
 * IMPORTANT: Never run this against a production database.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User, ROLES } = require('../src/models/User');
const { mongodbUri, nodeEnv } = require('../src/config');

if (nodeEnv === 'production') {
  // eslint-disable-next-line no-console
  console.error('Seed script must NOT be run in production. Aborting.');
  process.exit(1);
}

const DEFAULT_PASSWORD = 'Medilink@2026';

function roleToSlug(role) {
  return role.toLowerCase().replace(/\s+/g, '-');
}

async function seed() {
  await mongoose.connect(mongodbUri);
  // eslint-disable-next-line no-console
  console.log('Connected to MongoDB');

  for (const role of ROLES) {
    const email = `${roleToSlug(role)}@medilink.dev`;
    const existing = await User.findOne({ email });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`  [skip] ${email} already exists`);
      continue;
    }

    await User.create({
      name: `Dev ${role}`,
      email,
      password: DEFAULT_PASSWORD,
      role,
    });
    // eslint-disable-next-line no-console
    console.log(`  [created] ${email}  role=${role}`);
  }

  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
