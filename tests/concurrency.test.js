const redis = require('../src/redis');
const { checkTokenBucket } = require('../src/limiters/tokenBucket');

// Mock ioredis with ioredis-mock for tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Concurrency Test: Token Bucket (Race Condition Safe)', () => {
  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.flushall();
  });

  it('enforces exact limit under high concurrency (burst = 10, rate = 0)', async () => {
    const key = 'test-concurrent-key';
    const burst = 10;
    const rate = 0; // No refill during test

    // Fire 100 parallel requests simultaneously for the same key
    const requests = Array.from({ length: 100 }, () =>
      checkTokenBucket(key, { burst, rate })
    );

    const results = await Promise.all(requests);
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    // With atomic Lua execution, exactly 10 requests are allowed and 90 are denied
    expect(allowedCount).toBe(10);
    expect(deniedCount).toBe(90);
  });
});
