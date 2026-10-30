'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const createApp = require('../src/app');
const { sanitize } = require('../src/utils/logger');
const { authLimiter, paymentLimiter, globalLimiter } = require('../src/middleware/rateLimiter');
const { signToken } = require('../src/middleware/auth');

function authHeader(role, id = new mongoose.Types.ObjectId()) {
  const token = signToken({ _id: id, role, email: `${role.toLowerCase().replace(/\s+/g, '')}@test.com` });
  return `Bearer ${token}`;
}

describe('Security and Auth Audit', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  describe('Helmet & Security Headers', () => {
    it('sets standard HTTP security headers on responses', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('x-dns-prefetch-control');
      expect(res.headers).toHaveProperty('x-frame-options');
      expect(res.headers).toHaveProperty('x-download-options');
      expect(res.headers).toHaveProperty('x-content-type-options');
      expect(res.headers).toHaveProperty('x-xss-protection');
    });
  });

  describe('Rate Limiters', () => {
    it('exports globalLimiter, authLimiter, and paymentLimiter middleware', () => {
      expect(typeof globalLimiter).toBe('function');
      expect(typeof authLimiter).toBe('function');
      expect(typeof paymentLimiter).toBe('function');
    });
  });

  describe('Log Sanitization (Secrets & PHI Redaction)', () => {
    it('recursively redacts credentials, secrets, and PHI', () => {
      const sensitiveData = {
        name: 'John Doe',
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        nin: '12345678901',
        phone: '+2348012345678',
        medicalHistory: 'Hypertension, Diabetes',
        diagnoses: ['Malaria', 'Typhoid'],
        nested: {
          apiKey: 'pk_live_secret123',
          dateOfBirth: '1990-01-01',
          results: 'Abnormal WBC',
          hospitalStellarSecret: 'SBXYZ...',
          normalField: 'safeValue',
        },
      };

      const sanitized = sanitize(sensitiveData);

      expect(sanitized.name).toBe('John Doe');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.nin).toBe('[REDACTED]');
      expect(sanitized.phone).toBe('[REDACTED]');
      expect(sanitized.medicalHistory).toBe('[REDACTED]');
      expect(sanitized.diagnoses).toBe('[REDACTED]');
      expect(sanitized.nested.apiKey).toBe('[REDACTED]');
      expect(sanitized.nested.dateOfBirth).toBe('[REDACTED]');
      expect(sanitized.nested.results).toBe('[REDACTED]');
      expect(sanitized.nested.hospitalStellarSecret).toBe('[REDACTED]');
      expect(sanitized.nested.normalField).toBe('safeValue');
    });
  });

  describe('Strict Input Validation', () => {
    it('rejects invalid query parameters on /appointments with 400', async () => {
      const token = authHeader('Front Desk');
      const res = await request(app)
        .get('/appointments?date=not-a-valid-date')
        .set('Authorization', token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid date format/i);
    });

    it('rejects invalid query parameters on /invoices with 400', async () => {
      const token = authHeader('Billing Officer');
      const res = await request(app)
        .get('/invoices?status=invalid_status')
        .set('Authorization', token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid status/i);
    });

    it('rejects invalid query parameters on /hmo-claims with 400', async () => {
      const token = authHeader('Billing Officer');
      const res = await request(app)
        .get('/hmo-claims?status=unknown_claim_status')
        .set('Authorization', token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid status/i);
    });

    it('rejects invalid query parameters on /audit-logs with 400', async () => {
      const token = authHeader('Admin');
      const res = await request(app)
        .get('/audit-logs?anchorStatus=not_valid')
        .set('Authorization', token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid anchorStatus/i);
    });

    it('rejects invalid mongo id parameter on /payments/status/:invoiceId with 400', async () => {
      const token = authHeader('Patient');
      const res = await request(app)
        .get('/payments/status/bad-id')
        .set('Authorization', token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid invoice ID/i);
    });
  });

  describe('RBAC & Auth Enforcement Audit', () => {
    it('rejects unauthenticated requests on protected routes with 401', async () => {
      const protectedEndpoints = [
        ['get', '/auth/me'],
        ['get', '/patients/by-hospital-id/ML-12345678'],
        ['get', '/clinics'],
        ['get', '/appointments'],
        ['get', '/queue/507f1f77bcf86cd799439011'],
        ['get', '/vitals/by-entry/507f1f77bcf86cd799439011'],
        ['get', '/encounters/my-queue'],
        ['get', '/lab-requests/worklist'],
        ['get', '/prescriptions/inbox'],
        ['get', '/inventory'],
        ['get', '/invoices'],
        ['get', '/hmo-claims'],
        ['get', '/audit-logs'],
        ['get', '/admin/dashboard'],
      ];

      for (const [method, url] of protectedEndpoints) {
        const res = await request(app)[method](url);
        expect(res.status).toBe(401);
      }
    });

    it('rejects unauthorized role access on role-restricted endpoints with 403', async () => {
      // Patient cannot access admin dashboard
      const patientToken = authHeader('Patient');
      const adminRes = await request(app)
        .get('/admin/dashboard')
        .set('Authorization', patientToken);
      expect(adminRes.status).toBe(403);

      // Front Desk cannot access doctor's encounter queue
      const frontDeskToken = authHeader('Front Desk');
      const doctorRes = await request(app)
        .get('/encounters/my-queue')
        .set('Authorization', frontDeskToken);
      expect(doctorRes.status).toBe(403);

      // Nurse cannot access pharmacist inbox
      const nurseToken = authHeader('Nurse');
      const pharmRes = await request(app)
        .get('/prescriptions/inbox')
        .set('Authorization', nurseToken);
      expect(pharmRes.status).toBe(403);
    });
  });
});
