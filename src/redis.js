const fs = require('fs');
const path = require('path');
const config = require('./config');

// Use real Redis by default, or ioredis-mock if USE_MOCK_REDIS=true
const isMock = process.env.USE_MOCK_REDIS === 'true';
const Redis = isMock ? require('ioredis-mock') : require('ioredis');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

// Fix: ioredis-mock has a buggy TIME implementation that combines Math.round()
// with hrtime() nanoseconds, causing artificial clock jumps.
// Provide true monotonic [sec, micro] matching real Redis gettimeofday.
if (isMock) {
  redis.time = function() {
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const micro = (now % 1000) * 1000;
    return [sec.toString(), micro.toString()];
  };
}

redis.on('error', (err) => {
  if (!isMock) {
    console.error('[Redis Client Error]', err.message || 'Connection refused at ' + config.redis.host + ':' + config.redis.port);
  }
});

redis.on('connect', () => {
  console.log(`[Redis] Connected to ${config.redis.host}:${config.redis.port}`);
});

/**
 * Register custom Lua scripts on a Redis client instance
 * @param {Redis} client
 */
function registerLuaCommands(client) {
  // If client is a mock instance, ensure accurate TIME implementation
  if (client.constructor && client.constructor.name === 'RedisMock') {
    client.time = function() {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      const micro = (now % 1000) * 1000;
      return [sec.toString(), micro.toString()];
    };
  }

  const tokenBucketLuaPath = path.join(__dirname, 'lua', 'tokenBucket.lua');
  if (fs.existsSync(tokenBucketLuaPath)) {
    const lua = fs.readFileSync(tokenBucketLuaPath, 'utf8');
    client.defineCommand('tokenBucketEval', {
      numberOfKeys: 1,
      lua,
    });
  }

  const slidingWindowLuaPath = path.join(__dirname, 'lua', 'slidingWindow.lua');
  if (fs.existsSync(slidingWindowLuaPath)) {
    const lua = fs.readFileSync(slidingWindowLuaPath, 'utf8');
    client.defineCommand('slidingWindowEval', {
      numberOfKeys: 1,
      lua,
    });
  }
}

// Register commands on default client
registerLuaCommands(redis);

module.exports = redis;
module.exports.registerLuaCommands = registerLuaCommands;
