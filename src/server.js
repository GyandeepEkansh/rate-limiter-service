const express = require('express');
const config = require('./config');
const redis = require('./redis');
const healthRoutes = require('./routes/health');
const checkRoutes = require('./routes/check');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());

// Routes
app.use('/health', healthRoutes);
app.use('/check', checkRoutes);
app.use('/admin', adminRoutes);

// Root placeholder
app.get('/', (req, res) => {
  res.json({
    name: 'Rate Limiter Service',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      check: 'POST /check',
      admin: 'PUT /admin/clients/:key, GET /admin/clients/:key, DELETE /admin/clients/:key',
    },
  });
});

let server = null;

if (require.main === module) {
  // Connect to Redis and start server
  redis.connect().catch((err) => {
    console.warn('[Redis] Initial connection warning:', err.message);
  });

  server = app.listen(config.port, () => {
    console.log(`[Rate Limiter Service] Running on port ${config.port}`);
  });
}

module.exports = { app, server };
