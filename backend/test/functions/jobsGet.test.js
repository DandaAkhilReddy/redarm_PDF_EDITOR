// backend/test/functions/jobsGet.test.js
//
// Tests for GET /api/jobs/{jobId}  (jobs-get handler)
//
// Handler flow:
//   1. requireAuth    — 401 if no/bad bearer token
//   2. getJob(jobId)  — 404 if job row is not found
//   3. ownerEmail check — 403 if job.ownerEmail != identity.email
//   4. Returns 200 { jobId, status, type, resultUri, error, updatedAt }
//
// Mocking strategy
// ----------------
// The handler destructures tables.js at require-time:
//   const { getJob } = require('../lib/tables');
//
// Monkey-patching the module object after the fact never reaches the handler's
// closed-over local reference.  Instead we use module-mocks.js, which injects
// a thin-wrapper fake into require.cache BEFORE the handler source is loaded.
// The wrappers delegate to replaceable inner functions (_getJob etc.), so each
// test can call mm.setGetJob(fn) to control what the fake returns.

// ── 1. Setup env vars (must be first) ──────────────────────────────────────
require('../_helpers/setup');

// ── 2. Module-mocks (MUST come before any source require) ──────────────────
const mm = require('../_helpers/module-mocks');

// ── 3. Test framework + helpers ────────────────────────────────────────────
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockRequest, createAuthHeaders } = require('../_helpers/mocks');

// ── 4. Capture handler then load source ────────────────────────────────────
let capturedHandler;
const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => { if (name === 'jobs-get') capturedHandler = opts.handler; };
require('../../src/functions/jobsGet');
app.http = origHttp;

assert.ok(capturedHandler, 'jobs-get handler was not captured — check the registered name');

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/jobs/{jobId} — jobsGet handler', () => {

  afterEach(() => {
    mm.resetAll();
  });

  // ── Authentication guard ────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const req = createMockRequest({ method: 'GET', params: { jobId: 'job-001' } });
    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  it('returns 401 when Authorization header has an invalid token', async () => {
    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-001' },
      headers: { authorization: 'Bearer this.is.not.a.valid.jwt' }
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  // ── Job lookup ──────────────────────────────────────────────────────────

  it('returns 404 when the job does not exist', async () => {
    mm.setGetJob(async () => null);

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'nonexistent-job' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 404);
    assert.equal(res.jsonBody.error.code, 'not_found');
  });

  // ── Ownership check ─────────────────────────────────────────────────────

  it('returns 403 when the authenticated user does not own the job', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-002',
      ownerEmail: 'other@test.redarm',
      status: 'completed',
      type: 'export',
      resultUri: 'https://storage.example.com/result.pdf',
      error: null,
      updatedAt: '2026-02-18T10:00:00.000Z'
    }));

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-002' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 403);
    assert.equal(res.jsonBody.error.code, 'forbidden');
  });

  // ── Success responses ───────────────────────────────────────────────────

  it('returns 200 with correct job details for a completed job', async () => {
    const jobData = {
      jobId: 'job-003',
      ownerEmail: 'user@test.redarm',
      status: 'completed',
      type: 'export',
      resultUri: 'https://storage.example.com/exports/job-003.pdf',
      error: null,
      updatedAt: '2026-02-18T12:30:00.000Z'
    };
    mm.setGetJob(async () => jobData);

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-003' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.jobId, 'job-003');
    assert.equal(res.jsonBody.status, 'completed');
    assert.equal(res.jsonBody.type, 'export');
    assert.equal(res.jsonBody.resultUri, 'https://storage.example.com/exports/job-003.pdf');
    assert.equal(res.jsonBody.error, null);
    assert.equal(res.jsonBody.updatedAt, '2026-02-18T12:30:00.000Z');
  });

  it('returns 200 with null resultUri for a queued job', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-004',
      ownerEmail: 'user@test.redarm',
      status: 'queued',
      type: 'ocr',
      resultUri: undefined,
      error: null,
      updatedAt: '2026-02-18T13:00:00.000Z'
    }));

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-004' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.jobId, 'job-004');
    assert.equal(res.jsonBody.status, 'queued');
    assert.equal(res.jsonBody.resultUri, null);
  });

  it('returns 200 with an error field for a failed job', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-005',
      ownerEmail: 'admin@test.redarm',
      status: 'failed',
      type: 'export',
      resultUri: null,
      error: 'PDF rendering timeout exceeded',
      updatedAt: '2026-02-18T14:00:00.000Z'
    }));

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-005' },
      headers: createAuthHeaders('admin@test.redarm', 'admin')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.status, 'failed');
    assert.equal(res.jsonBody.resultUri, null);
    assert.equal(res.jsonBody.error, 'PDF rendering timeout exceeded');
  });

  // ── Default-value edge cases ────────────────────────────────────────────

  it('defaults status to "unknown" when the job row has no status field', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-006',
      ownerEmail: 'user@test.redarm',
      // status intentionally omitted
      type: 'export',
      resultUri: null,
      error: null,
      updatedAt: '2026-02-18T15:00:00.000Z'
    }));

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-006' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.status, 'unknown');
  });

  it('defaults type to empty string when the job row has no type field', async () => {
    mm.setGetJob(async () => ({
      jobId: 'job-007',
      ownerEmail: 'user@test.redarm',
      status: 'queued',
      // type intentionally omitted
      resultUri: null,
      error: null,
      updatedAt: '2026-02-18T15:30:00.000Z'
    }));

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-007' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.type, '');
  });
});
