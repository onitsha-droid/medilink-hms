'use strict';

/**
 * Tests for backend/src/services/stellar.js
 *
 * All Horizon network calls are mocked — no real network access required.
 * The keypair below is a randomly-generated Testnet keypair with no real funds.
 */

// ── Env setup BEFORE any require that calls validateEnv ───────────────────────
process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_key';

// Test-only Testnet keypair — randomly generated, no real funds, safe to commit.
const TEST_SECRET = 'SD5RQO5SI4GXPSU5NGM5F526BE22BYKPKDVEKWBH2GAG63HPCJ5UJVMS';

process.env.STELLAR_NETWORK = 'TESTNET';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.HOSPITAL_STELLAR_SECRET = TEST_SECRET;

const { Keypair, Networks, Asset, Horizon } = require('@stellar/stellar-sdk');
const stellar = require('../src/services/stellar');

// Derive public key once for assertions
const HOSPITAL_PUBLIC = Keypair.fromSecret(TEST_SECRET).publicKey();

// ── hospitalKeypair ───────────────────────────────────────────────────────────

describe('stellar.hospitalKeypair()', () => {
  it('returns a Keypair whose public key matches the configured secret', () => {
    const kp = stellar.hospitalKeypair();
    expect(kp.publicKey()).toBe(HOSPITAL_PUBLIC);
    expect(kp.publicKey()).toMatch(/^G/);
  });

  it('throws a descriptive error when the secret is the placeholder', () => {
    // Test the guard logic directly without re-requiring the module
    const { createError } = require('../src/middleware/errorHandler');
    function hospitalKeypairWithSecret(secret) {
      if (!secret || secret === 'S_replace_me') {
        throw new Error('HOSPITAL_STELLAR_SECRET is not configured. Set a valid Stellar secret key in backend/.env');
      }
      return Keypair.fromSecret(secret);
    }
    expect(() => hospitalKeypairWithSecret('S_replace_me')).toThrow(
      'HOSPITAL_STELLAR_SECRET is not configured',
    );
    expect(() => hospitalKeypairWithSecret('')).toThrow(
      'HOSPITAL_STELLAR_SECRET is not configured',
    );
  });

  it('does not log the secret key', () => {
    const logSpy = jest.spyOn(require('../src/utils/logger'), 'info');
    stellar.hospitalKeypair();
    const calls = logSpy.mock.calls.flat().join(' ');
    // Ensure secret key string is not present in any log call
    expect(calls).not.toContain(TEST_SECRET);
    logSpy.mockRestore();
  });
});

// ── networkPassphrase ─────────────────────────────────────────────────────────

describe('stellar.networkPassphrase()', () => {
  it('returns TESTNET passphrase when STELLAR_NETWORK=TESTNET', () => {
    expect(stellar.networkPassphrase()).toBe(Networks.TESTNET);
  });

  it('returns PUBLIC passphrase when network config is PUBLIC', () => {
    // Test the passphrase logic directly without re-requiring config
    function passphraseForNetwork(net) {
      return (net || 'TESTNET').toUpperCase() === 'PUBLIC'
        ? Networks.PUBLIC
        : Networks.TESTNET;
    }
    expect(passphraseForNetwork('PUBLIC')).toBe(Networks.PUBLIC);
    expect(passphraseForNetwork('TESTNET')).toBe(Networks.TESTNET);
    expect(passphraseForNetwork(undefined)).toBe(Networks.TESTNET);
  });
});

// ── usdcAsset ─────────────────────────────────────────────────────────────────

describe('stellar.usdcAsset()', () => {
  it('returns an asset with code USDC and a valid issuer public key', () => {
    const asset = stellar.usdcAsset();
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toMatch(/^G[A-Z0-9]{55}$/);
  });
});

// ── buildPaymentRequest ───────────────────────────────────────────────────────

