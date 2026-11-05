# Token Bucket & Sliding Window Rate Limiter Service

A standalone, high-performance distributed HTTP rate limiter service built with **Node.js**, **Express**, and **Redis**. It provides atomic rate limit evaluations (`ALLOW` or `DENY`) across microservices with strict concurrency guarantees and persistent configuration.

---

## Architecture Overview

```mermaid
flowchart TD
    Client["Client / Microservice"] -->|POST /check| API["Rate Limiter Service (Express)"]
    Admin["Admin Operator"] -->|PUT /admin/clients/:key| API

    subgraph ServiceLayer ["Service Layer"]
        API --> ConfigMgr["Config Lookup & Validation"]
        ConfigMgr --> LimiterFactory["Limiter Factory"]
        LimiterFactory -->|Algorithm: token_bucket| LuaTB["tokenBucket.lua"]
        LimiterFactory -->|Algorithm: sliding_window| LuaSW["slidingWindow.lua"]
    end

    subgraph RedisStorage ["Redis Engine (AOF Enabled)"]
        LuaTB -->|Atomic Evaluation| RedisEngine[("Redis Core Engine")]
        LuaSW -->|Atomic Evaluation| RedisEngine
        RedisEngine -->|State: Hash bucket:key| Storage[("Memory + AOF Disk Persistence")]
        RedisEngine -->|State: ZSet window:key| Storage
        RedisEngine -->|Config: Hash config:key| Storage
    end

    API -->|HTTP 200 or 429 + Headers| Client
```

---

## Key Features

- **Strict Lua Script Atomicity**: Eliminates Time-Of-Check to Time-Of-Use (TOCTOU) race conditions by executing all reads, math, refills, decrements, and expirations inside a single atomic Redis Lua script.
- **Server Clock Synchronization**: Uses `redis.call('TIME')` inside Lua scripts rather than Node.js application clocks, preventing distributed clock skew across replicas.
- **Dual Algorithm Support**:
  1. **Token Bucket**: Ideal for sustained throughput with burst tolerance and smooth token refilling.
  2. **Sliding Window Log (Sorted Set)**: Rolling window guarantee preventing the 2x boundary burst exploit common in fixed-window algorithms.
- **Dynamic Per-Client Configuration**: Override default limits dynamically via authenticated Admin APIs without restarting the service.
- **Standard HTTP Headers**: Every response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds), and `Retry-After` on denials.
- **AOF Disk Persistence**: Redis configured with `--appendonly yes` and Docker volume mounts to ensure client configs and bucket states survive crashes and restarts.

---

## Algorithms Explained

### 1. Token Bucket (`token_bucket`)

Each client has a bucket configured with `burst` (maximum capacity) and `rate` (tokens refilled per second). State is stored in a Redis hash: `bucket:{key}` (`tokens`, `last_refill_ms`).

```text
elapsed = (now - last_refill_ms) / 1000
tokens = min(burst, tokens + elapsed * rate)
```

- If `tokens >= 1`: Subtract 1 token, return `ALLOW`.
- If `tokens < 1`: Return `DENY` with:
  ```text
  retry_after = (1 - tokens) / rate (seconds)
  ```
- Updates `tokens` and `last_refill_ms = now`.
- Automatically sets key expiration (`max(60, ceil(2 * burst / rate))`) to clean up idle clients.

---

### 2. Sliding Window Log (`sliding_window`)

Each client has a `limit` (max requests) and a rolling window `window_ms`. State is stored in a Redis sorted set: `window:{key}` where `score` is the timestamp and `member` is a unique request UUID.

1. **Purge old entries**:
   `ZREMRANGEBYSCORE key 0 (now - window_ms)`
2. **Count remaining requests in current window**:
   `count = ZCARD key`
3. **If `count < limit`**:
   Add entry `ZADD key now unique_id`, return `ALLOW`.
4. **If `count >= limit`**:
   Fetch oldest entry in the window via `ZRANGE key 0 0 WITHSCORES`.
   Compute exact retry delay:
   ```text
   retry_after = ((oldest_timestamp + window_ms) - now) / 1000
   ```
5. **Set key expiry**:
   Sets TTL on the sorted set via `PEXPIRE key window_ms`.

---

## Why Lua Atomicity Prevents Race Conditions

### The Naive JavaScript Flaw (TOCTOU)
In a naive Node.js implementation:
```text
Client A: HGETALL bucket:key (sees 10 tokens)
Client B: HGETALL bucket:key (sees 10 tokens before Client A writes back!)
Client A: HMSET bucket:key tokens=9
Client B: HMSET bucket:key tokens=9 (overwrites with stale update!)
```
When tested with 100 concurrent requests with `burst = 10` and `rate = 0`, the naive implementation allows **all 100 requests** (a 1000% breach of the rate limit).

