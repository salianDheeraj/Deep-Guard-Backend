const logger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.connection.remoteAddress;

  console.log(`${timestamp} - ${method} ${path} - IP: ${ip}`);

  // Log request body for POST/PUT (without sensitive data)
  if (req.method === 'POST' || req.method === 'PUT') {
    const body = { ...req.body };
    // Remove sensitive fields
    delete body.password;
    delete body.token;
    delete body.apiKey;
    console.log(`   Body:`, body);
  }

  // Log response time
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusColor = status >= 400 ? '❌' : '✅';
    console.log(`   ${statusColor} Status: ${status} - Duration: ${duration}ms\n`);
  });

  next();
};

module.exports = logger;
