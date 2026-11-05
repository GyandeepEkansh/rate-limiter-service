const request = require('supertest');
const { app } = require('../src/server');

// Mock ioredis with ioredis-mock for unit tests
jest.mock('ioredis', () => require('ioredis-mock'));

describe('Basic Server & Health Endpoint (Step 2)', () => {
  it('GET / should return service information', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Rate Limiter Service');
    expect(res.body.endpoints).toHaveProperty('health');
    expect(res.body.endpoints).toHaveProperty('check');
  });

  it('GET /health should return 200 and OK status when Redis is available', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.redis).toBe('PONG');
  });
});

describe('Token Bucket Naive Endpoint (Step 3)', () => {
  it('POST /check should return 400 when key is missing', async () => {
    const res = await request(app).post('/check').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid "key"/);
  });

  it('POST /check should allow request for new client with remaining tokens', async () => {
    const res = await request(app).post('/check').send({ key: 'client-test-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.limit).toBe(20);
    expect(res.body.remaining).toBe(19);
    expect(res.headers).toHaveProperty('x-ratelimit-limit');
    expect(res.headers).toHaveProperty('x-ratelimit-remaining');
    expect(res.headers).toHaveProperty('x-ratelimit-reset');
  });
});
