const express = require('express');
const router = express.Router();
const redis = require('../redis');

/**
 * GET /health
 * Returns OK if Redis is reachable.
 */
router.get('/', async (req, res) => {
  try {
    const pong = await redis.ping();
    res.status(200).json({
      status: 'OK',
      redis: pong,
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      redis: 'DOWN',
      error: error.message,
    });
  }
});

module.exports = router;
