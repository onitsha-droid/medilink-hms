'use strict';

process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medilink_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret_key';
process.env.STELLAR_NETWORK = 'TESTNET';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.HOSPITAL_STELLAR_SECRET = 'SD5RQO5SI4GXPSU5NGM5F526BE22BYKPKDVEKWBH2GAG63HPCJ5UJVMS';

const request = require('supertest');
const mongoose = require('mongoose');
const createApp = require('../src/app');
const { setupTestDB } = require('./helpers/db');
const { createUserAndToken } = require('./helpers/auth');
const { authorize } = require('../src/middleware/auth');
const { Patient } = require('../src/models/Patient');
const { Clinic } = require('../src/models/Clinic');
const { Encounter } = require('../src/models/Encounter');
const { Invoice } = require('../src/models/Invoice');
const { checkIn } = require('../src/services/queueService');
const { createAuditLog, startAnchorJob, stopAnchorJob } = require('../src/services/auditService');
const { emitRecordAccessed } = require('../src/services/recordAudit');
const stellar = require('../src/services/stellar');
const config = require('../src/config');

setupTestDB();
const app = createApp();

let seq = 0;
const uid = () => String(++seq).padStart(6, '0');

async function makeFixtures() {
  const id = uid();
  const { token: patientToken, user: patientUser } = await createUserAndToken({
    role: 'Patient',
    email: `patient-${id}@test.com`,
  });
  const { token: adminToken, user: adminUser } = await createUserAndToken({
    role: 'Admin',
    email: `admin-${id}@test.com`,
  });
  const { token: frontDeskToken, user: frontDeskUser } = await createUserAndToken({
    role: 'Front Desk',
    email: `frontdesk-${id}@test.com`,
  });
  const { token: nurseToken, user: nurseUser } = await createUserAndToken({
    role: 'Nurse',
    email: `nurse-${id}@test.com`,
  });
  const { token: doctorToken, user: doctorUser } = await createUserAndToken({
    role: 'Doctor',
    email: `doctor-${id}@test.com`,
  });

  const clinic = await Clinic.create({
    name: `Coverage Clinic ${id}`,
    avgConsultationMinutes: 15,
  });

  const patient = await Patient.create({
    firstName: 'Chidinma',
    lastName: 'Okoro',
    dateOfBirth: '1992-06-15',
    gender: 'female',
    phone: `+2348000${id}`,
    registeredBy: frontDeskUser._id,
  });

  const invoice = await Invoice.create({
    patient: patient._id,
    lineItems: [{ description: 'General Consultation', amountKobo: 250000 }],
    issuedBy: doctorUser._id,
    status: 'pending',
  });

  return {
    patientToken,
    adminToken,
    frontDeskToken,
    nurseToken,
    doctorToken,
    patient,
    clinic,
    invoice,
    doctorUser,
    frontDeskUser,
  };
}

