const request = require('supertest');
const { app } = require('../src/server');
const redis = require('../src/redis');
const { checkSlidingWindow } = require('../src/limiters/slidingWindow');

// Mock ioredis with ioredis-mock for tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Sliding Window Rate Limiter (Step 7)', () => {
  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.flushall();
  });

  it('allows requests up to limit and rejects subsequent requests', async () => {
    const key = 'test-sw-basic';
    const limit = 5;
    const windowSeconds = 10;

    for (let i = 0; i < limit; i++) {
      const res = await checkSlidingWindow(key, { limit, windowSeconds });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(limit - (i + 1));
      expect(res.limit).toBe(limit);
    }

    // 6th request must be rejected
    const denied = await checkSlidingWindow(key, { limit, windowSeconds });
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retry_after).toBeGreaterThan(0);
  });

  it('prevents 2x burst at window boundary (sliding window guarantee)', async () => {
    const key = 'test-sw-boundary';
    const limit = 4;
    const windowSeconds = 2; // 2-second sliding window

    // Fire 4 requests (consuming full allowance)
    for (let i = 0; i < limit; i++) {
      const res = await checkSlidingWindow(key, { limit, windowSeconds });
      expect(res.allowed).toBe(true);
    }

    // Immediate subsequent request is strictly denied (no burst past limit)
    const burstAttempt = await checkSlidingWindow(key, { limit, windowSeconds });
    expect(burstAttempt.allowed).toBe(false);

    // Verify rolling window log contents: exactly 4 items in sorted set
    const count = await redis.zcard(`window:${key}`);
    expect(count).toBe(limit);
  });

  it('enforces exact limit under high concurrency (100 parallel requests, limit = 10)', async () => {
    const key = 'test-sw-concurrency';
    const limit = 10;
    const windowSeconds = 60;

    const requests = Array.from({ length: 100 }, () =>
      checkSlidingWindow(key, { limit, windowSeconds })
    );

    const results = await Promise.all(requests);
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(10);
    expect(denied).toBe(90);
  });

  it('POST /check applies sliding_window algorithm when configured via admin', async () => {
    const key = 'sw-configured-client';

    // 1. Configure client via admin endpoint
    await request(app)
      .put(`/admin/clients/${key}`)
      .set('x-admin-key', 'admin-secret-key-123')
      .send({
        algorithm: 'sliding_window',
        limit: 2,
        window_seconds: 5,
      });

    // 2. First request allowed
    const res1 = await request(app).post('/check').send({ key });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.allowed).toBe(true);
    expect(res1.body.remaining).toBe(1);
    expect(res1.headers['x-ratelimit-limit']).toBe('2');

    // 3. Second request allowed
    const res2 = await request(app).post('/check').send({ key });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.remaining).toBe(0);

    // 4. Third request denied (429) with Retry-After header
    const res3 = await request(app).post('/check').send({ key });
    expect(res3.statusCode).toBe(429);
    expect(res3.body.allowed).toBe(false);
    expect(res3.headers).toHaveProperty('retry-after');
    expect(res3.headers['x-ratelimit-remaining']).toBe('0');
  });
});
