// backend/test/functions/docsExportStart.test.js
//
// Tests for POST /api/docs/{docId}/export  (docs-export-start handler)
//
// Handler flow:
//   1. requireAuth  — returns 401 if no/bad bearer token
//   2. getDocument(docId) — returns 404 if document not found
//   3. ownerEmail check — returns 403 if caller does not own the document
//   4. Parse request body for { format } (default "pdf")
//   5. Only "pdf" format allowed — returns 400 otherwise
//   6. createJob({ type:"export", status:"queued", ... })
//   7. sendQueueMessage(config.exportQueue, { jobId, docId, ... })
//   8. Returns 202 { jobId }
//
// Mocking strategy
// ----------------
// The handler destructures at load time:
//   const { getDocument, createJob, isoNow } = require("../lib/tables");
//   const { sendQueueMessage }               = require("../lib/storage");
//
// Because the references are captured at load time, monkey-patching the module
// exports after the fact has no effect on the handler's closed-over locals.
//
// Instead we use module-mocks.js which injects thin-wrapper fakes into
// require.cache BEFORE the handler source is first loaded.  The wrappers
// delegate to replaceable inner implementations (_getDocument, _createJob,
// _sendQueueMessage) so each test can reconfigure behaviour via the mm.set*
// API without ever reloading any module.
//
// CRITICAL require order:
//   1. require('../_helpers/setup')                  — env vars
//   2. const mm = require('../_helpers/module-mocks') — cache injection FIRST
//   3. other test helpers
//   4. handler capture + require handler source

// 1. Environment variables — MUST be first
require('../_helpers/setup');

// 2. Module-mocks — MUST be before the handler is required
const mm = require('../_helpers/module-mocks');

// 3. Other test helpers
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const {
  createMockRequest,
  createBadJsonRequest,
  createAuthHeaders,
} = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// 4. Capture the handler by intercepting app.http BEFORE loading the source
// ---------------------------------------------------------------------------
let capturedHandler;

const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => {
  if (name === 'docs-export-start') capturedHandler = opts.handler;
};

// Clear the handler's own cache entry so it re-requires and picks up the
// module-mocks fakes for tables/storage.
const backendSrc  = path.resolve(__dirname, '../../src');
const HANDLER_PATH = require.resolve(path.join(backendSrc, 'functions/docsExportStart'));
delete require.cache[HANDLER_PATH];
require('../../src/functions/docsExportStart');

app.http = origHttp;

assert.ok(capturedHandler, 'docsExportStart handler was not captured — check the registered name');

// ---------------------------------------------------------------------------
// Config (for the expected queue name)
// ---------------------------------------------------------------------------
const { config } = require('../../src/lib/config');

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const TEST_EMAIL  = 'doctor@test.redarm';
const OTHER_EMAIL = 'other@test.redarm';
const TEST_DOC_ID = 'doc-abc-123';

function makeDoc(ownerEmail = TEST_EMAIL) {
  return {
    partitionKey: 'DOC',
    rowKey:       TEST_DOC_ID,
    docId:        TEST_DOC_ID,
    ownerEmail,
    filename:     'sample.pdf',
    status:       'ready',
  };
}

