const express = require('express');
const router = express.Router();
const config = require('../config');
const redis = require('../redis');
const { checkRateLimit } = require('../limiters');
const { setRateLimitHeaders } = require('../middleware/headers');

// Short-lived in-memory LRU cache for client configs (5-second TTL, max 10,000 entries)
// Avoids an extra Redis HGETALL round-trip on every single /check request.
// Trade-off: Config changes made via Admin API take up to 5s to propagate
// across instances (eventual consistency), but cuts Redis read overhead by ~50%.
const MAX_CACHE_SIZE = 10000;
const CONFIG_CACHE_TTL_MS = 5000;
const configCache = new Map();

/**
 * Invalidate in-memory cache for a client key (called on Admin PUT/DELETE)
 * @param {string} key
 */
function invalidateClientConfigCache(key) {
  if (key) {
    configCache.delete(key);
  } else {
    configCache.clear();
  }
}

/**
 * Look up client config with in-memory caching and Redis fallback
 * @param {string} key
 */
async function getClientConfig(key) {
  const now = Date.now();
  const cached = configCache.get(key);
  if (cached && (now - cached.cachedAt) < CONFIG_CACHE_TTL_MS) {
    // Refresh LRU recency
    configCache.delete(key);
    configCache.set(key, cached);
    return cached.config;
  }

  const configKey = `config:${key}`;
  const stored = await redis.hgetall(configKey);

  let resolvedConfig;
  if (stored && Object.keys(stored).length > 0) {
    resolvedConfig = {
      algorithm: stored.algorithm || config.defaults.algorithm,
      burst: stored.burst ? parseInt(stored.burst, 10) : config.defaults.burst,
      rate: stored.rate ? parseFloat(stored.rate) : config.defaults.rate,
      limit: stored.limit ? parseInt(stored.limit, 10) : config.defaults.limit,
      windowSeconds: stored.window_seconds ? parseFloat(stored.window_seconds) : config.defaults.windowSeconds,
    };
  } else {
    resolvedConfig = {
      algorithm: config.defaults.algorithm,
      burst: config.defaults.burst,
      rate: config.defaults.rate,
      limit: config.defaults.limit,
      windowSeconds: config.defaults.windowSeconds,
    };
  }

  // Enforce LRU size limit to prevent unbounded memory growth
  if (configCache.has(key)) {
    configCache.delete(key);
  } else if (configCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = configCache.keys().next().value;
    configCache.delete(oldestKey);
  }

  configCache.set(key, { config: resolvedConfig, cachedAt: now });
  return resolvedConfig;
}

router.post('/', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "key" field in request body.' });
    }

    // 1. Look up per-client configuration (in-memory cache or Redis)
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
    console.error('[Rate Limiter Error]', error.message);

    // Fail-Open vs Fail-Closed Strategy
    if (config.failOpen) {
      // Prioritize availability: allow request with fallback header
      res.setHeader('X-RateLimit-Fallback', 'true');
      return res.status(200).json({
        allowed: true,
        warning: 'Rate limiter operating in fail-open fallback mode due to backend unavailability.',
      });
    }

    // Default: Fail-Closed (503 Service Unavailable) to protect downstream services
    return res.status(503).json({
      error: 'Rate limiter backend unavailable',
      allowed: false,
    });
  }
});

module.exports = router;
module.exports.getClientConfig = getClientConfig;
module.exports.invalidateClientConfigCache = invalidateClientConfigCache;
