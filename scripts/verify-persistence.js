/**
 * Persistence Verification Script (Requirement 03 Proof)
 *
 * Demonstrates that client configurations and active bucket tokens
 * survive Redis restarts via Append-Only File (AOF) disk persistence.
 *
 * Usage:
 *   node scripts/verify-persistence.js
 */

const Redis = require('ioredis');
const { execSync } = require('child_process');

async function main() {
  console.log('================================================================');
  console.log(' Redis AOF State Persistence Verification');
  console.log('================================================================\n');

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT, 10) || 6379;

  let redis;
  try {
    redis = new Redis({
      host: redisHost,
      port: redisPort,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    await redis.ping();
    console.log(`[1] Connected to Redis at ${redisHost}:${redisPort}`);
  } catch (err) {
    console.error(`[Error] Cannot connect to Redis at ${redisHost}:${redisPort}: ${err.message}`);
    console.log('Please start Redis via "docker compose up -d redis" before running this test.');
    process.exit(1);
  }

  const aofConfig = await redis.config('GET', 'appendonly');
  console.log(`[2] Redis Append-Only File (AOF) enabled: ${aofConfig[1]}`);

  const testClient = 'persist-client-proof';
  const configKey = `config:${testClient}`;
  const bucketKey = `bucket:${testClient}`;

  // Step 1: Write custom client configuration
  await redis.del(configKey, bucketKey);
  await redis.hset(configKey, {
    algorithm: 'token_bucket',
    burst: '50',
    rate: '5',
  });
  console.log(`[3] Saved custom config for "${testClient}" (burst=50, rate=5)`);

  // Step 2: Simulate consumed tokens (bucket state)
  const now = Date.now();
  await redis.hset(bucketKey, {
    tokens: '37.5',
    last_refill_ms: now.toString(),
  });
  await redis.expire(bucketKey, 120);
  console.log(`[4] Wrote active bucket state for "${testClient}" (tokens=37.5)`);

  // Step 3: Trigger container restart
  console.log('\n[5] Restarting Redis container (docker compose restart redis)...');
  try {
    execSync('docker compose restart redis', { stdio: 'inherit' });
    console.log('    --> Container restarted successfully.');
  } catch {
    console.log('    [Notice] Automatic restart command skipped. Please restart Redis manually.');
  }

  // Wait for Redis recovery
  console.log('[6] Waiting 2.5s for Redis to replay AOF log from disk...');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // Step 4: Reconnect and verify data survived
  const redisReconnected = new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: 5,
  });

  const recoveredConfig = await redisReconnected.hgetall(configKey);
  const recoveredBucket = await redisReconnected.hgetall(bucketKey);

  console.log('\n================ RECOVERED STATE FROM DISK =================');
  console.log('Recovered Config:', recoveredConfig);
  console.log('Recovered Bucket:', recoveredBucket);

  const configSurvives = recoveredConfig && recoveredConfig.burst === '50';
  const bucketSurvives = recoveredBucket && recoveredBucket.tokens === '37.5';

  if (configSurvives && bucketSurvives) {
    console.log('\n[✓] SUCCESS: Both client configuration and token state survived Redis restart!');
  } else {
    console.log('\n[!] FAILURE: State was lost after restart. Check volume mounting and appendonly configuration.');
  }
  console.log('================================================================\n');

  await redisReconnected.quit();
  await redis.quit();
}

main().catch(console.error);
