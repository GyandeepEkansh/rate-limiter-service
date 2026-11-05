const fs = require('fs');
const path = require('path');
const config = require('./config');

// Use real Redis by default, or ioredis-mock if USE_MOCK_REDIS=true
const Redis = process.env.USE_MOCK_REDIS === 'true' 
  ? require('ioredis-mock') 
  : require('ioredis');

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

redis.on('error', (err) => {
  // Only log if not mock
  if (process.env.USE_MOCK_REDIS !== 'true') {
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
