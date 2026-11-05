const request = require('supertest');
const { app } = require('../src/server');
const redis = require('../src/redis');

// Mock ioredis with ioredis-mock for tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Admin Endpoints & Dynamic Client Config (Step 6)', () => {
  const adminKey = 'admin-secret-key-123';

  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.flushall();
  });

  it('rejects unauthenticated admin requests (missing or invalid x-admin-key)', async () => {
    // Missing header
    const resNoAuth = await request(app)
      .put('/admin/clients/client-a')
      .send({ algorithm: 'token_bucket', burst: 5, rate: 2 });
    expect(resNoAuth.statusCode).toBe(401);
    expect(resNoAuth.body.error).toMatch(/Unauthorized/);

    // Wrong header
    const resWrongAuth = await request(app)
      .put('/admin/clients/client-a')
      .set('x-admin-key', 'wrong-key')
      .send({ algorithm: 'token_bucket', burst: 5, rate: 2 });
    expect(resWrongAuth.statusCode).toBe(401);
  });

  it('validates config payload fields', async () => {
    // Invalid algorithm
    const res1 = await request(app)
      .put('/admin/clients/client-a')
      .set('x-admin-key', adminKey)
      .send({ algorithm: 'invalid_algo' });
    expect(res1.statusCode).toBe(400);
    expect(res1.body.error).toMatch(/Invalid "algorithm"/);

    // Negative burst
    const res2 = await request(app)
      .put('/admin/clients/client-a')
      .set('x-admin-key', adminKey)
      .send({ algorithm: 'token_bucket', burst: -5, rate: 2 });
    expect(res2.statusCode).toBe(400);
    expect(res2.body.error).toMatch(/"burst" must be a positive integer/);

    // Zero rate
    const res3 = await request(app)
      .put('/admin/clients/client-a')
      .set('x-admin-key', adminKey)
      .send({ algorithm: 'token_bucket', burst: 5, rate: 0 });
    expect(res3.statusCode).toBe(400);
    expect(res3.body.error).toMatch(/"rate" must be a positive number/);
  });

  it('successfully creates, retrieves, and updates custom client config', async () => {
    const key = 'custom-vip-client';

    // 1. PUT custom config with small rate to avoid test timing refill race
    const putRes = await request(app)
      .put(`/admin/clients/${key}`)
      .set('x-admin-key', adminKey)
      .send({
        algorithm: 'token_bucket',
        burst: 3,
        rate: 0.1,
      });

    expect(putRes.statusCode).toBe(200);
    expect(putRes.body.status).toBe('success');
    expect(putRes.body.config).toEqual({
      algorithm: 'token_bucket',
      burst: 3,
      rate: 0.1,
    });

    // 2. GET stored config
    const getRes = await request(app)
      .get(`/admin/clients/${key}`)
      .set('x-admin-key', adminKey);

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.key).toBe(key);
    expect(getRes.body.config.burst).toBe(3);
    expect(getRes.body.config.rate).toBe(0.1);

    // 3. POST /check enforces the custom burst (3 requests allowed, 4th denied)
    const req1 = await request(app).post('/check').send({ key });
    expect(req1.statusCode).toBe(200);
    expect(req1.body.allowed).toBe(true);

    const req2 = await request(app).post('/check').send({ key });
    expect(req2.statusCode).toBe(200);
    expect(req2.body.allowed).toBe(true);

    const req3 = await request(app).post('/check').send({ key });
    expect(req3.statusCode).toBe(200);
    expect(req3.body.allowed).toBe(true);

    const req4 = await request(app).post('/check').send({ key });
    expect(req4.statusCode).toBe(429);
    expect(req4.body.allowed).toBe(false);
    expect(req4.headers).toHaveProperty('retry-after');

    // 4. DELETE custom config
    const delRes = await request(app)
      .delete(`/admin/clients/${key}`)
      .set('x-admin-key', adminKey);
    expect(delRes.statusCode).toBe(200);

    // 5. GET after delete returns 404
    const getDeleted = await request(app)
      .get(`/admin/clients/${key}`)
      .set('x-admin-key', adminKey);
    expect(getDeleted.statusCode).toBe(404);
  });
});
