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
// Instead, we inject fake module objects directly into require.cache under the
// resolved paths of tables.js and storage.js BEFORE requiring the handler
// source.  The fake objects close over a shared "state" variable so each test
// can configure what the fakes return without reloading any module.

require('../_helpers/setup');

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const Module = require('module');

const {
  createMockRequest,
  createBadJsonRequest,
  createAuthHeaders,
} = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Shared mutable state — each test calls resetState() to configure behaviour
// ---------------------------------------------------------------------------
const state = {
  docToReturn:           undefined,  // null → not found, object → found
  createJobError:        null,       // if set, createJob will throw this
  sendQueueMessageError: null,       // if set, sendQueueMessage will throw this
  // Call-capture arrays
  getDocumentCalls:      [],
  createJobCalls:        [],
  sendQueueMessageCalls: [],
};

// We cannot call makeDoc() here yet because makeDoc() references TEST_DOC_ID
// which is defined below.  resetState() is called inside each test instead.

// ---------------------------------------------------------------------------
// Resolve absolute paths of the modules we need to fake
// ---------------------------------------------------------------------------
const backendSrc = path.resolve(__dirname, '../../src');
const TABLES_PATH  = require.resolve(path.join(backendSrc, 'lib/tables'));
const STORAGE_PATH = require.resolve(path.join(backendSrc, 'lib/storage'));

// ---------------------------------------------------------------------------
// Build fake modules whose functions close over `state`
// ---------------------------------------------------------------------------
function buildFakeTables() {
  return {
    isoNow:         () => new Date().toISOString(),
    getDocument:    async (docId) => {
      state.getDocumentCalls.push({ docId });
      return state.docToReturn;
    },
    createJob:      async (job) => {
      state.createJobCalls.push({ job });
      if (state.createJobError) throw state.createJobError;
    },
    // stubs for everything else tables.js exports
    getUser:        async () => null,
    upsertUser:     async () => {},
    upsertDocument: async () => {},
    getJob:         async () => null,
    updateJob:      async () => {},
    ensureTable:    async () => {},
    getTableClient: () => ({}),
    normalizeEmail: (e) => String(e || '').trim().toLowerCase(),
  };
}

function buildFakeStorage() {
  return {
    sendQueueMessage: async (queueName, payload) => {
      state.sendQueueMessageCalls.push({ queueName, payload });
      if (state.sendQueueMessageError) throw state.sendQueueMessageError;
    },
    ensureContainer:  async () => {},
    buildBlobSasUrl:  () => ({ url: 'http://mock-blob', expiresOn: new Date().toISOString() }),
    uploadJson:       async () => {},
    downloadToBuffer: async () => Buffer.from(''),
    uploadBuffer:     async () => {},
  };
}

// ---------------------------------------------------------------------------
// Inject fakes into require.cache BEFORE requiring the handler
// ---------------------------------------------------------------------------
function makeRequireCacheEntry(resolvedPath, exportsObj) {
  return {
    id:       resolvedPath,
    filename: resolvedPath,
    loaded:   true,
    exports:  exportsObj,
    parent:   null,
    children: [],
    paths:    [],
  };
}

// Remove real modules from cache so our fakes are picked up
delete require.cache[TABLES_PATH];
delete require.cache[STORAGE_PATH];

require.cache[TABLES_PATH]  = makeRequireCacheEntry(TABLES_PATH,  buildFakeTables());
require.cache[STORAGE_PATH] = makeRequireCacheEntry(STORAGE_PATH, buildFakeStorage());

// ---------------------------------------------------------------------------
// Capture the handler by intercepting app.http before loading the source
// ---------------------------------------------------------------------------
let capturedHandler;

const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => {
  if (name === 'docs-export-start') capturedHandler = opts.handler;
};

// Clear the handler's own module from cache so it re-requires (and picks up
// our faked tables/storage) even if it was loaded earlier.
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

