/**
 * Demo Script: Naive Token Bucket (Race Condition) vs Atomic Lua Fix
 *
 * Demonstrates the classic TOCTOU (Time-of-Check to Time-of-Use) race condition
 * when performing read-then-write from application code, versus atomic Lua execution.
 *
 * Usage:
 *   node scripts/demo-naive-race.js
 */

const fs = require('fs');
const path = require('path');
const MockRedis = require('ioredis-mock');

// Use ioredis-mock by default for clean standalone execution
const redis = new MockRedis();

// Register atomic Lua script
const luaPath = path.join(__dirname, '..', 'src', 'lua', 'tokenBucket.lua');
const luaScript = fs.readFileSync(luaPath, 'utf8');
redis.defineCommand('tokenBucketEval', {
  numberOfKeys: 1,
  lua: luaScript,
});

/**
 * 1. Naive Token Bucket (Read-Then-Write in plain JS)
 * Slices read and write into separate network round-trips.
 */
async function naiveTokenBucketCheck(key, burst, rate) {
  const bucketKey = `naive-bucket:${key}`;
  const now = Date.now();

  // Step 1: Read state (RACE WINDOW OPENS HERE)
  const state = await redis.hgetall(bucketKey);
  let tokens = burst;
  let lastRefill = now;

  if (state && state.tokens) {
    tokens = parseFloat(state.tokens);
    lastRefill = parseInt(state.last_refill, 10);
  }

  // Step 2: Compute refill
  const elapsed = Math.max(0, (now - lastRefill) / 1000);
  tokens = Math.min(burst, tokens + elapsed * rate);

  let allowed = false;
  if (tokens >= 1) {
    tokens -= 1;
    allowed = true;
  }

  // Step 3: Write state back (Overwrites concurrent updates!)
  await redis.hset(bucketKey, {
    tokens: tokens.toString(),
    last_refill: now.toString(),
  });

  return allowed;
}

/**
 * 2. Atomic Lua Token Bucket
 */
async function atomicTokenBucketCheck(key, burst, rate) {
  const bucketKey = `atomic-bucket:${key}`;
  const result = await redis.tokenBucketEval(bucketKey, burst, rate);
  return Boolean(Number(result[0]));
}

async function runDemo() {
  console.log('================================================================');
  console.log(' Race Condition Demonstration: Naive vs Atomic Token Bucket');
  console.log(' Target Configuration: burst = 10, rate = 0, requests = 100');
  console.log('================================================================\n');

  // 1. Run Naive Concurrency Test
  console.log('[Test 1] Firing 100 parallel requests against NAIVE implementation...');
  const naiveRequests = Array.from({ length: 100 }, () =>
    naiveTokenBucketCheck('test-client-naive', 10, 0)
  );
  const naiveResults = await Promise.all(naiveRequests);
  const naiveAllowed = naiveResults.filter(Boolean).length;
  const naiveDenied = naiveResults.length - naiveAllowed;

  console.log(`  --> Naive Allowed : ${naiveAllowed} (Expected: 10)`);
  console.log(`  --> Naive Denied  : ${naiveDenied}  (Expected: 90)`);
  if (naiveAllowed > 10) {
    console.log(`  [!] RACE CONDITION CONFIRMED: Allowed ${naiveAllowed - 10} extra requests due to read-then-write lag!\n`);
  }

  // 2. Run Atomic Lua Concurrency Test
  console.log('[Test 2] Firing 100 parallel requests against ATOMIC LUA implementation...');
  const atomicRequests = Array.from({ length: 100 }, () =>
    atomicTokenBucketCheck('test-client-atomic', 10, 0)
  );
  const atomicResults = await Promise.all(atomicRequests);
  const atomicAllowed = atomicResults.filter(Boolean).length;
  const atomicDenied = atomicResults.length - atomicAllowed;

  console.log(`  --> Atomic Allowed: ${atomicAllowed} (Expected: 10)`);
  console.log(`  --> Atomic Denied : ${atomicDenied} (Expected: 90)`);
  if (atomicAllowed === 10 && atomicDenied === 90) {
    console.log('  [✓] ATOMICITY CONFIRMED: Exactly 10 requests allowed, 90 denied.\n');
  }

  console.log('================================================================');
  process.exit(0);
}

runDemo();
