function json(status, body, headers = {}) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  };
}

function error(status, code, message, details) {
  return json(status, {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

module.exports = {
  json,
  error
};