/**
 * Native Node.js High-Throughput Load Test Runner
 * Can be run standalone without external dependencies:
 *   node load-test/runner.js
 */

const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const parsedUrl = new URL(BASE_URL);
const TARGET_RPS = parseInt(process.env.TARGET_RPS, 10) || 600;
const DURATION_SECONDS = parseInt(process.env.DURATION_SECONDS, 10) || 10;
const HOT_KEY = 'hot-client-key';
const HOT_KEY_BURST = 20;
const HOT_KEY_RATE = 10;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
});

let totalRequests = 0;
let totalAllowed = 0;
let totalDenied = 0;
let totalErrors = 0;
let hotKeyAllowed = 0;
let hotKeyDenied = 0;
const latencies = [];

function sendRequest(clientKey) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ key: clientKey });
    const startTime = process.hrtime.bigint();

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: '/check',
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
          latencies.push(durationMs);
          totalRequests++;

          if (res.statusCode === 200) {
            totalAllowed++;
            if (clientKey === HOT_KEY) hotKeyAllowed++;
          } else if (res.statusCode === 429) {
            totalDenied++;
            if (clientKey === HOT_KEY) hotKeyDenied++;
          } else {
            totalErrors++;
          }
          resolve();
        });
      }
    );

    req.on('error', (err) => {
      totalErrors++;
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)].toFixed(2);
}

async function setupHotKey() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      algorithm: 'token_bucket',
      burst: HOT_KEY_BURST,
      rate: HOT_KEY_RATE,
    });

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `/admin/clients/${HOT_KEY}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-admin-key': process.env.ADMIN_API_KEY || 'admin-secret-key-123',
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log(`[Setup] Configured hot key "${HOT_KEY}" (burst=${HOT_KEY_BURST}, rate=${HOT_KEY_RATE}/s)`);
          resolve();
        });
      }
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log(`=======================================================`);
  console.log(` Starting Load Test: ${TARGET_RPS} RPS target for ${DURATION_SECONDS}s`);
  console.log(` Endpoint: ${BASE_URL}/check`);
  console.log(`=======================================================`);

  try {
    await setupHotKey();
  } catch (err) {
    console.warn(`[Warning] Could not setup hot key via admin: ${err.message}`);
  }

  const intervalMs = 1000 / TARGET_RPS;
  const endTime = Date.now() + DURATION_SECONDS * 1000;
  const inFlight = [];

  const startStamp = Date.now();

  while (Date.now() < endTime) {
    const isHotKey = Math.random() < 0.25;
    const clientKey = isHotKey ? HOT_KEY : `client-${Math.floor(Math.random() * 50)}`;

    inFlight.push(sendRequest(clientKey));

    // Keep accurate pacing
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  await Promise.all(inFlight);
  const actualDuration = (Date.now() - startStamp) / 1000;
  latencies.sort((a, b) => a - b);

  const actualRps = (totalRequests / actualDuration).toFixed(1);
  const p50 = calculatePercentile(latencies, 50);
  const p95 = calculatePercentile(latencies, 95);
  const p99 = calculatePercentile(latencies, 99);

  const theoreticalMax = Math.ceil(HOT_KEY_BURST + HOT_KEY_RATE * actualDuration);

  console.log(`\n================== LOAD TEST BENCHMARK RESULTS ==================`);
  console.log(`Total Requests Sent : ${totalRequests}`);
  console.log(`Actual Duration     : ${actualDuration.toFixed(2)}s`);
  console.log(`Throughput          : ${actualRps} req/s`);
  console.log(`Total Allowed (200) : ${totalAllowed}`);
  console.log(`Total Denied (429)  : ${totalDenied}`);
  console.log(`Server Errors (5xx) : ${totalErrors}`);
  console.log(`-----------------------------------------------------------------`);
  console.log(`Latency p50         : ${p50} ms`);
  console.log(`Latency p95         : ${p95} ms`);
  console.log(`Latency p99         : ${p99} ms`);
  console.log(`-----------------------------------------------------------------`);
  console.log(`Hot Key Total Req   : ${hotKeyAllowed + hotKeyDenied}`);
  console.log(`Hot Key Allowed     : ${hotKeyAllowed}`);
  console.log(`Hot Key Theoretical : <= ${theoreticalMax} allowed (B=${HOT_KEY_BURST} + R=${HOT_KEY_RATE} * T=${actualDuration.toFixed(1)}s)`);

  if (hotKeyAllowed <= theoreticalMax) {
    console.log(`CORRECTNESS CHECK   : [PASS] Rate limiter accurately enforced token bucket constraints!`);
  } else {
    console.log(`CORRECTNESS CHECK   : [FAIL] Rate limiter allowed ${hotKeyAllowed} > ${theoreticalMax}`);
  }
  console.log(`=================================================================\n`);
}

run();
