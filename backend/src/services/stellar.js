'use strict';

/**
 * stellar.js — Stellar / Soroban helper service.
 *
 * Privacy rules (README §Blockchain Design):
 *   - No PHI, patient names, or medical data ever touches Stellar.
 *   - Only payment amounts, invoice references, and hashed audit data are written.
 *   - Secret keys are NEVER logged; read exclusively from environment variables.
 *
 * Dependencies: @stellar/stellar-sdk (installed in package.json)
 */

const {
  Keypair,
  Networks,
  Horizon,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
  Memo,
} = require('@stellar/stellar-sdk');

const config = require('../config');
const logger = require('../utils/logger');

// ── Network resolution ────────────────────────────────────────────────────────

/**
 * Returns the Stellar network passphrase for the configured network.
 * Defaults to TESTNET when NODE_ENV is not production.
 */
function networkPassphrase() {
  const net = (config.stellar.network || 'TESTNET').toUpperCase();
  return net === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * Returns a Horizon server instance pointed at the configured URL.
 */
function getHorizon() {
  const url = config.stellar.horizonUrl || 'https://horizon-testnet.stellar.org';
  return new Horizon.Server(url, { allowHttp: url.startsWith('http://') });
}

// ── Account helpers ───────────────────────────────────────────────────────────

/**
 * Load the hospital Keypair from env (never exposed in logs/responses).
 * @returns {Keypair}
 */
function hospitalKeypair() {
  const secret = config.stellar.hospitalSecret;
  if (!secret || secret === 'S_replace_me') {
    throw new Error(
      'HOSPITAL_STELLAR_SECRET is not configured. ' +
        'Set a valid Stellar secret key in backend/.env',
    );
  }
  return Keypair.fromSecret(secret);
}

/**
 * Load an account object (with sequence number) from Horizon.
 * @param {string} publicKey
 * @returns {Promise<Horizon.AccountResponse>}
 */
async function loadAccount(publicKey) {
  const server = getHorizon();
  return server.loadAccount(publicKey);
}

// ── USDC asset on Testnet ─────────────────────────────────────────────────────
//
// Circle's USDC issuer on Testnet:
//   GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
// This is the standard Testnet USDC issuer used in the Stellar docs.
//
const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_PUBNET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/**
 * Return the USDC Asset for the active network.
 * @returns {Asset}
 */
function usdcAsset() {
  const net = (config.stellar.network || 'TESTNET').toUpperCase();
  const issuer = net === 'PUBLIC' ? USDC_PUBNET_ISSUER : USDC_TESTNET_ISSUER;
  return new Asset('USDC', issuer);
}

// ── Payment request generation ────────────────────────────────────────────────

/**
 * Build a stablecoin payment request for an invoice.
 *
 * Returns the destination address, asset code, amount (in USDC, 7 decimal places),
 * and memo (invoice reference, max 28 bytes).
 *
 * Amounts are stored internally in kobo (integer), converted to USDC here at a
 * fixed 1 USDC = 100 kobo rate for Testnet simplicity; the real FX rate is
 * DEFERRED to the Stellar anchor integration sprint.
 *
 * @param {{ totalKobo: number, _id: any, paystackReference?: string }} invoice
 * @returns {{ destination: string, asset: string, amount: string, memo: string }}
 */
function buildPaymentRequest(invoice) {
  const keypair = hospitalKeypair();
  // Convert kobo → USDC (1 USD = 100 kobo for Testnet; production uses live anchor rate)
  const usdcAmount = (invoice.totalKobo / 100).toFixed(7);
  // Memo is the invoice Mongo _id string (24 hex chars, well within 28-byte limit)
  const memo = invoice._id.toString().slice(0, 28);

  return {
    destination: keypair.publicKey(),
    asset: 'USDC',
    issuer: usdcAsset().getIssuer(),
    amount: usdcAmount,
    memo,
    network: (config.stellar.network || 'TESTNET').toUpperCase(),
  };
}

// ── Payment verification ──────────────────────────────────────────────────────

/**
 * Verify a payment to the hospital account on Horizon.
 *
 * Checks:
 *   1. The destination matches the hospital public key.
 *   2. The asset is USDC from the expected issuer.
 *   3. The amount is >= the expected USDC amount.
 *   4. The memo matches the invoice reference.
 *
 * Idempotency: callers should check invoice.status === 'paid' before calling.
 *
 * @param {{
 *   expectedMemo: string,
 *   expectedUsdcAmount: number,
 * }} params
 * @returns {Promise<{ txHash: string, amount: string, found: boolean }>}
 */
async function verifyPaymentToHospital({ expectedMemo, expectedUsdcAmount }) {
  const server = getHorizon();
  const keypair = hospitalKeypair();
  const destination = keypair.publicKey();
  const usdc = usdcAsset();

  // Fetch recent incoming payments (last 200 records) to find the matching tx.
  // In production this should use streaming; polling is acceptable for Testnet.
  const payments = await server
    .payments()
    .forAccount(destination)
    .limit(200)
    .order('desc')
    .call();

  for (const record of payments.records) {
    if (record.type !== 'payment') continue;
    if (record.to !== destination) continue;
    if (record.asset_code !== usdc.getCode()) continue;
    if (record.asset_issuer !== usdc.getIssuer()) continue;

    // Check memo on the parent transaction
    // eslint-disable-next-line no-await-in-loop
    const tx = await record.transaction();
    const memo = tx.memo || '';
    if (memo !== expectedMemo) continue;

    const paid = parseFloat(record.amount);
    if (paid < expectedUsdcAmount - 0.0000001) continue; // float tolerance

    return { txHash: tx.hash, amount: record.amount, found: true };
  }

  return { found: false };
}

// ── Transaction builder ───────────────────────────────────────────────────────

/**
 * Build and sign (but do NOT submit) a Stellar payment transaction.
 * Used for audit hash anchoring (memo = SHA-256 hash, asset = XLM, amount = 0.0000001).
 *
 * @param {{
 *   sourceKeypair: Keypair,
 *   destination: string,
 *   assetArg: Asset,
 *   amount: string,
 *   memoText: string,
 *   accountObj: Horizon.AccountResponse,
 * }} params
 * @returns {Transaction}
 */
function buildSignedTransaction({
  sourceKeypair,
  destination,
  assetArg,
  amount,
  memoText,
  accountObj,
}) {
  const tx = new TransactionBuilder(accountObj, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: assetArg,
        amount,
      }),
    )
    .addMemo(Memo.text(memoText.slice(0, 28))) // Memo.text max 28 bytes
    .setTimeout(180)
    .build();

  tx.sign(sourceKeypair);
  return tx;
}

