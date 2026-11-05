-- Token Bucket Atomic Rate Limiter
-- KEYS[1]: bucket key (bucket:{key})
-- ARGV[1]: burst (max tokens)
-- ARGV[2]: rate (tokens per second)

local bucketKey = KEYS[1]
local burst = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])

-- 1. Get current time from Redis TIME
local time = redis.call('TIME')
local now_sec = tonumber(time[1])
local now_micro = tonumber(time[2])
local now_ms = now_sec * 1000 + math.floor(now_micro / 1000)

-- 2. Retrieve bucket state
local tokens = burst
local last_refill_ms = now_ms

local exists = redis.call('EXISTS', bucketKey)
if exists == 1 then
  local stored_tokens = redis.call('HGET', bucketKey, 'tokens')
  local stored_last = redis.call('HGET', bucketKey, 'last_refill_ms')
  if stored_tokens and stored_last then
    tokens = tonumber(stored_tokens)
    last_refill_ms = tonumber(stored_last)
  end
end

if not tokens then tokens = burst end
if not last_refill_ms then last_refill_ms = now_ms end

-- 3. Compute elapsed time in seconds and refill tokens
local elapsed = math.max(0, (now_ms - last_refill_ms) / 1000)
tokens = math.min(burst, tokens + elapsed * rate)

-- 4. Check if a token is available
local allowed = 0
local retry_after = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  allowed = 0
  if rate > 0 then
    retry_after = (1 - tokens) / rate
  else
    retry_after = 60
  end
end

-- 5. Save state back to Redis
redis.call('HSET', bucketKey, 'tokens', tostring(tokens), 'last_refill_ms', tostring(now_ms))

-- 6. Set key expiration (at least 60s, or 2 * burst / rate)
local ttl = 60
if rate > 0 then
  ttl = math.max(60, math.ceil((burst / rate) * 2))
end
redis.call('EXPIRE', bucketKey, ttl)

local remaining = math.max(0, math.floor(tokens))
local reset_after = 0
if rate > 0 then
  reset_after = math.max(0, (burst - tokens) / rate)
end

-- Return: [allowed (0 or 1), burst, remaining, reset_after (str), retry_after (str)]
return {
  allowed,
  burst,
  remaining,
  tostring(reset_after),
  tostring(retry_after)
}
