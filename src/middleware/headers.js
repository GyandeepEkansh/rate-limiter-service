/**
 * Standard Rate Limiter Headers Middleware / Helper
 *
 * Sets:
 * - X-RateLimit-Limit: Maximum allowed requests / bucket burst
 * - X-RateLimit-Remaining: Number of tokens or requests remaining
 * - X-RateLimit-Reset: Unix epoch timestamp (seconds) when the limit resets
 * - Retry-After: Seconds to wait before retrying (set on 429 denials)
 *
 * @param {import('express').Response} res
 * @param {object} result - { allowed, limit, remaining, reset_after, retry_after }
 */
function setRateLimitHeaders(res, result) {
  if (!result) return;

  const { limit, remaining, reset_after, retry_after, allowed } = result;

  if (limit !== undefined) {
    res.setHeader('X-RateLimit-Limit', limit);
  }

  if (remaining !== undefined) {
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  }

  const resetSeconds = reset_after !== undefined ? reset_after : 0;
  const resetEpoch = Math.ceil(Date.now() / 1000 + resetSeconds);
  res.setHeader('X-RateLimit-Reset', resetEpoch);

  if (!allowed && retry_after !== undefined) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil(retry_after)));
  }
}

module.exports = {
  setRateLimitHeaders,
};
