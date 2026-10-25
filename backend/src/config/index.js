'use strict';

require('dotenv').config();

const REQUIRED = [
  'PORT',
  'NODE_ENV',
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
];

/**
 * Validate that every required env variable is present before the app starts.
 * Optional variables (Paystack, SMS, Stellar) are logged as warnings so
 * developers aren't blocked during early-stage work but are reminded to fill
 * them in.
 */
function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Copy backend/.env.example to backend/.env and fill in the values.',
    );
  }

  const OPTIONAL = [
    'PAYSTACK_SECRET_KEY',
    'SMS_API_KEY',
    'STELLAR_NETWORK',
    'STELLAR_HORIZON_URL',
    'SOROBAN_RPC_URL',
    'HOSPITAL_STELLAR_SECRET',
    'HMO_CONTRACT_ID',
  ];
  const missingOptional = OPTIONAL.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] Optional env variables not set: ${missingOptional.join(', ')}`,
    );
  }
}

validateEnv();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV,
  mongodbUri: process.env.MONGODB_URI,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN,
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
  },
  sms: {
    apiKey: process.env.SMS_API_KEY,
  },
  stellar: {
    network: process.env.STELLAR_NETWORK,
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL,
    hospitalSecret: process.env.HOSPITAL_STELLAR_SECRET,
    hmoContractId: process.env.HMO_CONTRACT_ID,
  },
};
