const express = require('express');
const router = express.Router();
const redis = require('../redis');
const { requireAdminAuth, validateClientConfig } = require('../middleware/validate');
const { invalidateClientConfigCache } = require('./check');

// Protect all admin routes with requireAdminAuth
router.use(requireAdminAuth);

/**
 * PUT /admin/clients/:key
 * Stores custom rate limit configuration for a specific client key.
 * Completely replaces old configuration to prevent stale fields when switching algorithms.
 */
router.put('/clients/:key', validateClientConfig, async (req, res) => {
  try {
    const { key } = req.params;
    const { algorithm, rate, burst, limit, window_seconds } = req.body;

    const configKey = `config:${key}`;
    const hashData = { algorithm };

    if (rate !== undefined) hashData.rate = rate.toString();
    if (burst !== undefined) hashData.burst = burst.toString();
    if (limit !== undefined) hashData.limit = limit.toString();
    if (window_seconds !== undefined) hashData.window_seconds = window_seconds.toString();

    // Clean overwrite: delete previous hash first so fields from prior algorithm do not linger
    await redis.del(configKey);
    await redis.hset(configKey, hashData);

    // Invalidate in-memory cache
    invalidateClientConfigCache(key);

    return res.status(200).json({
      status: 'success',
      key,
      config: {
        algorithm,
        ...(rate !== undefined && { rate }),
        ...(burst !== undefined && { burst }),
        ...(limit !== undefined && { limit }),
        ...(window_seconds !== undefined && { window_seconds }),
      },
    });
  } catch (error) {
    console.error('Error in PUT /admin/clients/:key:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /admin/clients/:key
 * Retrieves stored client configuration.
 */
router.get('/clients/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const configKey = `config:${key}`;
    const data = await redis.hgetall(configKey);

    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: `No custom configuration found for client "${key}"` });
    }

    const clientConfig = {
      algorithm: data.algorithm,
      ...(data.rate !== undefined && { rate: parseFloat(data.rate) }),
      ...(data.burst !== undefined && { burst: parseInt(data.burst, 10) }),
      ...(data.limit !== undefined && { limit: parseInt(data.limit, 10) }),
      ...(data.window_seconds !== undefined && { window_seconds: parseFloat(data.window_seconds) }),
    };

    return res.status(200).json({
      key,
      config: clientConfig,
    });
  } catch (error) {
    console.error('Error in GET /admin/clients/:key:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /admin/clients/:key
 * Deletes stored client configuration and purges active bucket/window state.
 */
router.delete('/clients/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const configKey = `config:${key}`;

    const deleted = await redis.del(configKey);
    if (!deleted) {
      return res.status(404).json({ error: `No custom configuration found for client "${key}"` });
    }

    // Invalidate in-memory cache
    invalidateClientConfigCache(key);

    // Also clean up any active state keys
    await redis.del(`bucket:${key}`, `window:${key}`);

    return res.status(200).json({
      status: 'success',
      message: `Configuration for client "${key}" deleted successfully`,
    });
  } catch (error) {
    console.error('Error in DELETE /admin/clients/:key:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
