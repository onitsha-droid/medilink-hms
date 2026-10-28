'use strict';

/**
 * Tests for auditService and the /audit-logs routes.
 *
 * Covers:
 *  - Hash determinism (same inputs → same hash)
 *  - Tamper detection (modified hashPayload → verify returns valid=false)
 *  - No PHI in hash payload
 *  - Retry on Horizon failure (anchorPendingLogs retries up to MAX_ATTEMPTS)
 *  - anchorPendingLogs marks logs anchored on success, failed on error
 *  - Admin verify endpoint (GET /audit-logs/:id/verify)
 */

process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_key';
process.env.STELLAR_NETWORK = 'TESTNET';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.HOSPITAL_STELLAR_SECRET = 'SD5RQO5SI4GXPSU5NGM5F526BE22BYKPKDVEKWBH2GAG63HPCJ5UJVMS';

const crypto = require('crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { AuditLog } = require('../src/models/AuditLog');
const {
  computeHash,
  createAuditLog,
  verifyAuditLog,
  anchorPendingLogs,
} = require('../src/services/auditService');
const stellar = require('../src/services/stellar');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

// ── computeHash: determinism ──────────────────────────────────────────────────

describe('computeHash()', () => {
  const params = {
    userId:    'user_abc123',
    patientId: 'patient_def456',
    action:    'read:patient_history',
    timestamp: new Date('2026-10-28T12:00:00Z'),
    salt:      'deadbeef1234567890abcdef',
  };

  it('is deterministic — same inputs always produce the same hash', () => {
    const r1 = computeHash(params);
    const r2 = computeHash(params);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.canonical).toBe(r2.canonical);
  });

  it('changes when any input field changes', () => {
    const base = computeHash(params);
    const diffUser = computeHash({ ...params, userId: 'other_user' });
    const diffAction = computeHash({ ...params, action: 'write:note' });
    const diffSalt = computeHash({ ...params, salt: 'different_salt_here' });
    expect(base.hash).not.toBe(diffUser.hash);
    expect(base.hash).not.toBe(diffAction.hash);
    expect(base.hash).not.toBe(diffSalt.hash);
  });

  it('produces a 64-char hex SHA-256 digest', () => {
    const { hash } = computeHash(params);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── No PHI in hash payload ────────────────────────────────────────────────────

describe('createAuditLog() — no PHI', () => {
  it('hashPayload contains only pseudonymous IDs and action — no clinical strings', async () => {
    const log = await createAuditLog({
      userId:    'user_000001',
      patientId: 'patient_000002',
      action:    'read:patient_history',
      encounterId: 'encounter_000003',
      timestamp: new Date(),
    });

    // Must NOT contain real names, diagnoses, or clinical keywords
    expect(log.hashPayload).not.toMatch(/firstname|lastname|diagnosis|dob|dateofbirth/i);
    // Must contain the pseudonymous IDs
    expect(log.hashPayload).toContain('user_000001');
    expect(log.hashPayload).toContain('patient_000002');
    expect(log.hashPayload).toContain('read:patient_history');
    // Must contain the salt
    expect(log.hashPayload).toContain(log.salt);
  });

  it('each call generates a unique salt', async () => {
    const l1 = await createAuditLog({ userId: 'u1', patientId: 'p1', action: 'read:x', timestamp: new Date() });
    const l2 = await createAuditLog({ userId: 'u1', patientId: 'p1', action: 'read:x', timestamp: new Date() });
    expect(l1.salt).not.toBe(l2.salt);
    // Different salts → different hashes even for identical events
    expect(l1.hash).not.toBe(l2.hash);
  });
});

// ── verifyAuditLog: tamper detection ─────────────────────────────────────────

describe('verifyAuditLog()', () => {
  it('returns valid=true for an unmodified log', async () => {
    const log = await createAuditLog({
      userId: 'userA', patientId: 'patB', action: 'write:note', timestamp: new Date(),
    });
    const result = await verifyAuditLog(log._id.toString());
    expect(result.valid).toBe(true);
    expect(result.recomputedHash).toBe(result.storedHash);
  });

  it('returns valid=false when hashPayload has been tampered', async () => {
    const log = await createAuditLog({
      userId: 'userA', patientId: 'patB', action: 'write:note', timestamp: new Date(),
    });

    // Directly corrupt the hashPayload in MongoDB (simulating tampering)
    await AuditLog.findByIdAndUpdate(log._id, {
      $set: { hashPayload: log.hashPayload + '_TAMPERED' },
    });

    const result = await verifyAuditLog(log._id.toString());
    expect(result.valid).toBe(false);
    expect(result.recomputedHash).not.toBe(result.storedHash);
  });

  it('throws 404 for an unknown log ID', async () => {
    const fakeId = '000000000000000000000000';
    await expect(verifyAuditLog(fakeId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── anchorPendingLogs: Horizon success ────────────────────────────────────────

describe('anchorPendingLogs()', () => {
  afterEach(() => jest.restoreAllMocks());

  it('anchors pending logs and sets stellarTxHash', async () => {
    jest.spyOn(stellar, 'anchorHash').mockResolvedValue('mock_stellar_tx_123');

    const log = await createAuditLog({
      userId: 'u1', patientId: 'p1', action: 'read:history', timestamp: new Date(),
    });
    expect(log.anchorStatus).toBe('pending');

    await anchorPendingLogs();

    const updated = await AuditLog.findById(log._id).lean();
    expect(updated.anchorStatus).toBe('anchored');
    expect(updated.stellarTxHash).toBe('mock_stellar_tx_123');
    expect(updated.anchorAttempts).toBe(1);
  });

  it('retries on Horizon failure — sets status=failed, increments attempts', async () => {
    jest.spyOn(stellar, 'anchorHash').mockRejectedValue(new Error('Horizon 503'));

    const log = await createAuditLog({
      userId: 'u2', patientId: 'p2', action: 'write:prescription', timestamp: new Date(),
    });

    // First failure
    await anchorPendingLogs();
    const after1 = await AuditLog.findById(log._id).lean();
    expect(after1.anchorStatus).toBe('failed');
    expect(after1.anchorAttempts).toBe(1);

    // Second attempt — still fails
    await anchorPendingLogs();
    const after2 = await AuditLog.findById(log._id).lean();
    expect(after2.anchorAttempts).toBe(2);

    // Third attempt — hits MAX_ATTEMPTS (3), then stops retrying
    await anchorPendingLogs();
    const after3 = await AuditLog.findById(log._id).lean();
    expect(after3.anchorAttempts).toBe(3);

    // Fourth call — log is at MAX_ATTEMPTS (3), not picked up again
    jest.spyOn(stellar, 'anchorHash').mockResolvedValue('late_success');
    await anchorPendingLogs();
    const after4 = await AuditLog.findById(log._id).lean();
    // Still at 3 attempts — not retried further
    expect(after4.anchorAttempts).toBe(3);
    expect(after4.anchorStatus).toBe('failed');
  });

  it('does nothing when no pending logs exist', async () => {
    const spy = jest.spyOn(stellar, 'anchorHash');
    await anchorPendingLogs();
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── GET /audit-logs/:id/verify (HTTP endpoint) ────────────────────────────────

describe('GET /audit-logs/:id/verify', () => {
  it('Admin can verify an untampered audit log', async () => {
    const { token: adminToken } = await createUserAndToken({
      role: 'Admin', email: `admin${uid()}@t.com`,
    });

    const log = await createAuditLog({
      userId: 'userX', patientId: 'patY', action: 'read:labs', timestamp: new Date(),
    });

    const res = await request(app)
      .get(`/audit-logs/${log._id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.recomputedHash).toBe(res.body.storedHash);
  });

  it('returns valid=false for a tampered log', async () => {
    const { token: adminToken } = await createUserAndToken({
      role: 'Admin', email: `admin${uid()}@t.com`,
    });

    const log = await createAuditLog({
      userId: 'userX', patientId: 'patZ', action: 'read:labs', timestamp: new Date(),
    });
    await AuditLog.findByIdAndUpdate(log._id, {
      $set: { hashPayload: log.hashPayload + '_TAMPERED' },
    });

    const res = await request(app)
      .get(`/audit-logs/${log._id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('returns 403 for non-Admin role', async () => {
    const { token: nurseToken } = await createUserAndToken({
      role: 'Nurse', email: `nurse${uid()}@t.com`,
    });
    const log = await createAuditLog({
      userId: 'u', patientId: 'p', action: 'read:vitals', timestamp: new Date(),
    });

    const res = await request(app)
      .get(`/audit-logs/${log._id}/verify`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid Mongo ID', async () => {
    const { token: adminToken } = await createUserAndToken({
      role: 'Admin', email: `admin${uid()}@t.com`,
    });

    const res = await request(app)
      .get('/audit-logs/not-a-valid-id/verify')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});