describe('Coverage Boost: RBAC, Payments, Queue, and Audit', () => {
  // ── 1. RBAC (src/middleware/auth.js) ─────────────────────────────────────────
  describe('RBAC Middleware', () => {
    it('returns 401 if authorize() is invoked without req.user', () => {
      const middleware = authorize('Admin');
      const req = {};
      const res = {};
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
      expect(err.message).toMatch(/Authentication required/i);
    });
  });

  // ── 2. Payments Route (src/routes/payments.js) ──────────────────────────────
  describe('Payments Endpoints', () => {
    let originalFetch;

    beforeAll(() => {
      originalFetch = global.fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    describe('POST /payments/initialize', () => {
      it('initializes a Paystack transaction successfully', async () => {
        const { patientToken, invoice } = await makeFixtures();

        global.fetch = jest.fn().mockResolvedValue({
          json: async () => ({
            status: true,
            data: {
              authorization_url: 'https://checkout.paystack.com/auth-123',
              reference: `ML-${invoice._id}-ref`,
              access_code: 'access_123',
            },
          }),
        });

        const res = await request(app)
          .post('/payments/initialize')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString(), email: 'patient@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.authorizationUrl).toBe('https://checkout.paystack.com/auth-123');
        expect(res.body.reference).toBe(`ML-${invoice._id}-ref`);
      });

      it('returns 404 when invoice does not exist', async () => {
        const { patientToken } = await makeFixtures();
        const fakeId = new mongoose.Types.ObjectId().toString();

        const res = await request(app)
          .post('/payments/initialize')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: fakeId, email: 'patient@example.com' });

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/Invoice not found/i);
      });

      it('returns 400 when invoice is already paid', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.status = 'paid';
        await invoice.save();

        const res = await request(app)
          .post('/payments/initialize')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString(), email: 'patient@example.com' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already paid/i);
      });

      it('returns 400 when invoice total is zero or negative', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.lineItems = [];
        await invoice.save();

        const res = await request(app)
          .post('/payments/initialize')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString(), email: 'patient@example.com' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/must be greater than zero/i);
      });

      it('returns 503 if Paystack secret is unconfigured', async () => {
        const { patientToken, invoice } = await makeFixtures();
        const origKey = config.paystack.secretKey;
        config.paystack.secretKey = '';

        try {
          const res = await request(app)
            .post('/payments/initialize')
            .set('Authorization', `Bearer ${patientToken}`)
            .send({ invoiceId: invoice._id.toString(), email: 'patient@example.com' });

          expect(res.status).toBe(503);
          expect(res.body.error).toMatch(/Payment gateway not configured/i);
        } finally {
          config.paystack.secretKey = origKey;
        }
      });

      it('returns 502 if Paystack returns status: false', async () => {
        const { patientToken, invoice } = await makeFixtures();

        global.fetch = jest.fn().mockResolvedValue({
          json: async () => ({ status: false, message: 'Invalid API key' }),
        });

        const res = await request(app)
          .post('/payments/initialize')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString(), email: 'patient@example.com' });

        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/Payment initialization failed/i);
      });
    });

    describe('GET /payments/status/:invoiceId', () => {
      it('returns payment and invoice status', async () => {
        const { patientToken, invoice } = await makeFixtures();

        const res = await request(app)
          .get(`/payments/status/${invoice._id}`)
          .set('Authorization', `Bearer ${patientToken}`);

        expect(res.status).toBe(200);
        expect(res.body.invoice.status).toBe('pending');
        expect(res.body.invoice.totalKobo).toBe(250000);
      });

      it('returns 404 when invoice is not found', async () => {
        const { patientToken } = await makeFixtures();
        const fakeId = new mongoose.Types.ObjectId();

        const res = await request(app)
          .get(`/payments/status/${fakeId}`)
          .set('Authorization', `Bearer ${patientToken}`);

        expect(res.status).toBe(404);
      });
    });

    describe('POST /payments/stablecoin/request', () => {
      it('returns stellar payment request details', async () => {
        const { patientToken, invoice } = await makeFixtures();

        jest.spyOn(stellar, 'buildPaymentRequest').mockReturnValueOnce({
          destinationAddress: 'GBXYZ...',
          assetCode: 'USDC',
          amountUsdc: 25.0,
          memo: invoice._id.toString().slice(0, 28),
        });

        const res = await request(app)
          .post('/payments/stablecoin/request')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.paymentRequest.assetCode).toBe('USDC');
        expect(res.body.paymentRequest.amountUsdc).toBe(25.0);
      });

      it('returns 404 if invoice not found', async () => {
        const { patientToken } = await makeFixtures();
        const fakeId = new mongoose.Types.ObjectId().toString();

        const res = await request(app)
          .post('/payments/stablecoin/request')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: fakeId });

        expect(res.status).toBe(404);
      });

      it('returns 400 if invoice is not pending', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.status = 'cancelled';
        await invoice.save();

        const res = await request(app)
          .post('/payments/stablecoin/request')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invoice is already cancelled/i);
      });

      it('returns 400 if invoice total is zero or negative', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.lineItems = [];
        await invoice.save();

        const res = await request(app)
          .post('/payments/stablecoin/request')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/must be greater than zero/i);
      });

      it('returns 503 if stellar throws configuration error', async () => {
        const { patientToken, invoice } = await makeFixtures();

        jest.spyOn(stellar, 'buildPaymentRequest').mockImplementationOnce(() => {
          throw new Error('Missing hospital secret');
        });

        const res = await request(app)
          .post('/payments/stablecoin/request')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(503);
      });
    });

    describe('POST /payments/stablecoin/confirm', () => {
      it('returns 202 when payment is not yet detected on Horizon', async () => {
        const { patientToken, invoice } = await makeFixtures();

        jest.spyOn(stellar, 'verifyPaymentToHospital').mockResolvedValueOnce({
          found: false,
        });

        const res = await request(app)
          .post('/payments/stablecoin/confirm')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(202);
        expect(res.body.confirmed).toBe(false);
      });

      it('confirms payment, marks invoice paid, and creates Payment record', async () => {
        const { patientToken, invoice } = await makeFixtures();

        jest.spyOn(stellar, 'verifyPaymentToHospital').mockResolvedValueOnce({
          found: true,
          txHash: 'stellar_tx_hash_12345',
        });

        const res = await request(app)
          .post('/payments/stablecoin/confirm')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.confirmed).toBe(true);
        expect(res.body.invoice.status).toBe('paid');
        expect(res.body.invoice.paymentMethod).toBe('stablecoin');
      });

      it('handles idempotent confirmation on already-paid invoice via stablecoin', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.status = 'paid';
        invoice.paymentMethod = 'stablecoin';
        await invoice.save();

        const res = await request(app)
          .post('/payments/stablecoin/confirm')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.alreadyPaid).toBe(true);
      });

      it('returns 400 if invoice is already paid via fiat', async () => {
        const { patientToken, invoice } = await makeFixtures();
        invoice.status = 'paid';
        invoice.paymentMethod = 'fiat';
        await invoice.save();

        const res = await request(app)
          .post('/payments/stablecoin/confirm')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already paid via another method/i);
      });

      it('returns 503 if Horizon verification fails', async () => {
        const { patientToken, invoice } = await makeFixtures();

        jest.spyOn(stellar, 'verifyPaymentToHospital').mockRejectedValueOnce(
          new Error('Horizon connection timed out'),
        );

        const res = await request(app)
          .post('/payments/stablecoin/confirm')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({ invoiceId: invoice._id.toString() });

        expect(res.status).toBe(503);
      });
    });
  });

  // ── 3. Queue Router (src/routes/queue.js) ────────────────────────────────────
  describe('Queue Endpoints', () => {
    it('POST /queue/check-in assigns patient to queue', async () => {
      const { frontDeskToken, patient, clinic } = await makeFixtures();

      const res = await request(app)
        .post('/queue/check-in')
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          patientId: patient._id.toString(),
          clinicId: clinic._id.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.entry).toBeDefined();
      expect(res.body.position).toBeGreaterThanOrEqual(1);
    });

    it('POST /queue/check-in returns 404 for non-existent patient', async () => {
      const { frontDeskToken, clinic } = await makeFixtures();
      const fakePatientId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post('/queue/check-in')
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          patientId: fakePatientId,
          clinicId: clinic._id.toString(),
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Patient not found/i);
    });

    it('POST /queue/check-in returns 400 on invalid input', async () => {
      const { frontDeskToken } = await makeFixtures();

      const res = await request(app)
        .post('/queue/check-in')
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ patientId: 'invalid-id', clinicId: 'invalid-clinic' });

      expect(res.status).toBe(400);
    });

    it('POST /queue/:entryId/urgent allows Nurse to mark entry urgent and broadcasts via socket', async () => {
      const { nurseToken, patient, clinic, frontDeskUser } = await makeFixtures();

      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      app.set('io', mockIo);

      const { entry } = await checkIn({
        clinicId: clinic._id.toString(),
        patientId: patient._id.toString(),
        checkedInBy: frontDeskUser._id.toString(),
      });

      const res = await request(app)
        .post(`/queue/${entry._id}/urgent`)
        .set('Authorization', `Bearer ${nurseToken}`)
        .send({ reason: 'Severe respiratory distress' });

      expect(res.status).toBe(200);
      expect(res.body.entry.isUrgent).toBe(true);
      expect(res.body.entry.urgentReason).toBe('Severe respiratory distress');
      expect(mockIo.to).toHaveBeenCalled();
      expect(mockIo.emit).toHaveBeenCalled();
    });

    it('POST /queue/:entryId/urgent returns 400 on invalid param or missing reason', async () => {
      const { nurseToken } = await makeFixtures();

      const res = await request(app)
        .post('/queue/invalid-id/urgent')
        .set('Authorization', `Bearer ${nurseToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('GET /queue/:clinicId retrieves the clinic queue snapshot', async () => {
      const { frontDeskToken, clinic } = await makeFixtures();

      const res = await request(app)
        .get(`/queue/${clinic._id}`)
        .set('Authorization', `Bearer ${frontDeskToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.queue)).toBe(true);
    });

    it('GET /queue/:clinicId returns 400 on invalid clinic ID', async () => {
      const { frontDeskToken } = await makeFixtures();

      const res = await request(app)
        .get('/queue/invalid-clinic-id')
        .set('Authorization', `Bearer ${frontDeskToken}`);

      expect(res.status).toBe(400);
    });
  });

  // ── 4. Audit Modules (recordAudit.js, auditLogs.js, auditService.js) ────────
  describe('Audit Service & Logs', () => {
    it('recordAudit: emitRecordAccessed logs and emits to io', async () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      const params = {
        userId: new mongoose.Types.ObjectId().toString(),
        patientId: new mongoose.Types.ObjectId().toString(),
        action: 'read:patient_record',
        encounterId: new mongoose.Types.ObjectId().toString(),
      };

      emitRecordAccessed(mockIo, params);
      expect(mockIo.to).toHaveBeenCalledWith('audit:records');
      expect(mockIo.emit).toHaveBeenCalledWith(
        'record.accessed',
        expect.objectContaining({ action: 'read:patient_record' }),
      );

      // Also call without io
      expect(() => emitRecordAccessed(null, params)).not.toThrow();
    });

    it('GET /audit-logs lists logs with pagination and filters', async () => {
      const { adminToken } = await makeFixtures();
      const testUserId = new mongoose.Types.ObjectId().toString();
      const testPatientId = new mongoose.Types.ObjectId().toString();

      await createAuditLog({
        userId: testUserId,
        patientId: testPatientId,
        action: 'read:test_coverage',
        timestamp: new Date(),
      });

      const res = await request(app)
        .get(`/audit-logs?userId=${testUserId}&patientId=${testPatientId}&anchorStatus=pending&page=1&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('startAnchorJob starts and stopAnchorJob stops interval cleanly', () => {
      startAnchorJob();
      expect(() => stopAnchorJob()).not.toThrow();
    });
  });
});
