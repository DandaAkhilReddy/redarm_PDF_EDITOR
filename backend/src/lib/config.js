const crypto = require("crypto");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function asInt(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseConnectionString(connectionString) {
  const parts = connectionString.split(";").filter(Boolean);
  const map = new Map();
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) {
      map.set(p.substring(0, i), p.substring(i + 1));
    }
  }
  return {
    accountName: map.get("AccountName") || "",
    accountKey: map.get("AccountKey") || ""
  };
}

const connectionString = required("STORAGE_CONNECTION_STRING");
const parsed = parseConnectionString(connectionString);

const config = {
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "8h"),
  bcryptRounds: asInt("BCRYPT_ROUNDS", 10),
  lockoutThreshold: asInt("LOCKOUT_THRESHOLD", 5),
  lockoutMinutes: asInt("LOCKOUT_MINUTES", 15),
  maxUploadBytes: asInt("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  bootstrapAdminEmail: optional("BOOTSTRAP_ADMIN_EMAIL").toLowerCase(),
  bootstrapAdminPassword: optional("BOOTSTRAP_ADMIN_PASSWORD"),
  storageConnectionString: connectionString,
  storageAccountName: optional("STORAGE_ACCOUNT_NAME", parsed.accountName),
  storageAccountKey: optional("STORAGE_ACCOUNT_KEY", parsed.accountKey),
  sourceContainer: optional("BLOB_SOURCE_CONTAINER", "pdf-source"),
  exportContainer: optional("BLOB_EXPORT_CONTAINER", "pdf-export"),
  ocrContainer: optional("BLOB_OCR_CONTAINER", "ocr-json"),
  usersTable: optional("TABLE_USERS", "users"),
  documentsTable: optional("TABLE_DOCUMENTS", "documents"),
  sessionsTable: optional("TABLE_SESSIONS", "sessions"),
  jobsTable: optional("TABLE_JOBS", "jobs"),
  ocrQueue: optional("QUEUE_OCR", "q-ocr"),
  exportQueue: optional("QUEUE_EXPORT", "q-export"),
  docIntelEndpoint: optional("DOCINTEL_ENDPOINT"),
  docIntelKey: optional("DOCINTEL_KEY"),
  docIntelModelId: optional("DOCINTEL_MODEL_ID", "prebuilt-read"),
  appBaseUrl: optional("APP_BASE_URL"),
  contentSigningSecret: optional("CONTENT_SIGNING_SECRET", crypto.randomBytes(16).toString("hex"))
};

module.exports = {
  config
};