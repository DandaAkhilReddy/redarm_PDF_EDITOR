require('../_helpers/setup');
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createMockRequest, createAuthHeaders } = require('../_helpers/mocks');

// Capture the handler before the module registers it
let capturedHandler;
const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => { if (name === 'jobs-get') capturedHandler = opts.handler; };
require('../../src/functions/jobsGet');
app.http = origHttp;

// Mock tables module so tests never touch real Azure Storage
const tables = require('../../src/lib/tables');

describe('GET /api/jobs/{jobId} — jobsGet handler', () => {
  // Helper: reset the getJob mock before each relevant test
  function mockGetJob(returnValue) {
    mock.method(tables, 'getJob', async () => returnValue);
  }

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

  it('returns 404 when the job does not exist', async () => {
    mockGetJob(null);

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'nonexistent-job' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 404);
    assert.equal(res.jsonBody.error.code, 'not_found');
  });

  it('returns 403 when the authenticated user does not own the job', async () => {
    mockGetJob({
      jobId: 'job-002',
      ownerEmail: 'other@test.redarm',
      status: 'completed',
      type: 'export',
      resultUri: 'https://storage.example.com/result.pdf',
      error: null,
      updatedAt: '2026-02-18T10:00:00.000Z'
    });

    const req = createMockRequest({
      method: 'GET',
      params: { jobId: 'job-002' },
      headers: createAuthHeaders('user@test.redarm', 'user')
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 403);
    assert.equal(res.jsonBody.error.code, 'forbidden');
  });

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
    mockGetJob(jobData);

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
    mockGetJob({
      jobId: 'job-004',
      ownerEmail: 'user@test.redarm',
      status: 'queued',
      type: 'ocr',
      resultUri: undefined,
      error: null,
      updatedAt: '2026-02-18T13:00:00.000Z'
    });

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
    mockGetJob({
      jobId: 'job-005',
      ownerEmail: 'admin@test.redarm',
      status: 'failed',
      type: 'export',
      resultUri: null,
      error: 'PDF rendering timeout exceeded',
      updatedAt: '2026-02-18T14:00:00.000Z'
    });

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

  it('defaults status to "unknown" when the job row has no status field', async () => {
    mockGetJob({
      jobId: 'job-006',
      ownerEmail: 'user@test.redarm',
      // status intentionally omitted
      type: 'export',
      resultUri: null,
      error: null,
      updatedAt: '2026-02-18T15:00:00.000Z'
    });

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
    mockGetJob({
      jobId: 'job-007',
      ownerEmail: 'user@test.redarm',
      status: 'queued',
      // type intentionally omitted
      resultUri: null,
      error: null,
      updatedAt: '2026-02-18T15:30:00.000Z'
    });

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
