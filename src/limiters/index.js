const { checkTokenBucket, checkTokenBucketNaive } = require('./tokenBucket');
const { checkSlidingWindow } = require('./slidingWindow');

/**
 * Factory that selects and executes the appropriate rate limiter algorithm.
 *
 * @param {string} key - Unique client identifier
 * @param {object} config - Configuration object
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, reset_after: number, retry_after: number}>}
 */
async function checkRateLimit(key, config) {
  const algorithm = config.algorithm || 'token_bucket';

  switch (algorithm) {
    case 'token_bucket':
      return checkTokenBucket(key, {
        burst: config.burst,
        rate: config.rate,
      });

    case 'sliding_window':
      return checkSlidingWindow(key, {
        limit: config.limit,
        windowSeconds: config.windowSeconds,
      });

    default:
      throw new Error(`Unsupported rate limiting algorithm: "${algorithm}"`);
  }
}

module.exports = {
  checkRateLimit,
  checkTokenBucket,
  checkTokenBucketNaive,
  checkSlidingWindow,
};
