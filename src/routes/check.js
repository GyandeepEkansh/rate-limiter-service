const express = require('express');
const router = express.Router();
const config = require('../config');
const redis = require('../redis');
const { checkRateLimit } = require('../limiters');
const { setRateLimitHeaders } = require('../middleware/headers');

/**
 * Look up client config from Redis or fall back to defaults
 * @param {string} key
 */
async function getClientConfig(key) {
  const configKey = `config:${key}`;
  const stored = await redis.hgetall(configKey);

  if (stored && Object.keys(stored).length > 0) {
    return {
      algorithm: stored.algorithm || config.defaults.algorithm,
      burst: stored.burst ? parseInt(stored.burst, 10) : config.defaults.burst,
      rate: stored.rate ? parseFloat(stored.rate) : config.defaults.rate,
      limit: stored.limit ? parseInt(stored.limit, 10) : config.defaults.limit,
      windowSeconds: stored.window_seconds ? parseFloat(stored.window_seconds) : config.defaults.windowSeconds,
    };
  }

  return {
    algorithm: config.defaults.algorithm,
    burst: config.defaults.burst,
    rate: config.defaults.rate,
    limit: config.defaults.limit,
    windowSeconds: config.defaults.windowSeconds,
  };
}

router.post('/', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "key" field in request body.' });
    }

    // 1. Look up per-client configuration (or use defaults)
    const clientConfig = await getClientConfig(key);

    // 2. Call rate limiter factory
    const result = await checkRateLimit(key, clientConfig);

    // 3. Set standard rate-limit headers on every response
    setRateLimitHeaders(res, result);

    if (result.allowed) {
      return res.status(200).json({
        allowed: true,
        remaining: result.remaining,
        limit: result.limit,
      });
    } else {
      return res.status(429).json({
        allowed: false,
        retry_after: result.retry_after,
        remaining: result.remaining,
        limit: result.limit,
      });
    }
  } catch (error) {
    console.error('Error in /check endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.getClientConfig = getClientConfig;
