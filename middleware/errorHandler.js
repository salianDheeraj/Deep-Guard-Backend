const errorHandler = (err, req, res, next) => {
  let statusCode = 500;
  let errorMessage = 'Internal Server Error';
  let errorType = 'UNKNOWN_ERROR';
  let errorDetails = {};

  // ===== YOUR EXISTING CHECKS HERE =====
  // (Keep all your current error handling code)

  // ===== ADD THESE NEW CHECKS =====
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    errorMessage = 'File size exceeds maximum limit of 10MB';
    errorType = 'FILE_TOO_LARGE';
  }
  else if (err.code === 'LIMIT_FILE_COUNT') {
    statusCode = 400;
    errorMessage = 'Only one file is allowed';
    errorType = 'MULTIPLE_FILES';
  }
  else if (err.message && err.message.includes('Unsupported file format')) {
    statusCode = 415;
    errorMessage = err.message;
    errorType = 'UNSUPPORTED_FILE_TYPE';
  }
  else if (err.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorMessage = 'Unable to connect to database';
    errorType = 'CONNECTION_ERROR';
  }
  else if (err.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorMessage = 'Request timed out';
    errorType = 'TIMEOUT_ERROR';
  }
 else if(err.code===('file too short')){

     statusCode = 400;
    errorMessage = 'file too short';
    errorType = 'FILE_TOO_Small';
  } else{
    statusCode = err.status || err.statusCode || 500;
    errorMessage = err.message || 'Internal Server Error';
  }

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    error: errorMessage,
    errorType: errorType,
    details: errorDetails,
    timestamp: new Date().toISOString()
  });
};

module.exports = errorHandler;
