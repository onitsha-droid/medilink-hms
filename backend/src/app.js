'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { globalLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');

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

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(globalLimiter);

  // ── Business routes ────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);

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
