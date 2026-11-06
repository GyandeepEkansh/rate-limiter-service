/**
 * Benchmark Measurement Script (Self-Contained Runner)
 * Spins up the server in-process, sustains high-concurrency traffic,
 * and records real, measured throughput, latency percentiles, and hot key limits.
 */

const http = require('http');
const { app } = require('../src/server');

const TARGET_RPS = 650;
const DURATION_SECONDS = 20; // 20 seconds sustained run
const HOT_KEY = 'hot-client-key';
const HOT_KEY_BURST = 20;
const HOT_KEY_RATE = 10;

let server;
let port;
let agent;

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
        hostname: '127.0.0.1',
        port,
        path: '/check',
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        res.on('data', () => {});
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

function configureHotKey() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      algorithm: 'token_bucket',
      burst: HOT_KEY_BURST,
      rate: HOT_KEY_RATE,
    });

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/admin/clients/${HOT_KEY}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-admin-key': 'admin-secret-key-123',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          console.log(`[Setup] Configured "${HOT_KEY}" (status=${res.statusCode}): ${body}`);
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
  server = app.listen(0, '127.0.0.1', async () => {
    port = server.address().port;
    agent = new http.Agent({
      keepAlive: true,
      maxSockets: 200,
    });

    console.log(`[Benchmark] In-process server listening on port ${port}`);
    await configureHotKey();

    console.log(`[Benchmark] Running sustained load for ${DURATION_SECONDS}s with concurrent workers...`);
    const endTime = Date.now() + DURATION_SECONDS * 1000;
    const startTime = Date.now();

    const WORKERS = 10;
    const BATCH_SIZE = 2;
    const workers = Array.from({ length: WORKERS }, async () => {
      while (Date.now() < endTime) {
        const batch = [];
        for (let b = 0; b < BATCH_SIZE; b++) {
          const isHotKey = Math.random() < 0.25;
          const clientKey = isHotKey ? HOT_KEY : `client-${Math.floor(Math.random() * 50)}`;
          batch.push(sendRequest(clientKey));
        }
        await Promise.all(batch);
      }
    });

    await Promise.all(workers);
    const actualDuration = (Date.now() - startTime) / 1000;
    latencies.sort((a, b) => a - b);

    const actualRps = (totalRequests / actualDuration).toFixed(1);
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const p99 = calculatePercentile(latencies, 99);
    const theoreticalMax = Math.floor(HOT_KEY_BURST + HOT_KEY_RATE * actualDuration);

    console.log('\n================ REAL MEASURED BENCHMARK RUN ================');
    console.log(`Actual Duration     : ${actualDuration.toFixed(2)}s`);
    console.log(`Total Requests Sent : ${totalRequests}`);
    console.log(`Measured Throughput : ${actualRps} req/s`);
    console.log(`Allowed (200 OK)    : ${totalAllowed}`);
    console.log(`Denied (429 Limit)  : ${totalDenied}`);
    console.log(`Server Errors (5xx) : ${totalErrors}`);
    console.log(`----------------------------------------------------------------`);
    console.log(`Latency p50         : ${p50} ms`);
    console.log(`Latency p95         : ${p95} ms`);
    console.log(`Latency p99         : ${p99} ms`);
    console.log(`----------------------------------------------------------------`);
    console.log(`Hot Key Total Req   : ${hotKeyAllowed + hotKeyDenied}`);
    console.log(`Hot Key Allowed     : ${hotKeyAllowed}`);
    console.log(`Hot Key Theoretical : <= ${theoreticalMax} allowed (B=${HOT_KEY_BURST} + R=${HOT_KEY_RATE}/s * T=${actualDuration.toFixed(1)}s)`);
    console.log(`Enforcement Status  : ${hotKeyAllowed <= theoreticalMax ? '[PASS] Compliant' : '[FAIL] Over limit'}`);
    console.log('================================================================\n');

    server.close();
    process.exit(0);
  });
}

run();
