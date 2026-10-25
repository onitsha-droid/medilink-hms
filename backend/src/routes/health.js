'use strict';

const express = require('express');

const router = express.Router();

/**
 * GET /health
 * Returns a 200 JSON response with service status and timestamp.
 * Used by load balancers, Docker health checks, and CI smoke tests.
 */
router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'medilink-api',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