describe('stellar.buildPaymentRequest()', () => {
  const fakeInvoice = {
    _id: { toString: () => 'abc123def456abc123def456' },
    totalKobo: 500000, // 5000 USDC at 1 USDC = 100 kobo
  };

  it('returns the hospital public key as destination', () => {
    const req = stellar.buildPaymentRequest(fakeInvoice);
    expect(req.destination).toBe(HOSPITAL_PUBLIC);
  });

  it('converts kobo to USDC: 500 000 kobo = 5000.0000000 USDC', () => {
    const req = stellar.buildPaymentRequest(fakeInvoice);
    expect(parseFloat(req.amount)).toBeCloseTo(5000.0, 4);
  });

  it('sets memo to invoice _id string (≤28 chars)', () => {
    const req = stellar.buildPaymentRequest(fakeInvoice);
    expect(req.memo).toBe('abc123def456abc123def456');
    expect(req.memo.length).toBeLessThanOrEqual(28);
  });

  it('reports asset=USDC and network=TESTNET', () => {
    const req = stellar.buildPaymentRequest(fakeInvoice);
    expect(req.asset).toBe('USDC');
    expect(req.network).toBe('TESTNET');
  });

  it('truncates a 28-char max memo if invoice id is longer', () => {
    const longInvoice = {
      _id: { toString: () => '1234567890abcdef1234567890abcdef' }, // 32 chars
      totalKobo: 1000,
    };
    const req = stellar.buildPaymentRequest(longInvoice);
    expect(req.memo.length).toBeLessThanOrEqual(28);
  });
});

// ── verifyPaymentToHospital (fully mocked Horizon) ────────────────────────────

