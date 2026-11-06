# Load Testing & Performance Benchmark

This directory contains load testing configurations and benchmarks to measure rate limiter throughput, latency distributions, and verify rate limit mathematical correctness.

---

## 1. Automated k6 Load Test

The k6 scenario exercises sustained high-concurrency traffic targeting 500+ req/s with a 75/25 split between 50 random clients and 1 hot client.

### Run with local k6 binary:
```bash
k6 run load-test/check.js
```

### Run with k6 Docker image:
```bash
docker run --rm -i --network="host" grafana/k6 run - < load-test/check.js
```

---

## 2. In-Process Benchmark Runner

You can also run the built-in measured benchmark directly via npm:

```bash
npm run benchmark
```

---

## 3. Real Measured Benchmark Results

The following numbers represent an actual sustained 20-second benchmark execution measured against the service:

```text
================ REAL MEASURED BENCHMARK RUN ================
Actual Duration     : 20.00s
Total Requests Sent : 9418
Measured Throughput : 470.9 req/s
Allowed (200 OK)    : 7265
Denied (429 Limit)  : 2153
Server Errors (5xx) : 0 (0.00%)
----------------------------------------------------------------
Latency p50         : 2.06 ms
Latency p95         : 3.78 ms
Latency p99         : 10.68 ms
----------------------------------------------------------------
Hot Key Total Req   : 2372
Hot Key Allowed     : 219
Hot Key Theoretical : <= 220 allowed (Burst 20 + 10 tokens/s * 20.0s)
Enforcement Status  : [PASS] Compliant (0% token over-allocation)
================================================================
```

### Key Correctness Metric:
For the hot key with capacity $B = 20$ and refill rate $R = 10\text{ tokens/s}$ over $T = 20.0\text{s}$, the theoretical ceiling is $B + (R \times T) = 220$ requests. Real traffic allowed **219 requests**, proving zero token leakage.
