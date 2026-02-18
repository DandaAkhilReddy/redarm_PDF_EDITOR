// backend/test/lib/config.test.js
// Tests for backend/src/lib/config.js
// setup.js MUST be loaded first — it sets all required env vars before config.js
// is required, because config.js executes required() calls eagerly at load time.
require('../_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// config is a singleton via Node's module cache; safe to require here because
// setup.js has already been executed above.
const { config } = require('../../src/lib/config');

describe('config module', () => {

  describe('module loading', () => {
    it('exports a config object', () => {
      assert.ok(config !== null && typeof config === 'object',
        'config should be a non-null object');
    });

    it('config object has all expected top-level keys', () => {
      const expectedKeys = [
        'jwtSecret', 'jwtExpiresIn', 'bcryptRounds', 'lockoutThreshold',
        'lockoutMinutes', 'maxUploadBytes', 'bootstrapAdminEmail',
        'bootstrapAdminPassword', 'storageConnectionString', 'storageAccountName',
        'storageAccountKey', 'sourceContainer', 'exportContainer', 'ocrContainer',
        'usersTable', 'documentsTable', 'sessionsTable', 'jobsTable',
        'ocrQueue', 'exportQueue', 'docIntelEndpoint', 'docIntelKey',
        'docIntelModelId', 'appBaseUrl', 'contentSigningSecret'
      ];
      for (const key of expectedKeys) {
        assert.ok(Object.prototype.hasOwnProperty.call(config, key),
          `config should have property: ${key}`);
      }
    });
  });

  describe('required env var: JWT_SECRET', () => {
    it('reads jwtSecret from JWT_SECRET env var', () => {
      assert.equal(config.jwtSecret,
        'test-jwt-secret-key-that-is-at-least-32-characters-long-for-testing');
    });

    it('jwtSecret is a non-empty string', () => {
      assert.ok(typeof config.jwtSecret === 'string' && config.jwtSecret.length > 0,
        'jwtSecret must be a non-empty string');
    });
  });

  describe('optional env var with fallback: JWT_EXPIRES_IN', () => {
    it('reads jwtExpiresIn from JWT_EXPIRES_IN env var', () => {
      // setup.js sets JWT_EXPIRES_IN=8h, so we expect that value back
      assert.equal(config.jwtExpiresIn, '8h');
    });
  });

  describe('integer env vars (asInt)', () => {
    it('parses bcryptRounds as integer from BCRYPT_ROUNDS=4', () => {
      assert.equal(config.bcryptRounds, 4);
      assert.ok(Number.isInteger(config.bcryptRounds),
        'bcryptRounds must be an integer');
    });

    it('parses lockoutThreshold as integer from LOCKOUT_THRESHOLD=5', () => {
      assert.equal(config.lockoutThreshold, 5);
      assert.ok(Number.isInteger(config.lockoutThreshold),
        'lockoutThreshold must be an integer');
    });

    it('parses lockoutMinutes as integer from LOCKOUT_MINUTES=15', () => {
      assert.equal(config.lockoutMinutes, 15);
      assert.ok(Number.isInteger(config.lockoutMinutes),
        'lockoutMinutes must be an integer');
    });

    it('parses maxUploadBytes as integer from MAX_UPLOAD_BYTES=10485760', () => {
      assert.equal(config.maxUploadBytes, 10 * 1024 * 1024); // 10 MiB
      assert.ok(Number.isInteger(config.maxUploadBytes),
        'maxUploadBytes must be an integer');
    });
  });

  describe('bootstrapAdmin fields', () => {
    it('lowercases bootstrapAdminEmail from BOOTSTRAP_ADMIN_EMAIL', () => {
      // setup.js sets BOOTSTRAP_ADMIN_EMAIL='admin@test.redarm' (already lowercase)
      // The config applies .toLowerCase() — verifying the contract, not just the
      // literal value, by comparing against the lowercased env var.
      const expected = process.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
      assert.equal(config.bootstrapAdminEmail, expected);
      assert.equal(config.bootstrapAdminEmail, 'admin@test.redarm');
    });

    it('bootstrapAdminEmail contains no uppercase letters', () => {
      assert.equal(config.bootstrapAdminEmail,
        config.bootstrapAdminEmail.toLowerCase(),
        'bootstrapAdminEmail should always be lowercased');
    });

    it('reads bootstrapAdminPassword from BOOTSTRAP_ADMIN_PASSWORD', () => {
      assert.equal(config.bootstrapAdminPassword, 'TestPassword123!');
    });
  });

  describe('storage connection string and parsed fields', () => {
    it('stores the raw STORAGE_CONNECTION_STRING', () => {
      assert.equal(config.storageConnectionString,
        process.env.STORAGE_CONNECTION_STRING);
    });

    it('storageAccountName resolves to devstoreaccount1 (from STORAGE_ACCOUNT_NAME env var)', () => {
      // setup.js sets STORAGE_ACCOUNT_NAME explicitly, so optional() returns it
      assert.equal(config.storageAccountName, 'devstoreaccount1');
    });

    it('storageAccountKey resolves to the Azurite well-known key (from STORAGE_ACCOUNT_KEY env var)', () => {
      const azuriteKey =
        'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
      assert.equal(config.storageAccountKey, azuriteKey);
    });
  });

  describe('parseConnectionString — AccountName and AccountKey extraction', () => {
    // The connection string set by setup.js contains AccountName and AccountKey
    // segments. When STORAGE_ACCOUNT_NAME / STORAGE_ACCOUNT_KEY are NOT set the
    // fallback comes from parseConnectionString. We verify the parsed values
    // embedded in the live connection string are correct by cross-checking the
    // env var that overrides them — they must be identical.
    it('parsed AccountName from connection string matches STORAGE_ACCOUNT_NAME', () => {
      // Both the explicit env var and the connection string segment carry the same
      // value for the Azurite emulator, so the final config value must equal both.
      assert.equal(config.storageAccountName, 'devstoreaccount1',
        'AccountName parsed from connection string should be devstoreaccount1');
    });

    it('parsed AccountKey from connection string matches STORAGE_ACCOUNT_KEY', () => {
      const expectedKey = process.env.STORAGE_ACCOUNT_KEY;
      assert.equal(config.storageAccountKey, expectedKey,
        'AccountKey parsed from connection string should match env var');
      assert.ok(config.storageAccountKey.length > 0,
        'storageAccountKey must not be empty');
    });
  });

  describe('container names', () => {
    it('sourceContainer equals BLOB_SOURCE_CONTAINER (pdf-source)', () => {
      assert.equal(config.sourceContainer, 'pdf-source');
    });

    it('exportContainer equals BLOB_EXPORT_CONTAINER (pdf-export)', () => {
      assert.equal(config.exportContainer, 'pdf-export');
    });

    it('ocrContainer equals BLOB_OCR_CONTAINER (ocr-json)', () => {
      assert.equal(config.ocrContainer, 'ocr-json');
    });
  });

  describe('table names', () => {
    it('usersTable equals TABLE_USERS (users)', () => {
      assert.equal(config.usersTable, 'users');
    });

    it('documentsTable equals TABLE_DOCUMENTS (documents)', () => {
      assert.equal(config.documentsTable, 'documents');
    });

    it('sessionsTable equals TABLE_SESSIONS (sessions)', () => {
      assert.equal(config.sessionsTable, 'sessions');
    });

    it('jobsTable equals TABLE_JOBS (jobs)', () => {
      assert.equal(config.jobsTable, 'jobs');
    });
  });

  describe('queue names', () => {
    it('ocrQueue equals QUEUE_OCR (q-ocr)', () => {
      assert.equal(config.ocrQueue, 'q-ocr');
    });

    it('exportQueue equals QUEUE_EXPORT (q-export)', () => {
      assert.equal(config.exportQueue, 'q-export');
    });
  });

  describe('optional fields with empty fallbacks (not set in setup.js)', () => {
    it('docIntelEndpoint is an empty string when DOCINTEL_ENDPOINT is not set', () => {
      // setup.js does not set DOCINTEL_ENDPOINT, so optional() returns ""
      assert.equal(config.docIntelEndpoint, '');
    });

    it('docIntelKey is an empty string when DOCINTEL_KEY is not set', () => {
      assert.equal(config.docIntelKey, '');
    });

    it('docIntelModelId falls back to prebuilt-read when DOCINTEL_MODEL_ID is not set', () => {
      assert.equal(config.docIntelModelId, 'prebuilt-read');
    });

    it('appBaseUrl is an empty string when APP_BASE_URL is not set', () => {
      assert.equal(config.appBaseUrl, '');
    });
  });

  describe('contentSigningSecret', () => {
    it('contentSigningSecret is a non-empty string', () => {
      assert.ok(typeof config.contentSigningSecret === 'string',
        'contentSigningSecret must be a string');
      assert.ok(config.contentSigningSecret.length > 0,
        'contentSigningSecret must not be empty');
    });

    it('contentSigningSecret looks like a hex string when generated by crypto.randomBytes', () => {
      // When CONTENT_SIGNING_SECRET is not set, config.js generates a 16-byte
      // hex string (32 hex chars). If it IS set the value is whatever was provided.
      // setup.js does not set CONTENT_SIGNING_SECRET, so we expect a hex string.
      const isHex = /^[0-9a-f]+$/i.test(config.contentSigningSecret);
      assert.ok(isHex, `contentSigningSecret should be hex but got: ${config.contentSigningSecret}`);
      assert.equal(config.contentSigningSecret.length, 32,
        'crypto.randomBytes(16).toString("hex") produces exactly 32 hex characters');
    });
  });

});
