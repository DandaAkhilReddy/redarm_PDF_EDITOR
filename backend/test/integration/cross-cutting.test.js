// backend/test/integration/cross-cutting.test.js
// Integration tests for cross-cutting concerns across all endpoints:
// consistent headers, error shapes, email normalization, no secret leaks,
// Content-Type, and UUID format validation.

// 1. Env vars — must be first
require('../_helpers/setup');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// 2. module-mocks — MUST be before any src/ require
const mm = require('../_helpers/module-mocks');

// 3. Other test helpers
const { createMockRequest, createMockContext } = require('../_helpers/mocks');
const { createToken } = require('../../src/lib/auth');

// ---------------------------------------------------------------------------
// Capture handlers from multiple function modules
// ---------------------------------------------------------------------------
const handlers = {};

const realFunctions = require('@azure/functions');
const originalHttp = realFunctions.app.http;

realFunctions.app.http = function (name, options) {
  handlers[name] = options.handler;
  return originalHttp.call(this, name, options);
};

// Load all handler modules AFTER module-mocks and app.http intercept
require('../../src/functions/authLogin');
require('../../src/functions/docsUploadUrl');
require('../../src/functions/docsSaveAnnotation');
require('../../src/functions/jobsGet');
require('../../src/functions/docsExportStart');

// Restore immediately
realFunctions.app.http = originalHttp;

// Verify all handlers were captured
assert.ok(handlers['auth-login'], 'auth-login handler was not captured');
assert.ok(handlers['docs-upload-url'], 'docs-upload-url handler was not captured');
assert.ok(handlers['docs-save-annotation'], 'docs-save-annotation handler was not captured');
assert.ok(handlers['jobs-get'], 'jobs-get handler was not captured');
assert.ok(handlers['docs-export-start'], 'docs-export-start handler was not captured');

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const BCRYPT_ROUNDS = 4;
const VALID_PASSWORD = 'CorrectHorseBatteryStaple!';
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL; // 'admin@test.redarm'
let VALID_HASH;

