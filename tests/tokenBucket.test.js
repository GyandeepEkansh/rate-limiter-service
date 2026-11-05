const redis = require('../src/redis');
const { checkTokenBucket } = require('../src/limiters/tokenBucket');

// Mock ioredis with ioredis-mock for tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Token Bucket Unit Tests', () => {
  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.flushall();
  });

  it('initializes bucket to burst and consumes 1 token', async () => {
    const res = await checkTokenBucket('client-tb-1', { burst: 10, rate: 2 });
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(10);
    expect(res.remaining).toBe(9);
    expect(res.retry_after).toBe(0);
  });

  it('denies requests when bucket is depleted and calculates retry_after', async () => {
    const key = 'client-tb-deplete';
    const burst = 2;
    const rate = 1; // 1 token per second

    // Consume all 2 tokens
    const res1 = await checkTokenBucket(key, { burst, rate });
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(1);

    const res2 = await checkTokenBucket(key, { burst, rate });
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    // 3rd request should be denied
    const res3 = await checkTokenBucket(key, { burst, rate });
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
    expect(res3.retry_after).toBeGreaterThan(0);
    expect(res3.retry_after).toBeLessThanOrEqual(1.0);
  });

  it('sets TTL on the bucket key in Redis for automatic cleanup', async () => {
    const key = 'client-tb-ttl';
    await checkTokenBucket(key, { burst: 10, rate: 5 });

    const ttl = await redis.ttl(`bucket:${key}`);
    expect(ttl).toBeGreaterThan(0);
  });
});
