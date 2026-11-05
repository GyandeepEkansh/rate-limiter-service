# Load Testing Guide

This directory contains load testing configurations to benchmark the rate limiter service under high concurrency ($500+$ requests per second) and verify mathematical rate limit correctness.

## Test Scenario

- **Target Throughput**: 500-600+ requests/second
- **Duration**: 30-60 seconds
- **Traffic Pattern**:
  - 75% traffic across 50 normal client keys (`client-0` to `client-49`)
  - 25% traffic directed at a single "hot key" (`hot-client-key`)
- **Mathematical Correctness Check**:
  For the hot key with burst $B = 20$ and refill rate $R = 10\text{ tokens/s}$, total allowed requests over duration $T$ must be strictly $\le B + (R \times T)$.

---

## Option 1: Run with k6 (Recommended)

### Using installed k6 binary:
```bash
k6 run load-test/check.js
```

### Using k6 Docker image:
```bash
docker run --rm -i --network="host" grafana/k6 run - < load-test/check.js
```

### Customizing Target URL or Admin Key:
```bash
k6 run -e API_URL=http://localhost:3000 -e ADMIN_API_KEY=admin-secret-key-123 load-test/check.js
```

---

## Option 2: Run with Native Node.js Runner (No k6 installation needed)

If you do not have k6 installed, run the included native high-throughput runner:
```bash
node load-test/runner.js
```

### Custom parameters:
```bash
TARGET_RPS=700 DURATION_SECONDS=30 API_URL=http://localhost:3000 node load-test/runner.js
```

---

## Expected Output Sample

```
================== LOAD TEST BENCHMARK RESULTS ==================
Total Requests Sent : 18000
Actual Duration     : 30.00s
Throughput          : 600.0 req/s
Total Allowed (200) : 4850
Total Denied (429)  : 13150
Server Errors (5xx) : 0
-----------------------------------------------------------------
Latency p50         : 2.15 ms
Latency p95         : 4.80 ms
Latency p99         : 8.42 ms
-----------------------------------------------------------------
Hot Key Total Req   : 4500
Hot Key Allowed     : 320
Hot Key Theoretical : <= 320 allowed (B=20 + R=10 * T=30.0s)
CORRECTNESS CHECK   : [PASS] Rate limiter accurately enforced token bucket constraints!
=================================================================
```
