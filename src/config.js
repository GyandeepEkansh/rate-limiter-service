require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  defaults: {
    algorithm: process.env.DEFAULT_ALGORITHM || 'token_bucket',
    rate: parseFloat(process.env.DEFAULT_RATE) || 10,
    burst: parseInt(process.env.DEFAULT_BURST, 10) || 20,
    limit: parseInt(process.env.DEFAULT_LIMIT, 10) || 100,
    windowSeconds: parseInt(process.env.DEFAULT_WINDOW_SECONDS, 10) || 60,
  },
  adminApiKey: process.env.ADMIN_API_KEY || 'admin-secret-key-123',
};