function makeUser(email, hash, overrides = {}) {
  return {
    email,
    passwordHash: hash,
    role: 'admin',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDocument(docId, ownerEmail, overrides = {}) {
  return {
    docId,
    ownerEmail,
    title: 'test.pdf',
    blobPath: `pdf-source/${ownerEmail}/${docId}/test.pdf`,
    sourceBlobName: `${ownerEmail}/${docId}/test.pdf`,
    contentType: 'application/pdf',
    annotationJson: '{}',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(jobId, ownerEmail, overrides = {}) {
  return {
    jobId,
    ownerEmail,
    type: 'export',
    status: 'completed',
    resultUri: 'http://mock/result.pdf',
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function authHeaders(email = ADMIN_EMAIL, role = 'admin') {
  const token = createToken(email, role);
  return { authorization: `Bearer ${token}` };
}

// UUID v4 regex: 8-4-4-4-12 hex digits, version nibble is 4
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-cutting concerns', () => {
  beforeEach(async () => {
    mm.resetAll();
    if (!VALID_HASH) {
      VALID_HASH = await bcrypt.hash(VALID_PASSWORD, BCRYPT_ROUNDS);
    }
  });

  // -------------------------------------------------------------------------
  // 1. All responses set Content-Type to application/json
  // -------------------------------------------------------------------------
  describe('Content-Type header', () => {
    it('all responses set Content-Type to application/json', async () => {
      // -- authLogin success --
      mm.setGetUser(async () => makeUser(ADMIN_EMAIL, VALID_HASH));
      mm.setUpsertUser(mm.spy());
      const loginRes = await handlers['auth-login'](
        createMockRequest({ body: { email: ADMIN_EMAIL, password: VALID_PASSWORD } }),
        createMockContext()
      );
      assert.equal(loginRes.headers['Content-Type'], 'application/json',
        'authLogin success must set Content-Type to application/json');

      // -- authLogin error (validation) --
      mm.resetAll();
      const loginErrRes = await handlers['auth-login'](
        createMockRequest({ body: {} }),
        createMockContext()
      );
      assert.equal(loginErrRes.headers['Content-Type'], 'application/json',
        'authLogin error must set Content-Type to application/json');

      // -- docsUploadUrl success --
      mm.resetAll();
      mm.setUpsertDocument(mm.spy());
      const uploadRes = await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'test.pdf', contentType: 'application/pdf' },
          headers: authHeaders(),
        }),
        createMockContext()
      );
      assert.equal(uploadRes.headers['Content-Type'], 'application/json',
        'docsUploadUrl success must set Content-Type to application/json');

      // -- docsSaveAnnotation error (missing docId) --
      mm.resetAll();
      const saveErrRes = await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [] },
          headers: authHeaders(),
          params: {},
        }),
        createMockContext()
      );
      assert.equal(saveErrRes.headers['Content-Type'], 'application/json',
        'docsSaveAnnotation error must set Content-Type to application/json');

      // -- jobsGet success --
      mm.resetAll();
      const jobId = 'job-123';
      mm.setGetJob(async () => makeJob(jobId, ADMIN_EMAIL));
      const jobRes = await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId },
          headers: authHeaders(),
        }),
        createMockContext()
      );
      assert.equal(jobRes.headers['Content-Type'], 'application/json',
        'jobsGet success must set Content-Type to application/json');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Error responses never leak stack traces
  // -------------------------------------------------------------------------
  describe('No stack trace leaks', () => {
    it('error responses never leak stack traces or file paths', async () => {
      const errorResponses = [];

      // authLogin — invalid credentials
      mm.setGetUser(async () => null);
      errorResponses.push(await handlers['auth-login'](
        createMockRequest({ body: { email: 'nobody@x.com', password: 'wrong' } }),
        createMockContext()
      ));

      // authLogin — validation error
      mm.resetAll();
      errorResponses.push(await handlers['auth-login'](
        createMockRequest({ body: {} }),
        createMockContext()
      ));

      // docsSaveAnnotation — document not found
      mm.resetAll();
      mm.setGetDocument(async () => null);
      errorResponses.push(await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: authHeaders(),
          params: { docId: 'nonexistent' },
        }),
        createMockContext()
      ));

      // docsSaveAnnotation — forbidden (wrong owner)
      mm.resetAll();
      mm.setGetDocument(async () => makeDocument('doc-other', 'someone-else@x.com'));
      errorResponses.push(await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: authHeaders(),
          params: { docId: 'doc-other' },
        }),
        createMockContext()
      ));

      // jobsGet — job not found
      mm.resetAll();
      mm.setGetJob(async () => null);
      errorResponses.push(await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId: 'nonexistent' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      // docsUploadUrl — wrong content type
      mm.resetAll();
      errorResponses.push(await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'test.txt', contentType: 'text/plain' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      for (const res of errorResponses) {
        const serialized = JSON.stringify(res.jsonBody);
        assert.ok(!serialized.includes('"stack"'),
          'Error response must not contain a "stack" property');
        assert.ok(!serialized.includes('"trace"'),
          'Error response must not contain a "trace" property');
        assert.ok(!/\.(js|ts):\d+/.test(serialized),
          'Error response must not contain file paths like .js:123 or .ts:45');
        assert.ok(!/at\s+\w+\s+\(/.test(serialized),
          'Error response must not contain stack trace lines like "at FunctionName ("');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Error responses never leak secrets
  // -------------------------------------------------------------------------
  describe('No secret leaks', () => {
    it('responses never contain secret values from env vars', async () => {
      const secrets = [
        process.env.JWT_SECRET,
        process.env.STORAGE_CONNECTION_STRING,
        process.env.BOOTSTRAP_ADMIN_PASSWORD,
        process.env.STORAGE_ACCOUNT_KEY,
      ];

      const responses = [];

      // authLogin success
      mm.setGetUser(async () => makeUser(ADMIN_EMAIL, VALID_HASH));
      mm.setUpsertUser(mm.spy());
      responses.push(await handlers['auth-login'](
        createMockRequest({ body: { email: ADMIN_EMAIL, password: VALID_PASSWORD } }),
        createMockContext()
      ));

      // authLogin error
      mm.resetAll();
      responses.push(await handlers['auth-login'](
        createMockRequest({ body: { email: 'unknown@x.com', password: 'wrong' } }),
        createMockContext()
      ));

      // docsUploadUrl success
      mm.resetAll();
      mm.setUpsertDocument(mm.spy());
      responses.push(await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'test.pdf', contentType: 'application/pdf' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      // jobsGet 404
      mm.resetAll();
      responses.push(await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId: 'nonexistent' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      for (const res of responses) {
        const serialized = JSON.stringify(res.jsonBody);
        for (const secret of secrets) {
          assert.ok(
            !serialized.includes(secret),
            `Response must not contain secret: ${secret.slice(0, 10)}...`
          );
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Email normalization is consistent
  // -------------------------------------------------------------------------
  describe('Email normalization', () => {
    it('login normalizes email with whitespace and mixed case', async () => {
      const rawEmail = '  ADMIN@Test.REDARM  ';
      const normalizedEmail = 'admin@test.redarm';

      // Set up bootstrap user flow: first two calls return null, third returns user
      const bootstrapHash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, BCRYPT_ROUNDS);
      const bootstrapUser = makeUser(normalizedEmail, bootstrapHash, { role: 'admin' });

      let callCount = 0;
      mm.setGetUser(async () => {
        callCount += 1;
        if (callCount <= 2) return null;
        return bootstrapUser;
      });
      mm.setUpsertUser(mm.spy());

      const res = await handlers['auth-login'](
        createMockRequest({
          body: { email: rawEmail, password: process.env.BOOTSTRAP_ADMIN_PASSWORD },
        }),
        createMockContext()
      );

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      assert.equal(res.jsonBody.user.email, normalizedEmail,
        'Returned user.email must be lowercased and trimmed');

      // Verify the token encodes the normalized email
      const token = res.jsonBody.accessToken;
      assert.ok(token, 'Must return an accessToken');

      // Use the token to make a subsequent authenticated request
      // and verify the identity uses the normalized email
      mm.resetAll();
      const docId = 'doc-norm-test';
      mm.setGetDocument(async () => makeDocument(docId, normalizedEmail));
      mm.setUpsertDocument(mm.spy());

      const saveRes = await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: { authorization: `Bearer ${token}` },
          params: { docId },
        }),
        createMockContext()
      );

      assert.equal(saveRes.status, 200,
        'Subsequent request with token from normalized-email login must succeed');
    });
  });

  // -------------------------------------------------------------------------
  // 5. All success responses have jsonBody as an object
  // -------------------------------------------------------------------------
  describe('Success response shape', () => {
    it('all success responses have jsonBody as a non-null object', async () => {
      // authLogin success
      mm.setGetUser(async () => makeUser(ADMIN_EMAIL, VALID_HASH));
      mm.setUpsertUser(mm.spy());
      const loginRes = await handlers['auth-login'](
        createMockRequest({ body: { email: ADMIN_EMAIL, password: VALID_PASSWORD } }),
        createMockContext()
      );
      assert.equal(loginRes.status, 200);
      assert.equal(typeof loginRes.jsonBody, 'object', 'authLogin jsonBody must be an object');
      assert.notEqual(loginRes.jsonBody, null, 'authLogin jsonBody must not be null');

      // docsUploadUrl success
      mm.resetAll();
      mm.setUpsertDocument(mm.spy());
      const uploadRes = await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'test.pdf', contentType: 'application/pdf' },
          headers: authHeaders(),
        }),
        createMockContext()
      );
      assert.equal(uploadRes.status, 200);
      assert.equal(typeof uploadRes.jsonBody, 'object', 'docsUploadUrl jsonBody must be an object');
      assert.notEqual(uploadRes.jsonBody, null, 'docsUploadUrl jsonBody must not be null');

      // docsSaveAnnotation success
      mm.resetAll();
      const docId = 'doc-shape-test';
      mm.setGetDocument(async () => makeDocument(docId, ADMIN_EMAIL));
      mm.setUpsertDocument(mm.spy());
      const saveRes = await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: authHeaders(),
          params: { docId },
        }),
        createMockContext()
      );
      assert.equal(saveRes.status, 200);
      assert.equal(typeof saveRes.jsonBody, 'object', 'docsSaveAnnotation jsonBody must be an object');
      assert.notEqual(saveRes.jsonBody, null, 'docsSaveAnnotation jsonBody must not be null');

      // jobsGet success
      mm.resetAll();
      const jobId = 'job-shape-test';
      mm.setGetJob(async () => makeJob(jobId, ADMIN_EMAIL));
      const jobRes = await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId },
          headers: authHeaders(),
        }),
        createMockContext()
      );
      assert.equal(jobRes.status, 200);
      assert.equal(typeof jobRes.jsonBody, 'object', 'jobsGet jsonBody must be an object');
      assert.notEqual(jobRes.jsonBody, null, 'jobsGet jsonBody must not be null');
    });
  });

  // -------------------------------------------------------------------------
  // 6. All error responses follow the standard shape
  // -------------------------------------------------------------------------
  describe('Error response shape', () => {
    it('all error responses have error.code (string) and error.message (string)', async () => {
      const errorResponses = [];

      // authLogin — validation error
      errorResponses.push(await handlers['auth-login'](
        createMockRequest({ body: {} }),
        createMockContext()
      ));

      // authLogin — invalid credentials
      mm.setGetUser(async () => null);
      errorResponses.push(await handlers['auth-login'](
        createMockRequest({ body: { email: 'nobody@x.com', password: 'wrong' } }),
        createMockContext()
      ));

      // docsSaveAnnotation — missing docId
      mm.resetAll();
      errorResponses.push(await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [] },
          headers: authHeaders(),
          params: {},
        }),
        createMockContext()
      ));

      // docsSaveAnnotation — document not found
      mm.resetAll();
      mm.setGetDocument(async () => null);
      errorResponses.push(await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: authHeaders(),
          params: { docId: 'nonexistent' },
        }),
        createMockContext()
      ));

      // jobsGet — job not found
      mm.resetAll();
      mm.setGetJob(async () => null);
      errorResponses.push(await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId: 'nonexistent' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      // docsUploadUrl — wrong content type
      mm.resetAll();
      errorResponses.push(await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'test.txt', contentType: 'text/plain' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      const allowedErrorKeys = new Set(['code', 'message', 'details']);

      for (const res of errorResponses) {
        assert.ok(res.status >= 400, `Expected error status >= 400, got ${res.status}`);
        assert.ok(res.jsonBody.error, 'Error response must have an error property');

        const err = res.jsonBody.error;
        assert.equal(typeof err.code, 'string', 'error.code must be a string');
        assert.ok(err.code.length > 0, 'error.code must be non-empty');
        assert.equal(typeof err.message, 'string', 'error.message must be a string');
        assert.ok(err.message.length > 0, 'error.message must be non-empty');

        // Verify no unexpected keys beyond code, message, and optional details
        const keys = Object.keys(err);
        for (const key of keys) {
          assert.ok(allowedErrorKeys.has(key),
            `Unexpected key "${key}" in error object (allowed: ${[...allowedErrorKeys].join(', ')})`);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7. UUID format in responses
  // -------------------------------------------------------------------------
  describe('UUID format', () => {
    it('docId from docsUploadUrl is a valid UUID v4', async () => {
      mm.setUpsertDocument(mm.spy());
      const res = await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'uuid-test.pdf', contentType: 'application/pdf' },
          headers: authHeaders(),
        }),
        createMockContext()
      );
      assert.equal(res.status, 200);
      assert.ok(res.jsonBody.docId, 'Response must include docId');
      assert.match(res.jsonBody.docId, UUID_V4_RE,
        `docId "${res.jsonBody.docId}" must be a valid UUID v4`);
    });

    it('jobId from docsExportStart is a valid UUID v4', async () => {
      const docId = 'doc-uuid-test';
      mm.setGetDocument(async () => makeDocument(docId, ADMIN_EMAIL));
      mm.setCreateJob(mm.spy());
      mm.setSendQueueMessage(mm.spy());

      const res = await handlers['docs-export-start'](
        createMockRequest({
          body: { format: 'pdf' },
          headers: authHeaders(),
          params: { docId },
        }),
        createMockContext()
      );
      assert.equal(res.status, 202);
      assert.ok(res.jsonBody.jobId, 'Response must include jobId');
      assert.match(res.jsonBody.jobId, UUID_V4_RE,
        `jobId "${res.jsonBody.jobId}" must be a valid UUID v4`);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Config module does not expose raw secrets in responses
  // -------------------------------------------------------------------------
  describe('Config secrets not exposed', () => {
    it('no response body contains substrings from JWT_SECRET or STORAGE_CONNECTION_STRING', async () => {
      const sensitiveValues = [
        process.env.JWT_SECRET,
        process.env.STORAGE_CONNECTION_STRING,
      ];

      const responses = [];

      // authLogin success
      mm.setGetUser(async () => makeUser(ADMIN_EMAIL, VALID_HASH));
      mm.setUpsertUser(mm.spy());
      responses.push(await handlers['auth-login'](
        createMockRequest({ body: { email: ADMIN_EMAIL, password: VALID_PASSWORD } }),
        createMockContext()
      ));

      // docsUploadUrl success
      mm.resetAll();
      mm.setUpsertDocument(mm.spy());
      responses.push(await handlers['docs-upload-url'](
        createMockRequest({
          body: { fileName: 'config-test.pdf', contentType: 'application/pdf' },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      // docsSaveAnnotation success
      mm.resetAll();
      const docId = 'doc-config-test';
      mm.setGetDocument(async () => makeDocument(docId, ADMIN_EMAIL));
      mm.setUpsertDocument(mm.spy());
      responses.push(await handlers['docs-save-annotation'](
        createMockRequest({
          body: { operations: [{ type: 'highlight' }] },
          headers: authHeaders(),
          params: { docId },
        }),
        createMockContext()
      ));

      // jobsGet success
      mm.resetAll();
      const jobId = 'job-config-test';
      mm.setGetJob(async () => makeJob(jobId, ADMIN_EMAIL));
      responses.push(await handlers['jobs-get'](
        createMockRequest({
          method: 'GET',
          params: { jobId },
          headers: authHeaders(),
        }),
        createMockContext()
      ));

      // docsExportStart success
      mm.resetAll();
      const exportDocId = 'doc-config-export';
      mm.setGetDocument(async () => makeDocument(exportDocId, ADMIN_EMAIL));
      mm.setCreateJob(mm.spy());
      mm.setSendQueueMessage(mm.spy());
      responses.push(await handlers['docs-export-start'](
        createMockRequest({
          body: { format: 'pdf' },
          headers: authHeaders(),
          params: { docId: exportDocId },
        }),
        createMockContext()
      ));

      for (const res of responses) {
        const serialized = JSON.stringify(res.jsonBody);
        for (const secret of sensitiveValues) {
          assert.ok(
            !serialized.includes(secret),
            `Response body must not contain secret value starting with "${secret.slice(0, 15)}..."`
          );
        }
      }
    });
  });
});