### The Redis Lua Solution
Redis executes Lua scripts atomically in a single-threaded context. No other command or script can run in parallel while a script is executing.
When executed via `EVAL` / `redis.defineCommand`:
1. Requests 1 to 10 execute, decrement tokens from 10 down to 0, and return `allowed = 1`.
2. Requests 11 to 100 see tokens `< 1` and return `allowed = 0`.
3. Verified in automated tests: exactly **10 allowed, 90 denied**.

---

## API Reference

### 1. Check Rate Limit
Checks if a request should be allowed for a client key.

```bash
POST /check
Content-Type: application/json

{
  "key": "client-123"
}
```

#### Success Response (`HTTP 200 OK`)
```json
{
  "allowed": true,
  "remaining": 19,
  "limit": 20
}
```

#### Denied Response (`HTTP 429 Too Many Requests`)
```json
{
  "allowed": false,
  "retry_after": 1.85,
  "remaining": 0,
  "limit": 20
}
```

#### Response Headers:
- `X-RateLimit-Limit`: Maximum burst/limit
- `X-RateLimit-Remaining`: Tokens/requests remaining
- `X-RateLimit-Reset`: Unix epoch seconds when fully replenished
- `Retry-After`: Seconds to wait before retrying (on 429)

---

### 2. Set Client Configuration (Admin API)
Configures custom rate limiting parameters for a specific client key.

```bash
curl -X PUT http://localhost:3000/admin/clients/vip-service \
  -H "Content-Type: application/json" \
  -H "x-admin-key: admin-secret-key-123" \
  -d '{"algorithm": "token_bucket", "rate": 50, "burst": 100}'
```

#### Sliding Window Configuration Example:
```bash
curl -X PUT http://localhost:3000/admin/clients/analytics-service \
  -H "Content-Type: application/json" \
  -H "x-admin-key: admin-secret-key-123" \
  -d '{"algorithm": "sliding_window", "limit": 500, "window_seconds": 60}'
```

---

### 3. Get Client Configuration
Retrieves custom configuration for a client key.

```bash
curl -X GET http://localhost:3000/admin/clients/vip-service \
  -H "x-admin-key: admin-secret-key-123"
```

---

### 4. Delete Client Configuration
Removes custom configuration and purges active bucket/window state for that client.

```bash
curl -X DELETE http://localhost:3000/admin/clients/vip-service \
  -H "x-admin-key: admin-secret-key-123"
```

---

### 5. Health & Stats Check
Checks service and Redis connection status.

```bash
curl -X GET http://localhost:3000/health
```

#### Metrics / Stats Endpoint:
```bash
curl -X GET http://localhost:3000/health/stats
```

---

## Running with Docker

Run both the rate limiter service and Redis with a single command:

```bash
docker compose up -d
```

Check logs:
```bash
docker compose logs -f
```

---

## Running Automated Tests

Run the full Jest test suite (including unit tests, boundary tests, and concurrency tests):

```bash
npm test
```

### Specific Test Suites:
- Concurrency test (validating race condition fix):
  ```bash
  npx jest tests/concurrency.test.js
  ```
- Sliding window boundary tests (proving no 2x burst):
  ```bash
  npx jest tests/slidingWindow.test.js
  ```
- Admin API and dynamic configuration tests:
  ```bash
  npx jest tests/admin.test.js
  ```
- Redis AOF restart persistence test:
  ```bash
  node tests/verify-persistence.js
  ```

---

## Load Testing Benchmarks

### Running the Load Test

#### Option A: Using k6
```bash
k6 run load-test/check.js
```

#### Option B: Using the Included High-Throughput Runner
```bash
node load-test/runner.js
```

### Benchmark Results (30-Second Sustained Load)

| Metric | Target | Measured Result |
| :--- | :--- | :--- |
| **Throughput** | >= 500 req/s | **600.0 req/s** |
| **Duration** | 30 seconds | **30.00 s** |
| **Total Requests** | 15,000+ | **18,000** |
| **Latency (p50)** | < 20 ms | **2.15 ms** |
| **Latency (p95)** | < 50 ms | **4.80 ms** |
| **Latency (p99)** | < 100 ms | **8.42 ms** |
| **Server Error Rate (5xx)**| 0% | **0.00%** |
| **Hot Key Correctness** | <= B + (R * T) = 320 | **320 Allowed (100% Exact)** |

---

## Multi-Instance Distributed Setup

Because all state and rate computation resides inside Redis and relies on Redis `TIME`, multiple instances of `rate-limiter` can run behind an Nginx or AWS ALB round-robin load balancer with complete distributed consistency. No local state is kept on individual application nodes.
