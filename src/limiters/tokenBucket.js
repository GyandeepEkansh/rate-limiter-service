const redis = require('../redis');

/**
 * Atomic Token Bucket Rate Limiter via Lua Script.
 * All state inspection, elapsed calculation, refill, consumption,
 * and key expiration happen atomically in Redis.
 *
 * @param {string} key - Unique client identifier
 * @param {object} options - { burst, rate }
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, reset_after: number, retry_after: number, reset_epoch: number}>}
 */
async function checkTokenBucket(key, { burst, rate }) {
  const bucketKey = `bucket:${key}`;

  // Call atomic Lua command defined on Redis client
  const result = await redis.tokenBucketEval(bucketKey, burst, rate);

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
  checkTokenBucket,
};
