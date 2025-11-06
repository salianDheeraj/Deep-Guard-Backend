const { v4: uuidv4 } = require("uuid");

const generateAnalysisId = () => {
  return `analysis_${uuidv4().slice(0, 8)}_${Date.now()}`;
};

const generateSupabasePath = (userId, analysisId, filename) => {
  const timestamp = Date.now();
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `users/${userId}/analyses/${analysisId}/${timestamp}_${sanitized}`;
};

const handleSuccess = (res, statusCode, data) => {
  return res.status(statusCode).json({
    success: true,
    status: statusCode,
    data: data,
    timestamp: new Date().toISOString()
  });
};

const handleError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    status: statusCode,
    error: message,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  generateAnalysisId,
  generateSupabasePath,
  handleSuccess,
  handleError
};
