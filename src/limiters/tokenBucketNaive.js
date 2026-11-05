const redis = require('../redis');

/**
 * Naive Token Bucket Limiter (Race-Prone)
 * Uses separate read and write operations from Node.js.
 * Under concurrent requests for the same key, this will suffer
 * from lost updates and allow more requests than the configured burst.
 *
 * @param {string} key - Unique client key
 * @param {object} options - { burst, rate }
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, reset_after: number, retry_after: number}>}
 */
async function checkTokenBucketNaive(key, { burst, rate }) {
  const bucketKey = `bucket:${key}`;

  // 1. Get current time from Redis TIME (seconds, microseconds)
  const [secStr, microStr] = await redis.time();
  const now = Math.floor(parseInt(secStr, 10) * 1000 + parseInt(microStr, 10) / 1000);

  // 2. Read state from Redis (Race condition happens right here!)
  const state = await redis.hgetall(bucketKey);

  let tokens;
  let lastRefillMs;

  if (!state || Object.keys(state).length === 0 || !state.tokens) {
    tokens = burst;
    lastRefillMs = now;
  } else {
    tokens = parseFloat(state.tokens);
    lastRefillMs = parseInt(state.last_refill_ms, 10);
  }

  // 3. Compute elapsed time and refill tokens
  const elapsed = Math.max(0, (now - lastRefillMs) / 1000);
  tokens = Math.min(burst, tokens + elapsed * rate);

  let allowed = false;
  let retryAfter = 0;

  // 4. Check if token can be consumed
  if (tokens >= 1) {
    tokens -= 1;
    allowed = true;
  } else {
    allowed = false;
    retryAfter = rate > 0 ? (1 - tokens) / rate : 60;
  }

  const remaining = Math.max(0, Math.floor(tokens));
  const resetAfter = rate > 0 ? Math.max(0, (burst - tokens) / rate) : 0;

  // 5. Write state back to Redis (Separate async operation)
  await redis.hmset(bucketKey, {
    tokens: tokens.toString(),
    last_refill_ms: now.toString(),
  });

  // 6. Set key TTL so idle keys are automatically cleaned up
  const ttl = rate > 0 ? Math.max(60, Math.ceil((burst / rate) * 2)) : 60;
  await redis.expire(bucketKey, ttl);

  return {
    allowed,
    limit: burst,
    remaining,
    reset_after: parseFloat(resetAfter.toFixed(3)),
    retry_after: parseFloat(retryAfter.toFixed(3)),
  };
}

module.exports = { checkTokenBucketNaive };
