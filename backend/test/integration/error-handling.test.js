// backend/test/integration/error-handling.test.js
// Integration tests: consistent error handling across ALL endpoints.
//
// Verifies that 401, 400, 403, 404, and 423 responses share the same
// canonical shape: { status, jsonBody: { error: { code, message } }, headers }
//
// Mocking strategy — identical to the unit-test pattern:
//   1. setup.js    — env vars (MUST be first)
//   2. module-mocks — injects stubs into require.cache BEFORE handler modules load
//   3. Capture each handler via app.http interception
//   4. Use mm.setGetDocument / mm.setGetJob / mm.setGetUser to control scenarios

// ── 1. Setup env vars (must be first) ────────────────────────────────────────
require('../_helpers/setup');

// ── 2. Module-mocks (MUST come before any src/ require) ──────────────────────
const mm = require('../_helpers/module-mocks');

// ── 3. Test framework + helpers ──────────────────────────────────────────────
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  createMockRequest,
  createBadJsonRequest,
  createMockContext,
  createAuthHeaders,
} = require('../_helpers/mocks');
const { createToken } = require('../../src/lib/auth');
const { config } = require('../../src/lib/config');

// ── 4. Capture ALL handlers by intercepting app.http ─────────────────────────
const handlers = {};
const { app } = require('@azure/functions');
const origHttp = app.http;

app.http = (name, opts) => {
  handlers[name] = opts.handler;
};

// Load every handler module — they each call app.http(name, { handler })
require('../../src/functions/authLogin');
require('../../src/functions/docsUploadUrl');
require('../../src/functions/docsSaveAnnotation');
require('../../src/functions/docsExportStart');
require('../../src/functions/docsOcrStart');
require('../../src/functions/jobsGet');

// Restore the original
app.http = origHttp;

// Alias handlers for readability
const authLogin = handlers['auth-login'];
const docsUploadUrl = handlers['docs-upload-url'];
const docsSaveAnnotation = handlers['docs-save-annotation'];
const docsExportStart = handlers['docs-export-start'];
const docsOcrStart = handlers['docs-ocr-start'];
const jobsGet = handlers['jobs-get'];

// Sanity check — make sure every handler was captured
assert.ok(authLogin, 'auth-login handler was not captured');
assert.ok(docsUploadUrl, 'docs-upload-url handler was not captured');
assert.ok(docsSaveAnnotation, 'docs-save-annotation handler was not captured');
assert.ok(docsExportStart, 'docs-export-start handler was not captured');
assert.ok(docsOcrStart, 'docs-ocr-start handler was not captured');
assert.ok(jobsGet, 'jobs-get handler was not captured');

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Asserts that a response matches the canonical error shape:
 * {
 *   status: <number>,
 *   jsonBody: { error: { code: <string>, message: <string> } },
 *   headers: { "Content-Type": "application/json" }
 * }
 */
function assertErrorShape(res, expectedStatus, expectedCode) {
  assert.equal(res.status, expectedStatus, `Expected status ${expectedStatus}, got ${res.status}`);
  assert.ok(res.jsonBody, 'Response must have a jsonBody');
  assert.ok(res.jsonBody.error, 'jsonBody must contain an error object');
  assert.equal(typeof res.jsonBody.error.code, 'string', 'error.code must be a string');
  assert.equal(typeof res.jsonBody.error.message, 'string', 'error.message must be a string');
  assert.ok(res.jsonBody.error.message.length > 0, 'error.message must be non-empty');
  if (expectedCode) {
    assert.equal(res.jsonBody.error.code, expectedCode, `Expected error code "${expectedCode}", got "${res.jsonBody.error.code}"`);
  }
  assert.ok(res.headers, 'Response must have headers');
  assert.equal(res.headers['Content-Type'], 'application/json', 'Content-Type must be application/json');
}

