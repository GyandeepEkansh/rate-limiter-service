const redis = require('../src/redis');
const { checkTokenBucket, checkTokenBucketNaive } = require('../src/limiters/tokenBucket');

// Mock ioredis with ioredis-mock for tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Concurrency Test: Token Bucket', () => {
  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.flushall();
  });

  it('demonstrates race condition in naive implementation: allows > 10 requests', async () => {
    const key = 'test-naive-race';
    const burst = 10;
    const rate = 0; // No refill during test

    // Fire 100 parallel requests simultaneously
    const requests = Array.from({ length: 100 }, () =>
      checkTokenBucketNaive(key, { burst, rate })
    );

    const results = await Promise.all(requests);
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    console.log(`[Naive Concurrency] Allowed: ${allowedCount}, Denied: ${deniedCount} (Expected burst: ${burst})`);

    // In a race-prone implementation, multiple concurrent calls read tokens before writing back,
    // so allowedCount will be greater than burst (10).
    expect(allowedCount).toBeGreaterThan(burst);
  });

  it('enforces exact limit under high concurrency (burst = 10, rate = 0)', async () => {
    const key = 'test-concurrent-key';
    const burst = 10;
    const rate = 0; // No refill during test

    // Fire 100 parallel requests simultaneously
    const requests = Array.from({ length: 100 }, () =>
      checkTokenBucket(key, { burst, rate })
    );

    const results = await Promise.all(requests);
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    console.log(`[TokenBucket Concurrency] Allowed: ${allowedCount}, Denied: ${deniedCount}`);

    // Must be exactly 10 allowed, 90 denied!
    expect(allowedCount).toBe(10);
    expect(deniedCount).toBe(90);
  });
});
