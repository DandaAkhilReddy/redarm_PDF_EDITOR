function sanitizeFileName(name) {
  return String(name || "source.pdf")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function decodeQueueMessage(message) {
  if (typeof message === "string") {
    const parsed = safeJsonParse(message);
    if (parsed) {
      return parsed;
    }
    const maybeBase64 = Buffer.from(message, "base64").toString("utf8");
    return safeJsonParse(maybeBase64) || {};
  }

  if (Buffer.isBuffer(message)) {
    return safeJsonParse(message.toString("utf8")) || {};
  }

  return message || {};
}

module.exports = {
  sanitizeFileName,
  decodeQueueMessage
};