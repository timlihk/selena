function apiError(res, status, message, details = null) {
  const response = {
    success: false,
    error: message
  };
  if (details) {
    response.details = details;
  }
  return res.status(status).json(response);
}

module.exports = apiError;
