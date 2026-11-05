import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const hotKeyAllowedCounter = new Counter('hot_key_allowed');
const hotKeyDeniedCounter = new Counter('hot_key_denied');
const totalAllowedCounter = new Counter('total_allowed');
const totalDeniedCounter = new Counter('total_denied');
const serverErrorRate = new Rate('server_errors');
const checkLatency = new Trend('check_latency');

export const options = {
  scenarios: {
    high_throughput_check: {
      executor: 'constant-arrival-rate',
      rate: 600, // 600 req/s target (> 500 req/s)
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    // Latency thresholds
    'http_req_duration': ['p(50)<20', 'p(95)<50', 'p(99)<100'],
    // 5xx internal server errors should be 0%
    'server_errors': ['rate<0.001'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const HOT_KEY = 'hot-client-key';
const DURATION_SECONDS = 30;

// Hot key rate limiter specs: burst = 20, rate = 10 tokens/s
const HOT_KEY_BURST = 20;
const HOT_KEY_RATE = 10;
const MAX_ALLOWED_THEORETICAL = HOT_KEY_BURST + HOT_KEY_RATE * DURATION_SECONDS; // 20 + 300 = 320

export function setup() {
  console.log(`Setting up load test against ${BASE_URL}...`);

  // Configure the hot key with known parameters via Admin API
  const adminUrl = `${BASE_URL}/admin/clients/${HOT_KEY}`;
  const payload = JSON.stringify({
    algorithm: 'token_bucket',
    burst: HOT_KEY_BURST,
    rate: HOT_KEY_RATE,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': __ENV.ADMIN_API_KEY || 'admin-secret-key-123',
    },
  };

  const res = http.put(adminUrl, payload, params);
  if (res.status !== 200) {
    console.warn(`Warning: Admin configuration setup returned status ${res.status}`);
  } else {
    console.log(`Configured ${HOT_KEY} with burst=${HOT_KEY_BURST}, rate=${HOT_KEY_RATE}/s`);
  }

  return { startTime: Date.now() };
}

export default function () {
  // 25% traffic directed to the hot key, 75% traffic across 50 normal client keys
  const isHotKey = Math.random() < 0.25;
  const clientKey = isHotKey ? HOT_KEY : `client-${Math.floor(Math.random() * 50)}`;

  const url = `${BASE_URL}/check`;
  const payload = JSON.stringify({ key: clientKey });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    // Don't fail the request on 429 status code
    throwHttpErrors: false,
  };

  const res = http.post(url, payload, params);
  checkLatency.add(res.timings.duration);

  // Check for server-side errors (5xx)
  const is5xx = res.status >= 500;
  serverErrorRate.add(is5xx);

  // Validate response headers and body
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has limit header': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
    'has remaining header': (r) => r.headers['X-Ratelimit-Remaining'] !== undefined,
    'has reset header': (r) => r.headers['X-Ratelimit-Reset'] !== undefined,
    'has retry-after on 429': (r) => (r.status === 429 ? r.headers['Retry-After'] !== undefined : true),
  });

  if (res.status === 200) {
    totalAllowedCounter.add(1);
    if (isHotKey) {
      hotKeyAllowedCounter.add(1);
    }
  } else if (res.status === 429) {
    totalDeniedCounter.add(1);
    if (isHotKey) {
      hotKeyDeniedCounter.add(1);
    }
  }
}

export function teardown(data) {
  console.log('\n================ LOAD TEST RESULTS ================');
  console.log(`Hot Key Theoretical Max Allowed: ${MAX_ALLOWED_THEORETICAL} (Burst ${HOT_KEY_BURST} + ${HOT_KEY_RATE}/s * ${DURATION_SECONDS}s)`);
  console.log('Verify hot_key_allowed metric is <= ' + MAX_ALLOWED_THEORETICAL + ' to prove correctness.');
  console.log('===================================================\n');
}
