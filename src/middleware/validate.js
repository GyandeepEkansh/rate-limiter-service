const config = require('../config');

/**
 * Middleware to verify admin API key
 */
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== config.adminApiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-admin-key header' });
  }
  next();
}

/**
 * Middleware to validate PUT /admin/clients/:key body
 */
function validateClientConfig(req, res, next) {
  const { algorithm, rate, burst, limit, window_seconds } = req.body;

  const validAlgorithms = ['token_bucket', 'sliding_window'];
  if (!algorithm || !validAlgorithms.includes(algorithm)) {
    return res.status(400).json({
      error: `Invalid "algorithm". Must be one of: ${validAlgorithms.join(', ')}`,
    });
  }

  if (algorithm === 'token_bucket') {
    if (rate !== undefined && (typeof rate !== 'number' || rate <= 0)) {
      return res.status(400).json({ error: '"rate" must be a positive number' });
    }
    if (burst !== undefined && (!Number.isInteger(burst) || burst <= 0)) {
      return res.status(400).json({ error: '"burst" must be a positive integer' });
    }
    if (rate === undefined && burst === undefined) {
      return res.status(400).json({
        error: 'For token_bucket algorithm, "rate" or "burst" must be specified',
      });
    }
  }

  if (algorithm === 'sliding_window') {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return res.status(400).json({ error: '"limit" must be a positive integer' });
    }
    if (window_seconds !== undefined && (typeof window_seconds !== 'number' || window_seconds <= 0)) {
      return res.status(400).json({ error: '"window_seconds" must be a positive number' });
    }
    if (limit === undefined && window_seconds === undefined) {
      return res.status(400).json({
        error: 'For sliding_window algorithm, "limit" or "window_seconds" must be specified',
      });
    }
  }

  next();
}

module.exports = {
  requireAdminAuth,
  validateClientConfig,
};
