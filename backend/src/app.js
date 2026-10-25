'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { globalLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors());

// ── Request logging ───────────────────────────────────────────────────────────
app.use(requestLogger());

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Central error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

module.exports = app;
