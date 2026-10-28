'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { globalLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const patientRouter = require('./routes/patients');
const clinicRouter = require('./routes/clinics');
const appointmentRouter = require('./routes/appointments');
const queueRouter = require('./routes/queue');
const vitalsRouter = require('./routes/vitals');
const encountersRouter = require('./routes/encounters');
const labRequestsRouter = require('./routes/labRequests');
const prescriptionsRouter = require('./routes/prescriptions');
const inventoryRouter = require('./routes/inventory');
const invoicesRouter = require('./routes/invoices');
const paymentsRouter = require('./routes/payments');
const hmoClaimsRouter = require('./routes/hmoClaims');

/**
 * createApp — builds and returns the Express application.
 *
 * Accepts an optional `extraRoutes` callback so tests can inject test-only
 * routers before the 404 catch-all and error handler are registered.
 *
 * @param {(app: express.Application) => void} [extraRoutes]
 */
function createApp(extraRoutes) {
  const app = express();

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ───────────────────────────────────────────────────────────────────
  app.use(cors());

  // ── Request logging ────────────────────────────────────────────────────────
  app.use(requestLogger());

  // ── Paystack webhook — must be BEFORE express.json() so it gets the raw body
  app.use('/payments/webhook', express.raw({ type: '*/*' }));

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(globalLimiter);

  // ── Business routes ────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/patients', patientRouter);
  app.use('/clinics', clinicRouter);
  app.use('/appointments', appointmentRouter);
  app.use('/queue', queueRouter);
  app.use('/vitals', vitalsRouter);
  app.use('/encounters', encountersRouter);
  app.use('/lab-requests', labRequestsRouter);
  app.use('/prescriptions', prescriptionsRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/invoices', invoicesRouter);
  app.use('/payments', paymentsRouter);
  app.use('/hmo-claims', hmoClaimsRouter);

  // ── Optional test / extra routes (must be before 404 handler) ─────────────
  if (typeof extraRoutes === 'function') {
    extraRoutes(app);
  }

  // ── 404 catch-all ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // ── Central error handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
