require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const adminApiKey = process.env.ADMIN_API_KEY;

// Security check: Never allow default or empty admin keys in production
if (isProduction && (!adminApiKey || adminApiKey === 'admin-secret-key-123')) {
  throw new Error('FATAL: In production, ADMIN_API_KEY must be set to a secure, non-default value.');
}

module.exports = {
  isProduction,
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
  adminApiKey: adminApiKey || 'admin-secret-key-123',
  // Fail-Closed by default: If Redis goes down, protect downstream services by returning 503
  // Set FAIL_OPEN=true if availability is prioritized over strict rate limit enforcement
  failOpen: process.env.FAIL_OPEN === 'true',
};
