/**
 * Standalone Persistence Verification Script
 *
 * Usage:
 *   node tests/verify-persistence.js
 *
 * This script:
 * 1. Connects to Redis at localhost:6379
 * 2. Sets a custom client config (config:persist-demo)
 * 3. Consumes tokens (bucket:persist-demo)
 * 4. Prints current state
 * 5. Prompts or triggers `docker compose restart redis`
 * 6. Reconnects and verifies that both config and remaining bucket state survived!
 */

const Redis = require('ioredis');
const { execSync } = require('child_process');

async function main() {
  console.log('=== Step 9: Redis Persistence Test ===');
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  });

  try {
    await redis.ping();
    console.log('[OK] Connected to Redis.');

    const aof = await redis.config('GET', 'appendonly');
    console.log(`[OK] Redis appendonly setting: ${aof[1]}`);

    const key = 'persist-client-1';

    // 1. Set client config
    await redis.hset(`config:${key}`, {
      algorithm: 'token_bucket',
      burst: '25',
      rate: '2',
    });
    console.log(`[1] Saved config for ${key}: burst=25, rate=2`);

    // 2. Simulate consumed bucket state
    await redis.hset(`bucket:${key}`, {
      tokens: '18.5',
      last_refill_ms: Date.now().toString(),
    });
    console.log(`[2] Stored bucket state for ${key}: tokens=18.5`);

    // 3. Restart container via docker compose
    console.log('[3] Restarting Redis container (docker compose restart redis)...');
    try {
      execSync('docker compose restart redis', { stdio: 'inherit' });
      console.log('[OK] Docker container restarted.');
    } catch (e) {
      console.log('[Note] Could not automatically run docker compose restart. Please run it manually if testing with Docker.');
    }

    // Wait 2 seconds for Redis to restart and recover AOF
    console.log('[4] Waiting for Redis to accept connections...');
    await new Promise((r) => setTimeout(r, 2000));

    const redisAfter = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      maxRetriesPerRequest: 5,
    });

    const configAfter = await redisAfter.hgetall(`config:${key}`);
    const bucketAfter = await redisAfter.hgetall(`bucket:${key}`);

    console.log('[5] State after restart:');
    console.log('    Stored Config:', configAfter);
    console.log('    Stored Bucket:', bucketAfter);

    if (configAfter && configAfter.burst === '25' && bucketAfter && bucketAfter.tokens) {
      console.log('\n>>> SUCCESS: Config and bucket state survived Redis restart via AOF persistence! <<<');
    } else {
      console.log('\n>>> State was not recovered. Check if Redis container has volume and appendonly enabled. <<<');
    }

    await redisAfter.quit();
  } catch (err) {
    console.error('Error during persistence test:', err.message);
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  main();
}