/**
 * Submit a pre-built signed transaction to Horizon.
 * @param {Transaction} tx
 * @returns {Promise<Horizon.HorizonApi.SubmitTransactionResponse>}
 */
async function submitTransaction(tx) {
  const server = getHorizon();
  return server.submitTransaction(tx);
}

// ── Anchor hash helper ────────────────────────────────────────────────────────

/**
 * Anchor an arbitrary hex string (typically a SHA-256 hash) to the Stellar
 * ledger as a memo on a near-zero XLM payment to the hospital account itself.
 *
 * The transaction carries no patient data — only the hash and a timestamp.
 *
 * @param {string} hashHex  64-char hex string (first 28 bytes used as memo)
 * @returns {Promise<string>}  Stellar transaction hash
 */
async function anchorHash(hashHex) {
  const keypair = hospitalKeypair();
  const server = getHorizon();
  const account = await server.loadAccount(keypair.publicKey());

  const tx = buildSignedTransaction({
    sourceKeypair: keypair,
    destination: keypair.publicKey(), // payment to self — minimal cost
    assetArg: Asset.native(), // XLM
    amount: '0.0000100', // dust amount (100 stroops)
    memoText: hashHex.slice(0, 28), // first 28 chars of hash
    accountObj: account,
  });

  const result = await server.submitTransaction(tx);
  // Never log the keypair; only log the public key and tx hash
  logger.info('Audit hash anchored to Stellar', {
    publicKey: keypair.publicKey(),
    txHash: result.hash,
    memoPrefix: hashHex.slice(0, 8) + '...',
  });
  return result.hash;
}

module.exports = {
  getHorizon,
  loadAccount,
  hospitalKeypair,
  networkPassphrase,
  usdcAsset,
  buildPaymentRequest,
  verifyPaymentToHospital,
  buildSignedTransaction,
  submitTransaction,
  anchorHash,
};
