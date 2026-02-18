// backend/test/functions/docsOcrStart.test.js
// Tests for POST /api/docs/{docId}/ocr  (backend/src/functions/docsOcrStart.js)

require('../_helpers/setup');
const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockRequest, createAuthHeaders } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Capture the handler before the source module registers it with @azure/functions
// ---------------------------------------------------------------------------
let capturedHandler;
const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => {
  if (name === 'docs-ocr-start') capturedHandler = opts.handler;
};
require('../../src/functions/docsOcrStart');
app.http = origHttp;

// ---------------------------------------------------------------------------
// Module references for mocking
// ---------------------------------------------------------------------------
const tables  = require('../../src/lib/tables');
const storage = require('../../src/lib/storage');
const { config } = require('../../src/lib/config');

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------
const OWNER_EMAIL  = 'admin@test.redarm';    // matches BOOTSTRAP_ADMIN_EMAIL in setup.js
const OTHER_EMAIL  = 'other@test.redarm';
const DOC_ID       = 'doc-abc-123';

/** Build a realistic document entity owned by OWNER_EMAIL */
function makeDoc(ownerEmail = OWNER_EMAIL) {
  return { docId: DOC_ID, ownerEmail, fileName: 'test.pdf' };
}

// ---------------------------------------------------------------------------
// Helper: run handler with optional overrides
// ---------------------------------------------------------------------------
async function runHandler({ body = {}, headers, params, docStub = makeDoc() } = {}) {
  // Default to authenticated as the document owner
  const authHeaders = headers ?? createAuthHeaders(OWNER_EMAIL);

  const req = createMockRequest({
    method: 'POST',
    body,
    headers: authHeaders,
    params: params ?? { docId: DOC_ID },
  });

  // Stub tables.getDocument
  const getDocumentStub = mock.method(tables, 'getDocument', async () => docStub);

  // Stub tables.createJob (capture arguments for assertions)
  let capturedJob = null;
  const createJobStub = mock.method(tables, 'createJob', async (job) => {
    capturedJob = job;
  });

  // Stub storage.sendQueueMessage (capture arguments for assertions)
  let capturedQueue = null;
  let capturedPayload = null;
  const sendQueueStub = mock.method(storage, 'sendQueueMessage', async (queueName, payload) => {
    capturedQueue  = queueName;
    capturedPayload = payload;
  });

  const response = await capturedHandler(req);

  return { response, capturedJob, capturedQueue, capturedPayload, getDocumentStub, createJobStub, sendQueueStub };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('docsOcrStart — POST /api/docs/{docId}/ocr', () => {

  afterEach(() => {
    // Restore all mocks after each test so they do not bleed across tests.
    mock.restoreAll();
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  it('returns 401 when no Authorization header is provided', async () => {
    const req = createMockRequest({
      method: 'POST',
      body: {},
      headers: {},                    // no auth
      params: { docId: DOC_ID },
    });

    const response = await capturedHandler(req);

    assert.equal(response.status, 401);
    assert.equal(response.jsonBody.error.code, 'unauthorized');
  });

  it('returns 401 when bearer token is invalid / malformed', async () => {
    const req = createMockRequest({
      method: 'POST',
      body: {},
      headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
      params: { docId: DOC_ID },
    });

    const response = await capturedHandler(req);

    assert.equal(response.status, 401);
    assert.equal(response.jsonBody.error.code, 'unauthorized');
  });

  // -------------------------------------------------------------------------
  // Document existence
  // -------------------------------------------------------------------------
  it('returns 404 when the document does not exist', async () => {
    // getDocument returns null → document not found
    mock.method(tables, 'getDocument', async () => null);

    const req = createMockRequest({
      method: 'POST',
      body: {},
      headers: createAuthHeaders(OWNER_EMAIL),
      params: { docId: 'nonexistent-doc' },
    });

    const response = await capturedHandler(req);

    assert.equal(response.status, 404);
    assert.equal(response.jsonBody.error.code, 'not_found');
  });

  // -------------------------------------------------------------------------
  // Ownership
  // -------------------------------------------------------------------------
  it('returns 403 when the authenticated user does not own the document', async () => {
    // Document belongs to OTHER_EMAIL but the token is for OWNER_EMAIL
    mock.method(tables, 'getDocument', async () => makeDoc(OTHER_EMAIL));

    const req = createMockRequest({
      method: 'POST',
      body: {},
      headers: createAuthHeaders(OWNER_EMAIL),
      params: { docId: DOC_ID },
    });

    const response = await capturedHandler(req);

    assert.equal(response.status, 403);
    assert.equal(response.jsonBody.error.code, 'forbidden');
  });

  // -------------------------------------------------------------------------
  // pages validation — invalid inputs
  // -------------------------------------------------------------------------
  it('returns 400 when pages contains letters', async () => {
    const { response } = await runHandler({ body: { pages: 'abc' } });

    assert.equal(response.status, 400);
    assert.equal(response.jsonBody.error.code, 'validation_error');
  });

  it('returns 400 when pages contains special characters (e.g. semicolons)', async () => {
    const { response } = await runHandler({ body: { pages: '1;2;3' } });

    assert.equal(response.status, 400);
    assert.equal(response.jsonBody.error.code, 'validation_error');
  });

  it('returns 400 when pages contains spaces', async () => {
    const { response } = await runHandler({ body: { pages: '1 2 3' } });

    assert.equal(response.status, 400);
    assert.equal(response.jsonBody.error.code, 'validation_error');
  });

  // -------------------------------------------------------------------------
  // Successful responses (202)
  // -------------------------------------------------------------------------
  it('returns 202 with a jobId when pages is a comma-separated list "1,2,3"', async () => {
    const { response } = await runHandler({ body: { pages: '1,2,3' } });

    assert.equal(response.status, 202);
    assert.ok(response.jsonBody.jobId, 'response must include a jobId');
    assert.match(
      response.jsonBody.jobId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'jobId must be a valid UUID v4'
    );
  });

  it('returns 202 with a jobId when pages is a range "1-5"', async () => {
    const { response } = await runHandler({ body: { pages: '1-5' } });

    assert.equal(response.status, 202);
    assert.ok(response.jsonBody.jobId);
  });

  it('returns 202 with a jobId when no pages field is provided in the body', async () => {
    const { response } = await runHandler({ body: {} });

    assert.equal(response.status, 202);
    assert.ok(response.jsonBody.jobId);
  });

  it('returns 202 with a jobId when body is completely absent (bad JSON body)', async () => {
    // Simulate a request whose body throws on .json() — handler should fall back to {}
    const authHeaders = createAuthHeaders(OWNER_EMAIL);
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(tables, 'createJob', async () => {});
    mock.method(storage, 'sendQueueMessage', async () => {});

    const req = {
      method: 'POST',
      headers: { get: (k) => (k === 'authorization' ? authHeaders.authorization : null) },
      params: { docId: DOC_ID },
      query: new URLSearchParams(),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      text: async () => '',
    };

    const response = await capturedHandler(req);

    assert.equal(response.status, 202);
    assert.ok(response.jsonBody.jobId);
  });

  // -------------------------------------------------------------------------
  // createJob arguments
  // -------------------------------------------------------------------------
  it('calls createJob with type "ocr", status "queued", correct docId, ownerEmail and pages', async () => {
    const { capturedJob } = await runHandler({ body: { pages: '2,4' } });

    assert.ok(capturedJob, 'createJob must have been called');
    assert.equal(capturedJob.type,        'ocr');
    assert.equal(capturedJob.status,      'queued');
    assert.equal(capturedJob.docId,       DOC_ID);
    assert.equal(capturedJob.ownerEmail,  OWNER_EMAIL);
    assert.equal(capturedJob.pages,       '2,4');
    assert.ok(capturedJob.jobId,          'job must have a jobId');
    assert.ok(capturedJob.createdAt,      'job must have createdAt');
    assert.ok(capturedJob.updatedAt,      'job must have updatedAt');
    assert.strictEqual(capturedJob.attempt, 0);
  });

  it('pages defaults to empty string in the job record when not supplied', async () => {
    const { capturedJob } = await runHandler({ body: {} });

    assert.ok(capturedJob, 'createJob must have been called');
    assert.strictEqual(capturedJob.pages, '', 'pages should be empty string when not provided');
  });

  // -------------------------------------------------------------------------
  // sendQueueMessage arguments
  // -------------------------------------------------------------------------
  it('sends a queue message to the OCR queue with correct payload', async () => {
    const pages = '3-7';
    const { response, capturedQueue, capturedPayload } = await runHandler({ body: { pages } });

    assert.ok(capturedQueue,   'sendQueueMessage must have been called');
    assert.ok(capturedPayload, 'sendQueueMessage must have received a payload');

    // Verify it targets the configured OCR queue
    assert.equal(capturedQueue, config.ocrQueue);

    // Verify payload fields
    assert.equal(capturedPayload.jobId,      response.jsonBody.jobId, 'queue payload jobId must match response jobId');
    assert.equal(capturedPayload.docId,      DOC_ID);
    assert.equal(capturedPayload.ownerEmail, OWNER_EMAIL);
    assert.equal(capturedPayload.pages,      pages);
    assert.ok(capturedPayload.createdAt,     'queue payload must include createdAt');
  });

  it('queue payload pages defaults to empty string when pages not provided', async () => {
    const { capturedPayload } = await runHandler({ body: {} });

    assert.ok(capturedPayload);
    assert.strictEqual(capturedPayload.pages, '');
  });
});
