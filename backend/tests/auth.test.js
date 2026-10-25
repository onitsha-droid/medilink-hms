'use strict';

const request = require('supertest');
const express = require('express');
const createApp = require('../src/app');
const { User, ROLES } = require('../src/models/User');
const { authenticate, authorize } = require('../src/middleware/auth');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');

setupTestDB();

// Build the app with test-only routes injected BEFORE the 404 handler
const app = createApp((a) => {
  const testRouter = express.Router();
  testRouter.get(
    '/admin-only',
    authenticate,
    authorize('Admin'),
    (_req, res) => res.json({ ok: true }),
  );
  testRouter.get(
    '/clinical',
    authenticate,
    authorize('Doctor', 'Nurse', 'Lab Scientist'),
    (_req, res) => res.json({ ok: true }),
  );
  a.use('/test', testRouter);
});

// ── /auth/login ───────────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  const credentials = { email: 'doctor@medilink.dev', password: 'Medilink@2026' };

  beforeEach(async () => {
    await User.create({
      name: 'Dr Test',
      email: credentials.email,
      password: credentials.password,
      role: 'Doctor',
    });
  });

  it('returns 200 with a token and user for valid credentials', async () => {
    const res = await request(app).post('/auth/login').send(credentials);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.role).toBe('Doctor');
    expect(res.body.user.password).toBeUndefined();
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ ...credentials, password: 'WrongPassword1!' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'irrelevant' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'bad' });
    expect(res.status).toBe(400);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  it('returns 200 with the authenticated user', async () => {
    const { token, user } = await createUserAndToken({ role: 'Nurse' });
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.role).toBe('Nurse');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });
});

// ── RBAC on a sample protected route ─────────────────────────────────────────
describe('RBAC middleware — /test/admin-only (Admin only)', () => {
  for (const role of ROLES) {
    const shouldAllow = role === 'Admin';
    it(`${shouldAllow ? 'allows' : 'denies'} role: ${role}`, async () => {
      const { token } = await createUserAndToken({ role });
      const res = await request(app)
        .get('/test/admin-only')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(shouldAllow ? 200 : 403);
    });
  }

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/test/admin-only');
    expect(res.status).toBe(401);
  });
});

describe('RBAC middleware — /test/clinical (Doctor, Nurse, Lab Scientist)', () => {
  const allowed = new Set(['Doctor', 'Nurse', 'Lab Scientist']);
  for (const role of ROLES) {
    it(`${allowed.has(role) ? 'allows' : 'denies'} role: ${role}`, async () => {
      const { token } = await createUserAndToken({ role });
      const res = await request(app)
        .get('/test/clinical')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(allowed.has(role) ? 200 : 403);
    });
  }
});

// ── Expired token ─────────────────────────────────────────────────────────────
describe('Expired JWT', () => {
  it('returns 401 for an expired token', async () => {
    const jwt = require('jsonwebtoken');
    const { jwt: jwtConfig } = require('../src/config');
    const expiredToken = jwt.sign(
      { role: 'Admin', email: 'a@b.com' },
      jwtConfig.secret,
      { subject: 'fakeid', expiresIn: '-1s' },
    );
    const res = await request(app)
      .get('/test/admin-only')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});
