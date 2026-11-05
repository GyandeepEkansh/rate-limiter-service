-- Sliding Window Rate Limiter (Sorted Set Log)
-- KEYS[1]: window key (window:{key})
-- ARGV[1]: limit (max requests in window)
-- ARGV[2]: window_ms (window length in milliseconds)
-- ARGV[3]: unique_id (unique request identifier)

local windowKey = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local unique_id = ARGV[3]

-- 1. Get current time from Redis TIME
local time = redis.call('TIME')
local now_sec = tonumber(time[1])
local now_micro = tonumber(time[2])
local now = now_sec * 1000 + math.floor(now_micro / 1000)

-- 2. Remove entries older than (now - window_ms)
local clearBefore = now - window_ms
redis.call('ZREMRANGEBYSCORE', windowKey, 0, clearBefore)

-- 3. Count current entries in window
local count = tonumber(redis.call('ZCARD', windowKey))

-- 4. Check if limit is reached
local allowed = 0
local retry_after = 0

if count < limit then
  -- Allowed: record this request in sorted set with score = now
  redis.call('ZADD', windowKey, now, unique_id)
  allowed = 1
  count = count + 1
else
  -- Denied: calculate retry_after from the oldest entry's score
  allowed = 0
  local oldest = redis.call('ZRANGE', windowKey, 0, 0, 'WITHSCORES')
  if oldest and #oldest >= 2 then
    local oldest_ts = tonumber(oldest[2])
    local diff = (oldest_ts + window_ms) - now
    if diff > 0 then
      retry_after = diff / 1000
    else
      retry_after = 0.001
    end
  else
    retry_after = window_ms / 1000
  end
end

-- 5. Set TTL on sorted set
redis.call('PEXPIRE', windowKey, window_ms)

local remaining = math.max(0, limit - count)
local reset_after = window_ms / 1000

-- Return: [allowed (0 or 1), limit, remaining, reset_after (str), retry_after (str)]
return {
  allowed,
  limit,
  remaining,
  tostring(reset_after),
  tostring(retry_after)
}