/** All protected endpoints (everything except auth/login). */
const PROTECTED_ENDPOINTS = [
  { name: 'docsUploadUrl', handler: docsUploadUrl, method: 'POST', params: {} },
  { name: 'docsSaveAnnotation', handler: docsSaveAnnotation, method: 'POST', params: { docId: 'doc-test' } },
  { name: 'docsExportStart', handler: docsExportStart, method: 'POST', params: { docId: 'doc-test' } },
  { name: 'docsOcrStart', handler: docsOcrStart, method: 'POST', params: { docId: 'doc-test' } },
  { name: 'jobsGet', handler: jobsGet, method: 'GET', params: { jobId: 'job-test' } },
];

/** Document-scoped endpoints that check ownership. */
const DOC_ENDPOINTS = [
  { name: 'docsSaveAnnotation', handler: docsSaveAnnotation, method: 'POST', params: { docId: 'doc-test' }, body: { operations: [] } },
  { name: 'docsExportStart', handler: docsExportStart, method: 'POST', params: { docId: 'doc-test' }, body: {} },
  { name: 'docsOcrStart', handler: docsOcrStart, method: 'POST', params: { docId: 'doc-test' }, body: {} },
];

/** Endpoints that parse JSON body and reject invalid JSON with 400. */
const JSON_BODY_ENDPOINTS = [
  { name: 'docsUploadUrl', handler: docsUploadUrl, method: 'POST', params: {} },
  { name: 'docsSaveAnnotation', handler: docsSaveAnnotation, method: 'POST', params: { docId: 'doc-test' } },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Cross-endpoint error handling consistency', () => {

  beforeEach(() => {
    mm.resetAll();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. 401 consistency across all protected endpoints (no auth header)
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 401 with consistent error shape from ALL protected endpoints when Authorization header is missing', async () => {
    for (const ep of PROTECTED_ENDPOINTS) {
      const req = createMockRequest({
        method: ep.method,
        params: ep.params,
        body: ep.method === 'POST' ? { operations: [] } : undefined,
      });
      const res = await ep.handler(req, createMockContext());

      assertErrorShape(res, 401, 'unauthorized');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. 401 with expired token
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 401 when a protected endpoint receives an expired JWT', async () => {
    // Create a token that expired 1 hour ago
    const expiredToken = jwt.sign(
      { sub: 'user@test.redarm', role: 'user' },
      config.jwtSecret,
      {
        expiresIn: '-1h',
        issuer: 'redarm-cheap-backend',
        audience: 'redarm-cheap-ui',
      }
    );

    // Test against each protected endpoint
    for (const ep of PROTECTED_ENDPOINTS) {
      const req = createMockRequest({
        method: ep.method,
        params: ep.params,
        headers: { authorization: `Bearer ${expiredToken}` },
        body: ep.method === 'POST' ? { operations: [] } : undefined,
      });
      const res = await ep.handler(req, createMockContext());

      assertErrorShape(res, 401, 'unauthorized');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. 400 consistency — bad JSON body
  //    docsUploadUrl and docsSaveAnnotation explicitly parse JSON and reject.
  //    docsExportStart and docsOcrStart catch JSON errors and default to {}.
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 400 with invalid_json error from endpoints that strictly parse JSON body', async () => {
    for (const ep of JSON_BODY_ENDPOINTS) {
      const req = createBadJsonRequest({
        method: ep.method,
        headers: createAuthHeaders('user@test.redarm'),
        params: ep.params,
      });
      const res = await ep.handler(req, createMockContext());

      assertErrorShape(res, 400, 'invalid_json');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. 400 consistency — missing required fields
  // ─────────────────────────────────────────────────────────────────────────
  it('authLogin returns 400 when email is missing', async () => {
    const req = createMockRequest({ body: { password: 'secret123' } });
    const res = await authLogin(req, createMockContext());

    assertErrorShape(res, 400, 'validation_error');
  });

  it('authLogin returns 400 when password is missing', async () => {
    const req = createMockRequest({ body: { email: 'user@test.redarm' } });
    const res = await authLogin(req, createMockContext());

    assertErrorShape(res, 400, 'validation_error');
  });

  it('docsSaveAnnotation returns 400 when operations array is missing', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('user@test.redarm'),
      params: { docId: 'doc-test' },
      body: { notOperations: true },
    });
    const res = await docsSaveAnnotation(req, createMockContext());

    assertErrorShape(res, 400, 'validation_error');
  });

  it('docsSaveAnnotation returns 400 when operations is not an array', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('user@test.redarm'),
      params: { docId: 'doc-test' },
      body: { operations: 'not-an-array' },
    });
    const res = await docsSaveAnnotation(req, createMockContext());

    assertErrorShape(res, 400, 'validation_error');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. 403 — document ownership across docsSaveAnnotation, docsExportStart,
  //          docsOcrStart
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 403 with consistent error shape when accessing another user\'s document', async () => {
    // Document owned by someone else
    mm.setGetDocument(async () => ({
      docId: 'doc-test',
      ownerEmail: 'other-owner@test.redarm',
      version: 1,
      annotationJson: '{}',
    }));

    for (const ep of DOC_ENDPOINTS) {
      const req = createMockRequest({
        method: ep.method,
        headers: createAuthHeaders('requester@test.redarm'),
        params: ep.params,
        body: ep.body,
      });
      const res = await ep.handler(req, createMockContext());

      assertErrorShape(res, 403, 'forbidden');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. 404 — missing document across docsSaveAnnotation, docsExportStart,
  //          docsOcrStart
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 404 with consistent error shape when document does not exist', async () => {
    mm.setGetDocument(async () => null);

    for (const ep of DOC_ENDPOINTS) {
      const req = createMockRequest({
        method: ep.method,
        headers: createAuthHeaders('user@test.redarm'),
        params: ep.params,
        body: ep.body,
      });
      const res = await ep.handler(req, createMockContext());

      assertErrorShape(res, 404, 'not_found');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. 404 — missing job
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 404 with correct error shape when job does not exist', async () => {
    mm.setGetJob(async () => null);

    const req = createMockRequest({
      method: 'GET',
      headers: createAuthHeaders('user@test.redarm'),
      params: { jobId: 'nonexistent-job-id' },
    });
    const res = await jobsGet(req, createMockContext());

    assertErrorShape(res, 404, 'not_found');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. 403 — job ownership
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 403 with correct error shape when job is owned by a different user', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-owned-by-other',
      ownerEmail: 'other-user@test.redarm',
      status: 'completed',
      type: 'export',
      resultUri: 'https://storage.example.com/result.pdf',
      error: null,
      updatedAt: '2026-02-18T10:00:00.000Z',
    }));

    const req = createMockRequest({
      method: 'GET',
      headers: createAuthHeaders('requester@test.redarm'),
      params: { jobId: 'job-owned-by-other' },
    });
    const res = await jobsGet(req, createMockContext());

    assertErrorShape(res, 403, 'forbidden');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. 423 — account lockout on authLogin
  // ─────────────────────────────────────────────────────────────────────────
  it('returns 423 with correct error shape when account is locked', async () => {
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    const passwordHash = await bcrypt.hash('SomePassword!', 4);

    mm.setGetUser(async () => ({
      email: 'locked@test.redarm',
      passwordHash,
      role: 'user',
      failedAttempts: 0,
      lockedUntil,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const req = createMockRequest({
      body: { email: 'locked@test.redarm', password: 'SomePassword!' },
    });
    const res = await authLogin(req, createMockContext());

    assertErrorShape(res, 423, 'account_locked');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Error response shape consistency — verify ALL error responses above
  //     share the canonical structure
  // ─────────────────────────────────────────────────────────────────────────
  it('every error response follows the canonical shape: { status, jsonBody.error.{code, message}, headers.Content-Type }', async () => {
    // Collect all error responses from diverse scenarios into one array
    const errorResponses = [];

    // ── 401: no auth header across all protected endpoints ──
    for (const ep of PROTECTED_ENDPOINTS) {
      const req = createMockRequest({
        method: ep.method,
        params: ep.params,
        body: ep.method === 'POST' ? { operations: [] } : undefined,
      });
      errorResponses.push(await ep.handler(req, createMockContext()));
    }

    // ── 400: bad JSON on docsUploadUrl ──
    const badJsonReq = createBadJsonRequest({
      method: 'POST',
      headers: createAuthHeaders('user@test.redarm'),
      params: {},
    });
    errorResponses.push(await docsUploadUrl(badJsonReq, createMockContext()));

    // ── 400: missing fields on authLogin ──
    const missingEmailReq = createMockRequest({ body: { password: 'x' } });
    errorResponses.push(await authLogin(missingEmailReq, createMockContext()));

    // ── 404: document not found ──
    mm.setGetDocument(async () => null);
    const notFoundReq = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('user@test.redarm'),
      params: { docId: 'missing-doc' },
      body: { operations: [] },
    });
    errorResponses.push(await docsSaveAnnotation(notFoundReq, createMockContext()));

    // ── 403: wrong owner ──
    mm.setGetDocument(async () => ({
      docId: 'doc-test',
      ownerEmail: 'someone-else@test.redarm',
      version: 1,
      annotationJson: '{}',
    }));
    const forbiddenReq = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('attacker@test.redarm'),
      params: { docId: 'doc-test' },
      body: {},
    });
    errorResponses.push(await docsExportStart(forbiddenReq, createMockContext()));

    // ── 404: job not found ──
    mm.setGetJob(async () => null);
    const jobNotFoundReq = createMockRequest({
      method: 'GET',
      headers: createAuthHeaders('user@test.redarm'),
      params: { jobId: 'missing-job' },
    });
    errorResponses.push(await jobsGet(jobNotFoundReq, createMockContext()));

    // ── 403: job ownership ──
    mm.setGetJob(async () => ({
      jobId: 'job-other',
      ownerEmail: 'other@test.redarm',
      status: 'queued',
      type: 'ocr',
    }));
    const jobForbiddenReq = createMockRequest({
      method: 'GET',
      headers: createAuthHeaders('intruder@test.redarm'),
      params: { jobId: 'job-other' },
    });
    errorResponses.push(await jobsGet(jobForbiddenReq, createMockContext()));

    // ── 423: account locked ──
    const lockedUntil = new Date(Date.now() + 3600000).toISOString();
    const passwordHash = await bcrypt.hash('pass', 4);
    mm.setGetUser(async () => ({
      email: 'locked@test.redarm',
      passwordHash,
      role: 'user',
      failedAttempts: 0,
      lockedUntil,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const lockedReq = createMockRequest({
      body: { email: 'locked@test.redarm', password: 'pass' },
    });
    errorResponses.push(await authLogin(lockedReq, createMockContext()));

    // ── Assert every collected response has the canonical shape ──
    assert.ok(
      errorResponses.length >= 10,
      `Expected at least 10 error responses to validate, got ${errorResponses.length}`
    );

    for (let i = 0; i < errorResponses.length; i++) {
      const res = errorResponses[i];
      const label = `Error response [${i}] (status=${res.status})`;

      // status must be a number in the 4xx range
      assert.equal(typeof res.status, 'number', `${label}: status must be a number`);
      assert.ok(res.status >= 400 && res.status < 500, `${label}: status must be 4xx, got ${res.status}`);

      // jsonBody.error must exist with code + message strings
      assert.ok(res.jsonBody, `${label}: must have jsonBody`);
      assert.ok(res.jsonBody.error, `${label}: jsonBody must have error`);
      assert.equal(typeof res.jsonBody.error.code, 'string', `${label}: error.code must be a string`);
      assert.ok(res.jsonBody.error.code.length > 0, `${label}: error.code must be non-empty`);
      assert.equal(typeof res.jsonBody.error.message, 'string', `${label}: error.message must be a string`);
      assert.ok(res.jsonBody.error.message.length > 0, `${label}: error.message must be non-empty`);

      // headers must include Content-Type: application/json
      assert.ok(res.headers, `${label}: must have headers`);
      assert.equal(
        res.headers['Content-Type'],
        'application/json',
        `${label}: Content-Type must be application/json`
      );
    }
  });
});
