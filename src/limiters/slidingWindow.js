const crypto = require('crypto');
const redis = require('../redis');

/**
 * Sliding Window Rate Limiter (Sorted Set Log)
 * All state inspection, cleanup of old entries, insertion, and TTL
 * happen atomically in Redis via Lua script.
 *
 * @param {string} key - Unique client identifier
 * @param {object} options - { limit, windowSeconds }
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, reset_after: number, retry_after: number, reset_epoch: number}>}
 */
async function checkSlidingWindow(key, { limit, windowSeconds }, client = redis) {
  const windowKey = `window:${key}`;
  const windowMs = Math.round(windowSeconds * 1000);
  const uniqueId = `${Date.now()}-${crypto.randomUUID()}`;

  const result = await client.slidingWindowEval(windowKey, limit, windowMs, uniqueId);

  const [allowedRaw, limitRaw, remainingRaw, resetAfterRaw, retryAfterRaw, resetEpochRaw] = result;

  return {
    allowed: Boolean(Number(allowedRaw)),
    limit: Number(limitRaw),
    remaining: Number(remainingRaw),
    reset_after: parseFloat(parseFloat(resetAfterRaw).toFixed(3)),
    retry_after: parseFloat(parseFloat(retryAfterRaw).toFixed(3)),
    reset_epoch: resetEpochRaw ? parseInt(resetEpochRaw, 10) : undefined,
  };
}

module.exports = {
  checkSlidingWindow,
};
