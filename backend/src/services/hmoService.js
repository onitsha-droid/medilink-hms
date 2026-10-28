'use strict';

/**
 * hmoService.js — calls the Soroban HMO claims contract via the Stellar Node.js SDK.
 *
 * Privacy: no PHI ever leaves this service. Only pseudonymous policy IDs,
 * opaque invoice references (as 32-byte hex), numeric service codes, and
 * amounts are sent to the contract.
 *
 * The Soroban RPC call is made via the Stellar SDK's rpc.Server.
 * In tests this is mocked at the module level.
 */

const { rpc, xdr, Contract, Keypair, TransactionBuilder, BASE_FEE, Networks } = require('@stellar/stellar-sdk');
const config = require('../config');
const logger = require('../utils/logger');

// Reason code → human-readable text mapping (mirrors contract constants)
const REASON_TEXT = {
  0:    'Approved',
  1001: 'Policy not found',
  1002: 'Service code not covered by this policy',
  1003: 'Claim amount exceeds policy limit',
  1004: 'Duplicate claim reference',
  1005: 'Policy is inactive',
};

/**
 * Submit a claim to the Soroban HMO contract and return the result.
 *
 * Returns:
 *   { status: 'approved'|'rejected', payoutAmountKobo, reasonCode, reasonText, txHash }
 *
 * Throws if the Soroban RPC is unreachable or the contract call fails.
 *
 * @param {{
 *   invoiceId: string,   MongoDB ObjectId (24 hex chars) — used as opaque ref_id
 *   policyId: string,    Pseudonymous policy ID (hex string, padded to 32 bytes)
 *   serviceCode: number, Numeric service code
 *   amountKobo: number,  Requested amount
 * }} params
 */
async function submitHmoClaim({ invoiceId, policyId, serviceCode, amountKobo }) {
  const rpcUrl = config.stellar.sorobanRpcUrl;
  const contractId = config.stellar.hmoContractId;

  if (!rpcUrl || rpcUrl === 'https://soroban-testnet.stellar.org') {
    // Allow override in tests; fall through if not a placeholder
  }
  if (!contractId || contractId === 'C_replace_me') {
    throw new Error(
      'HMO_CONTRACT_ID is not configured. Deploy the contract first and set it in .env',
    );
  }

  const { Keypair: KP } = require('@stellar/stellar-sdk');
  const keypair = (() => {
    const secret = config.stellar.hospitalSecret;
    if (!secret || secret === 'S_replace_me') {
      throw new Error('HOSPITAL_STELLAR_SECRET is not configured');
    }
    return KP.fromSecret(secret);
  })();

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const network = (config.stellar.network || 'TESTNET').toUpperCase();
  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  // ── Convert invoiceId (24 hex chars) to 32-byte hex padded ───────────────
  // The contract expects BytesN<32>. We left-pad the 24-char invoiceId to 32 bytes.
  const refIdHex = invoiceId.toString().padEnd(64, '0');

  // ── Convert policyId string to 32-byte hex ────────────────────────────────
  // policyId is an opaque string from the patient's HMO record.
  // We hash it to 32 bytes using a simple hex encoding + padding.
  const policyIdHex = Buffer.from(policyId.slice(0, 32).padEnd(32, '\0')).toString('hex');

  // ── Build the contract call ───────────────────────────────────────────────
  const contract = new Contract(contractId);

  // Build submit_claim args using XDR ScVal
  const refIdBytes = xdr.ScVal.scvBytes(Buffer.from(refIdHex, 'hex'));
  const policyIdBytes = xdr.ScVal.scvBytes(Buffer.from(policyIdHex, 'hex'));
  const serviceCodeVal = xdr.ScVal.scvU32(serviceCode);
  const amountVal = xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString('0'),
      lo: xdr.Uint64.fromString(String(amountKobo)),
    }),
  );

  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'submit_claim',
        refIdBytes,
        policyIdBytes,
        serviceCodeVal,
        amountVal,
      ),
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const result = await server.sendTransaction(preparedTx);

  if (result.status === 'ERROR' || result.status === 'FAILED') {
    logger.error('Soroban submit_claim failed', {
      status: result.status,
      invoiceId,
      contractId,
    });
    throw new Error(`Soroban contract call failed: ${result.status}`);
  }

  // Poll for the transaction result
  let getResult;
  for (let i = 0; i < 20; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500));
    // eslint-disable-next-line no-await-in-loop
    getResult = await server.getTransaction(result.hash);
    if (getResult.status !== 'NOT_FOUND') break;
  }

  if (!getResult || getResult.status !== 'SUCCESS') {
    throw new Error(`Contract transaction did not succeed: ${getResult?.status}`);
  }

  // ── Parse the returned Claim struct from XDR ─────────────────────────────
  const returnVal = getResult.returnValue;
  const claimFields = returnVal.value().vec().value();

  // Field order matches the Rust struct: ref_id, policy_id, service_code, amount,
  //   status, reason_code, payout_amount
  const statusCode = Number(claimFields[4].value());    // u32: 1=approved, 2=rejected
  const reasonCode = Number(claimFields[5].value());    // u32
  const payoutParts = claimFields[6].value();           // i128 parts

  const payoutAmountKobo = Number(
    payoutParts instanceof xdr.Int128Parts
      ? payoutParts.lo().toBigInt()
      : payoutParts,
  );

  const approved = statusCode === 1;

  logger.info('Soroban HMO claim result', {
    invoiceId,
    contractId,
    approved,
    reasonCode,
    payoutAmountKobo,
    txHash: result.hash,
  });

  return {
    status: approved ? 'approved' : 'rejected',
    payoutAmountKobo: approved ? payoutAmountKobo : 0,
    reasonCode,
    reasonText: REASON_TEXT[reasonCode] ?? `Unknown reason (${reasonCode})`,
    txHash: result.hash,
  };
}

module.exports = { submitHmoClaim, REASON_TEXT };
