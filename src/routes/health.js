const express = require('express');
const router = express.Router();
const redis = require('../redis');

router.get('/', async (req, res) => {
  try {
    const pong = await redis.ping();
    res.status(200).json({
      status: 'OK',
      redis: pong,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      redis: 'DOWN',
      error: error.message,
    });
  }
});

/**
 * Live Stats / Monitoring Endpoint (Step 13 Stretch)
 */
router.get('/stats', async (req, res) => {
  try {
    const bucketKeys = await redis.keys('bucket:*');
    const windowKeys = await redis.keys('window:*');
    const configKeys = await redis.keys('config:*');

    res.status(200).json({
      status: 'OK',
      active_token_buckets: bucketKeys.length,
      active_sliding_windows: windowKeys.length,
      configured_clients: configKeys.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
