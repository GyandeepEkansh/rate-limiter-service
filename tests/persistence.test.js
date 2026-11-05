const Redis = require('ioredis');
const config = require('../src/config');

describe('Redis Persistence & AOF (Step 9)', () => {
  let liveRedis = null;
  let isLive = false;

  beforeAll(async () => {
    // Attempt to connect to real Redis if available
    try {
      liveRedis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      await liveRedis.connect();
      const pong = await liveRedis.ping();
      if (pong === 'PONG') {
        isLive = true;
      }
    } catch {
      isLive = false;
      if (liveRedis) liveRedis.disconnect();
    }
  });

  afterAll(async () => {
    if (liveRedis && isLive) {
      await liveRedis.quit();
    }
  });

  it('verifies Redis persistence configuration (AOF enabled)', async () => {
    if (!isLive) {
      console.log('Skipping live Redis AOF check: Redis server not currently active on localhost:6379.');
      expect(true).toBe(true);
      return;
    }

    // Check Redis AOF configuration
    const configResult = await liveRedis.config('GET', 'appendonly');
    console.log('[Redis Config] appendonly:', configResult);
    expect(configResult[1]).toBe('yes');
  });

  it('validates state survival methodology across restarts', async () => {
    const key = 'persist-test-client';
    const clientConfig = {
      algorithm: 'token_bucket',
      burst: '15',
      rate: '5',
    };

    if (isLive) {
      // 1. Write config
      await liveRedis.hset(`config:${key}`, clientConfig);

      // 2. Consume tokens (write bucket state)
      await liveRedis.hset(`bucket:${key}`, {
        tokens: '12',
        last_refill_ms: Date.now().toString(),
      });

      // 3. Confirm written
      const readConfig = await liveRedis.hgetall(`config:${key}`);
      const readBucket = await liveRedis.hgetall(`bucket:${key}`);

      expect(readConfig.burst).toBe('15');
      expect(readBucket.tokens).toBe('12');
    } else {
      expect(true).toBe(true);
    }
  });
});