function resetState({ doc = makeDoc(), createJobError = null, sendQueueMessageError = null } = {}) {
  state.docToReturn            = doc;
  state.createJobError         = createJobError;
  state.sendQueueMessageError  = sendQueueMessageError;
  state.getDocumentCalls       = [];
  state.createJobCalls         = [];
  state.sendQueueMessageCalls  = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('docsExportStart — POST /api/docs/{docId}/export', () => {

  afterEach(() => {
    // reset state so no test contaminates the next
    resetState();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication guard
  // -------------------------------------------------------------------------
  describe('Authentication', () => {
    it('returns 401 when Authorization header is absent', async () => {
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: {},               // no auth header
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 401, 'Expected HTTP 401');
      assert.equal(res.jsonBody.error.code, 'unauthorized');
      assert.equal(state.getDocumentCalls.length, 0, 'getDocument must not be called without auth');
    });

    it('returns 401 when bearer token is invalid or tampered', async () => {
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 401);
      assert.equal(res.jsonBody.error.code, 'unauthorized');
      assert.equal(state.getDocumentCalls.length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Document lookup
  // -------------------------------------------------------------------------
  describe('Document lookup', () => {
    it('returns 404 when document does not exist', async () => {
      resetState({ doc: null });
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
      assert.equal(state.getDocumentCalls.length, 1);
      assert.equal(state.getDocumentCalls[0].docId, 'nonexistent-doc');
      // downstream steps must NOT run
      assert.equal(state.createJobCalls.length, 0, 'createJob must not be called when document is missing');
      assert.equal(state.sendQueueMessageCalls.length, 0, 'sendQueueMessage must not be called when document is missing');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Ownership check
  // -------------------------------------------------------------------------
  describe('Ownership check', () => {
    it('returns 403 when authenticated user does not own the document', async () => {
      // Document owned by OTHER_EMAIL, caller authenticated as TEST_EMAIL
      resetState({ doc: makeDoc(OTHER_EMAIL) });
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(TEST_EMAIL),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 403);
      assert.equal(res.jsonBody.error.code, 'forbidden');
      assert.equal(state.createJobCalls.length, 0, 'createJob must not be called when ownership check fails');
      assert.equal(state.sendQueueMessageCalls.length, 0, 'sendQueueMessage must not be called when ownership check fails');
    });

    it('returns 403 when document is owned by a completely different user', async () => {
      resetState({ doc: makeDoc('completely@different.com') });
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
      resetState();
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
      assert.equal(state.createJobCalls.length, 0, 'createJob must not be called for invalid format');
      assert.equal(state.sendQueueMessageCalls.length, 0, 'sendQueueMessage must not be called for invalid format');
    });

    it('returns 400 when format is "png" (unsupported)', async () => {
      resetState();
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
      resetState();
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
      assert.equal(
        state.sendQueueMessageCalls[0].payload.requestedFormat,
        'pdf',
        'Default requestedFormat should be "pdf"'
      );
    });

    it('defaults format to "pdf" when body omits the format field', async () => {
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    {},   // format key absent
      });

      const res = await capturedHandler(req);

      assert.equal(res.status, 202);
      assert.equal(state.sendQueueMessageCalls[0].payload.requestedFormat, 'pdf');
    });

    it('accepts "PDF" (uppercase) by normalising to lowercase', async () => {
      resetState();
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
      resetState();
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
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      await capturedHandler(req);

      assert.equal(state.createJobCalls.length, 1, 'createJob should be called exactly once');
      const { job } = state.createJobCalls[0];

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
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      const { job } = state.createJobCalls[0];
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
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      await capturedHandler(req);

      assert.equal(state.sendQueueMessageCalls.length, 1, 'sendQueueMessage should be called exactly once');
      const { queueName } = state.sendQueueMessageCalls[0];
      assert.equal(
        queueName,
        config.exportQueue,
        `Queue name must be "${config.exportQueue}" (config.exportQueue)`
      );
    });

    it('sendQueueMessage payload contains all required fields with correct values', async () => {
      resetState();
      const req = createMockRequest({
        method:  'POST',
        params:  { docId: TEST_DOC_ID },
        headers: authHeaders(),
        body:    { format: 'pdf' },
      });

      const res = await capturedHandler(req);

      const { payload } = state.sendQueueMessageCalls[0];
      assert.equal(payload.jobId,           res.jsonBody.jobId, 'payload.jobId must match response jobId');
      assert.equal(payload.docId,           TEST_DOC_ID,        'payload.docId must match the request param');
      assert.equal(payload.ownerEmail,      TEST_EMAIL,         'payload.ownerEmail must match the token email');
      assert.equal(payload.requestedFormat, 'pdf',              'payload.requestedFormat must be "pdf"');
      assert.ok(payload.createdAt,                              'payload.createdAt must be present');
    });
  });
});