function authHeaders(email = TEST_EMAIL) {
  return createAuthHeaders(email);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('docsExportStart — POST /api/docs/{docId}/export', () => {

  afterEach(() => {
    mm.resetAll();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication guard
  // -------------------------------------------------------------------------
  describe('Authentication', () => {
    it('returns 401 when Authorization header is absent', async () => {
      mm.setGetDocument(async () => makeDoc());

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: {},               // no auth header
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 401, 'Expected HTTP 401');
      assert.equal(res.jsonBody.error.code, 'unauthorized');
    });

    it('returns 401 when bearer token is invalid or tampered', async () => {
      mm.setGetDocument(async () => makeDoc());

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 401);
      assert.equal(res.jsonBody.error.code, 'unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Document lookup
  // -------------------------------------------------------------------------
  describe('Document lookup', () => {
    it('returns 404 when document does not exist', async () => {
      const getDocSpy  = mm.spy(async () => null);
      const createJobSpy = mm.spy(async () => {});
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(getDocSpy);
      mm.setCreateJob(createJobSpy);
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: 'nonexistent-doc' },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 404);
      assert.equal(res.jsonBody.error.code, 'not_found');
      // getDocument was called with the correct docId
      assert.equal(getDocSpy.calls.length, 1);
      assert.equal(getDocSpy.calls[0][0], 'nonexistent-doc');
      // downstream steps must NOT run
      assert.equal(createJobSpy.calls.length, 0, 'createJob must not be called when document is missing');
      assert.equal(sendQueueSpy.calls.length, 0, 'sendQueueMessage must not be called when document is missing');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Ownership check
  // -------------------------------------------------------------------------
  describe('Ownership check', () => {
    it('returns 403 when authenticated user does not own the document', async () => {
      // Document owned by OTHER_EMAIL, caller authenticated as TEST_EMAIL
      const createJobSpy = mm.spy(async () => {});
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc(OTHER_EMAIL));
      mm.setCreateJob(createJobSpy);
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(TEST_EMAIL),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 403);
      assert.equal(res.jsonBody.error.code, 'forbidden');
      assert.equal(createJobSpy.calls.length, 0, 'createJob must not be called when ownership check fails');
      assert.equal(sendQueueSpy.calls.length, 0, 'sendQueueMessage must not be called when ownership check fails');
    });

    it('returns 403 when document is owned by a completely different user', async () => {
      mm.setGetDocument(async () => makeDoc('completely@different.com'));

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(TEST_EMAIL),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 403);
    });
  });

  // -------------------------------------------------------------------------
  // 4 & 5. Format validation
  // -------------------------------------------------------------------------
  describe('Format validation', () => {
    it('returns 400 when format is "docx" (unsupported)', async () => {
      const createJobSpy = mm.spy(async () => {});
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(createJobSpy);
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'docx' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 400);
      assert.equal(res.jsonBody.error.code, 'validation_error');
      assert.match(res.jsonBody.error.message, /pdf/i, 'Error message should mention "pdf"');
      assert.equal(createJobSpy.calls.length, 0, 'createJob must not be called for invalid format');
      assert.equal(sendQueueSpy.calls.length, 0, 'sendQueueMessage must not be called for invalid format');
    });

    it('returns 400 when format is "png" (unsupported)', async () => {
      mm.setGetDocument(async () => makeDoc());

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'png' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 400);
      assert.equal(res.jsonBody.error.code, 'validation_error');
    });

    it('defaults format to "pdf" when body.json() throws (invalid or empty body)', async () => {
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(sendQueueSpy);

      // createBadJsonRequest simulates a request whose .json() throws SyntaxError
      const req = createBadJsonRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
      });

      const res = await capturedHandler(req);

      // Handler catches the parse error and defaults to "pdf" — should succeed
      assert.equal(res.status, 202);
      assert.ok(res.jsonBody.jobId, 'Expected jobId in response');
      assert.equal(sendQueueSpy.calls.length, 1);
      assert.equal(
        sendQueueSpy.calls[0][1].requestedFormat,
        'pdf',
        'Default requestedFormat should be "pdf"'
      );
    });

    it('defaults format to "pdf" when body omits the format field', async () => {
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    {},   // format key absent
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 202);
      assert.equal(sendQueueSpy.calls[0][1].requestedFormat, 'pdf');
    });

    it('accepts "PDF" (uppercase) by normalising to lowercase', async () => {
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(async () => {});

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'PDF' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 202);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Success response shape
  // -------------------------------------------------------------------------
  describe('Success response', () => {
    it('returns 202 with a UUID v4 jobId on a valid request', async () => {
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(async () => {});

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 202, 'Expected HTTP 202 Accepted');
      assert.ok(res.jsonBody.jobId, 'Response body must include jobId');
      assert.match(
        res.jsonBody.jobId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'jobId must be a valid UUID v4'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. createJob call assertions
  // -------------------------------------------------------------------------
  describe('Job creation (createJob)', () => {
    it('calls createJob with type "export" and status "queued"', async () => {
      const createJobSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(createJobSpy);
      mm.setSendQueueMessage(async () => {});

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      await capturedHandler(req);

      assert.equal(createJobSpy.calls.length, 1, 'createJob should be called exactly once');
      const job = createJobSpy.calls[0][0];

      assert.equal(job.type,       'export', 'job.type must be "export"');
      assert.equal(job.status,     'queued', 'job.status must be "queued"');
      assert.equal(job.docId,       TEST_DOC_ID);
      assert.equal(job.ownerEmail,  TEST_EMAIL);
      assert.ok(job.jobId,          'job.jobId must be present');
      assert.ok(job.createdAt,      'job.createdAt must be set');
      assert.ok(job.updatedAt,      'job.updatedAt must be set');
      assert.equal(job.attempt, 0,  'job.attempt must start at 0');
    });

    it('jobId stored by createJob matches jobId returned in the response', async () => {
      const createJobSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(createJobSpy);
      mm.setSendQueueMessage(async () => {});

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      const job = createJobSpy.calls[0][0];
      assert.equal(
        res.jsonBody.jobId,
        job.jobId,
        'jobId in response body must match the jobId passed to createJob'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 8. sendQueueMessage call assertions
  // -------------------------------------------------------------------------
  describe('Queue message (sendQueueMessage)', () => {
    it('calls sendQueueMessage exactly once targeting the export queue', async () => {
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      await capturedHandler(req);

      assert.equal(sendQueueSpy.calls.length, 1, 'sendQueueMessage should be called exactly once');
      const queueName = sendQueueSpy.calls[0][0];
      assert.equal(
        queueName,
        config.exportQueue,
        `Queue name must be "${config.exportQueue}" (config.exportQueue)`
      );
    });

    it('sendQueueMessage payload contains all required fields with correct values', async () => {
      const sendQueueSpy = mm.spy(async () => {});
      mm.setGetDocument(async () => makeDoc());
      mm.setCreateJob(async () => {});
      mm.setSendQueueMessage(sendQueueSpy);

      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      const payload = sendQueueSpy.calls[0][1];
      assert.equal(payload.jobId,           res.jsonBody.jobId, 'payload.jobId must match response jobId');
      assert.equal(payload.docId,           TEST_DOC_ID,        'payload.docId must match the request param');
      assert.equal(payload.ownerEmail,      TEST_EMAIL,         'payload.ownerEmail must match the token email');
      assert.equal(payload.requestedFormat, 'pdf',              'payload.requestedFormat must be "pdf"');
      assert.ok(payload.createdAt,                              'payload.createdAt must be present');
    });
  });
});