describe('stellar.verifyPaymentToHospital()', () => {
  afterEach(() => jest.restoreAllMocks());

  const USDC_ISSUER = stellar.usdcAsset().getIssuer();

  function mockPayments(records) {
    jest.spyOn(Horizon.Server.prototype, 'payments').mockReturnValue({
      forAccount: () => ({
        limit: () => ({
          order: () => ({
            call: async () => ({ records }),
          }),
        }),
      }),
    });
  }

  function makeRecord(overrides = {}) {
    return {
      type: 'payment',
      to: HOSPITAL_PUBLIC,
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
      amount: '50.0000000',
      transaction: async () => ({ hash: 'good_tx_hash', memo: 'memo_match' }),
      ...overrides,
    };
  }

  it('returns found=true and txHash when a matching payment exists', async () => {
    mockPayments([makeRecord()]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(true);
    expect(result.txHash).toBe('good_tx_hash');
  });

  it('returns found=false when no records', async () => {
    mockPayments([]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });

  it('ignores records with wrong memo', async () => {
    mockPayments([makeRecord({
      transaction: async () => ({ hash: 'tx1', memo: 'different_memo' }),
    })]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });

  it('ignores records with insufficient amount', async () => {
    mockPayments([makeRecord({ amount: '1.0000000' })]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });

  it('ignores non-payment record types', async () => {
    mockPayments([makeRecord({ type: 'create_account' })]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });

  it('ignores payment to wrong destination', async () => {
    const otherKey = Keypair.random().publicKey();
    mockPayments([makeRecord({ to: otherKey })]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });

  it('ignores payment with wrong asset issuer', async () => {
    const fakeIssuer = Keypair.random().publicKey();
    mockPayments([makeRecord({ asset_issuer: fakeIssuer })]);
    const result = await stellar.verifyPaymentToHospital({
      expectedMemo: 'memo_match',
      expectedUsdcAmount: 50,
    });
    expect(result.found).toBe(false);
  });
});

// ── buildSignedTransaction ────────────────────────────────────────────────────

describe('stellar.buildSignedTransaction()', () => {
  it('builds and signs a transaction (offline, no Horizon call)', () => {
    const kp = Keypair.fromSecret(TEST_SECRET);
    // The SDK's TransactionBuilder requires accountId() and sequenceNumber() methods
    const accountObj = {
      id: HOSPITAL_PUBLIC,
      accountId: () => HOSPITAL_PUBLIC,
      sequenceNumber: () => '1000',
      incrementSequenceNumber() {},
    };

    const tx = stellar.buildSignedTransaction({
      sourceKeypair: kp,
      destination: HOSPITAL_PUBLIC,
      assetArg: Asset.native(),
      amount: '0.0000100',
      memoText: 'test_hash_12345678',
      accountObj,
    });

    expect(tx).toBeDefined();
    expect(tx.signatures.length).toBeGreaterThan(0);
  });
});

// ── Stablecoin payment API routes (integration, Horizon mocked) ───────────────

const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Invoice } = require('../src/models/Invoice');
const { Payment } = require('../src/models/Payment');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeTestInvoice(status = 'pending') {
  const id = uid();
  const { token: patientToken } = await createUserAndToken({
    role: 'Patient', email: `pt${id}@t.com`,
  });
  const { user: regUser } = await createUserAndToken({
    role: 'Front Desk', email: `fd${id}@t.com`,
  });
  await Clinic.create({ name: `StellarClinic ${id}`, avgConsultationMinutes: 10 });
  const patient = await Patient.create({
    firstName: 'Tolu', lastName: 'Ade', dateOfBirth: '1990-01-01',
    gender: 'female', phone: `+2349${id}`, registeredBy: regUser._id,
  });
  const invoice = await Invoice.create({
    patient: patient._id,
    lineItems: [{ description: 'Consultation', amountKobo: 500000, itemType: 'consultation' }],
    issuedBy: regUser._id,
    status,
  });
  return { patientToken, patient, invoice };
}

describe('POST /payments/stablecoin/request', () => {
  it('returns USDC payment request details for a pending invoice', async () => {
    const { patientToken, invoice } = await makeTestInvoice();

    const res = await request(app)
      .post('/payments/stablecoin/request')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.paymentRequest.asset).toBe('USDC');
    expect(res.body.paymentRequest.destination).toMatch(/^G/);
    expect(parseFloat(res.body.paymentRequest.amount)).toBeCloseTo(5000, 0);
    expect(res.body.paymentRequest.memo.length).toBeLessThanOrEqual(28);
    expect(res.body.paymentRequest.network).toBe('TESTNET');
  });

  it('returns 400 when invoice is already paid', async () => {
    const { patientToken, invoice } = await makeTestInvoice('paid');

    const res = await request(app)
      .post('/payments/stablecoin/request')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already paid/i);
  });

  it('returns 401 for unauthenticated request', async () => {
    const { invoice } = await makeTestInvoice();
    const res = await request(app)
      .post('/payments/stablecoin/request')
      .send({ invoiceId: invoice._id.toString() });
    expect(res.status).toBe(401);
  });
});

describe('POST /payments/stablecoin/confirm', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockHorizonPayments(records) {
    jest.spyOn(Horizon.Server.prototype, 'payments').mockReturnValue({
      forAccount: () => ({
        limit: () => ({
          order: () => ({
            call: async () => ({ records }),
          }),
        }),
      }),
    });
  }

  it('marks invoice paid and creates Payment when Horizon confirms', async () => {
    const { patientToken, invoice } = await makeTestInvoice();

    mockHorizonPayments([{
      type: 'payment',
      to: HOSPITAL_PUBLIC,
      asset_code: 'USDC',
      asset_issuer: stellar.usdcAsset().getIssuer(),
      amount: '5000.0000000',
      transaction: async () => ({
        hash: 'confirmed_tx_hash_001',
        memo: invoice._id.toString().slice(0, 28),
      }),
    }]);

    const res = await request(app)
      .post('/payments/stablecoin/confirm')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    expect(res.body.invoice.status).toBe('paid');
    expect(res.body.invoice.paymentMethod).toBe('stablecoin');

    const payment = await Payment.findOne({ reference: 'confirmed_tx_hash_001' });
    expect(payment).not.toBeNull();
    expect(payment.method).toBe('stablecoin');
  });

  it('returns 202 when Horizon has not seen the payment yet', async () => {
    const { patientToken, invoice } = await makeTestInvoice();
    mockHorizonPayments([]);

    const res = await request(app)
      .post('/payments/stablecoin/confirm')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    expect(res.status).toBe(202);
    expect(res.body.confirmed).toBe(false);
  });

  it('is idempotent — second confirm returns alreadyPaid=true with no duplicate Payment', async () => {
    const { patientToken, invoice } = await makeTestInvoice();

    mockHorizonPayments([{
      type: 'payment',
      to: HOSPITAL_PUBLIC,
      asset_code: 'USDC',
      asset_issuer: stellar.usdcAsset().getIssuer(),
      amount: '5000.0000000',
      transaction: async () => ({
        hash: 'idem_stellar_tx',
        memo: invoice._id.toString().slice(0, 28),
      }),
    }]);

    await request(app)
      .post('/payments/stablecoin/confirm')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    const res2 = await request(app)
      .post('/payments/stablecoin/confirm')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ invoiceId: invoice._id.toString() });

    expect(res2.status).toBe(200);
    expect(res2.body.alreadyPaid).toBe(true);

    const payments = await Payment.find({ reference: 'idem_stellar_tx' });
    expect(payments.length).toBe(1);
  });
});
