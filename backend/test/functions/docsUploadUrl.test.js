// backend/test/functions/docsUploadUrl.test.js
// Tests for POST /api/docs/upload-url (docs-upload-url handler)
//
// Mocking strategy
// ----------------
// docsUploadUrl.js uses destructured imports:
//   const { buildBlobSasUrl } = require("../lib/storage");
//   const { upsertDocument, isoNow } = require("../lib/tables");
//
// Because of destructuring, patching the module's exports AFTER the function
// module has been loaded has no effect on the already-captured local bindings.
//
// module-mocks.js injects stub modules into require.cache under the exact
// resolved paths. It MUST be required BEFORE any src/ handler require so that
// when the handler runs its own require() calls it receives our stubs.

// 1. Test environment (env vars)
require('../_helpers/setup');

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// 2. module-mocks — BEFORE any src/ require
const mm = require('../_helpers/module-mocks');

// 3. Other helpers (mocks.js)
const {
  createMockRequest,
  createBadJsonRequest,
  createAuthHeaders,
} = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// UUID v4 regex
// ---------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Helper: build a standard valid request body
// ---------------------------------------------------------------------------
function validBody(overrides = {}) {
  return {
    fileName: 'my-document.pdf',
    contentType: 'application/pdf',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a deterministic SAS stub result
// ---------------------------------------------------------------------------
function stubSas(permissions, expiresInMinutes) {
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  return {
    url: `https://devstoreaccount1.blob.core.windows.net/pdf-source/stub?sp=${permissions}&se=${encodeURIComponent(expiresOn.toISOString())}&sig=FAKE`,
    expiresOn: expiresOn.toISOString(),
  };
}

// 4. Capture the handler by temporarily wrapping app.http.
//    docsUploadUrl.js will now resolve storage / tables to our stubs.
let capturedHandler;
const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => {
  if (name === 'docs-upload-url') {
    capturedHandler = opts.handler;
  }
};

// 5. Load the handler module — AFTER module-mocks has patched require.cache
require('../../src/functions/docsUploadUrl');
app.http = origHttp;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('docsUploadUrl handler — POST /api/docs/upload-url', () => {

  before(() => {
    assert.ok(capturedHandler, 'handler was not captured from app.http registration');
  });

  beforeEach(() => {
    // Reset all mocks to clean defaults, then configure test-specific defaults.
    mm.resetAll();

    // Default SAS stub: returns a deterministic URL based on permissions/TTL.
    mm.setBuildBlobSasUrl((containerName, blobName, permissions, expiresInMinutes) =>
      stubSas(permissions, expiresInMinutes)
    );

    // Default upsertDocument: no-op.
    mm.setUpsertDocument(async (_entity) => {});
  });

  // -------------------------------------------------------------------------
  // 1. Returns 401 when no Authorization header is supplied
  // -------------------------------------------------------------------------
  it('returns 401 when Authorization header is absent', async () => {
    const req = createMockRequest({ body: validBody() });
    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  // -------------------------------------------------------------------------
  // 2. Returns 401 when the bearer token is invalid
  // -------------------------------------------------------------------------
  it('returns 401 when bearer token is invalid', async () => {
    const req = createMockRequest({
      body: validBody(),
      headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  // -------------------------------------------------------------------------
  // 3. Returns 400 when request body is not valid JSON
  // -------------------------------------------------------------------------
  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest({ headers: createAuthHeaders() });
    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'invalid_json');
  });

  // -------------------------------------------------------------------------
  // 4. Returns 400 when contentType is not application/pdf
  // -------------------------------------------------------------------------
  it('returns 400 when contentType is not application/pdf', async () => {
    const req = createMockRequest({
      body: validBody({ contentType: 'image/png' }),
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(
      res.jsonBody.error.message.toLowerCase().includes('pdf'),
      'error message should mention pdf'
    );
  });

  // -------------------------------------------------------------------------
  // 5. Returns 200 for a fully valid authenticated request
  // -------------------------------------------------------------------------
  it('returns 200 for a valid authenticated request', async () => {
    const req = createMockRequest({
      body: validBody(),
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(
      res.status,
      200,
      `Expected 200 but got ${res.status}: ${JSON.stringify(res.jsonBody)}`
    );
  });

  // -------------------------------------------------------------------------
  // 6. Response body contains all required fields with correct shapes
  // -------------------------------------------------------------------------
  it('response body contains docId (UUID), sasUrl, blobPath, readUrl, expiresAt, maxUploadBytes', async () => {
    const req = createMockRequest({
      body: validBody(),
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    const body = res.jsonBody;

    // docId must be a UUID v4
    assert.ok(typeof body.docId === 'string', 'docId should be a string');
    assert.match(body.docId, UUID_REGEX, `docId "${body.docId}" is not a valid UUID v4`);

    // sasUrl (upload) must be a non-empty string
    assert.ok(
      typeof body.sasUrl === 'string' && body.sasUrl.length > 0,
      'sasUrl should be a non-empty string'
    );

    // blobPath must be a non-empty string
    assert.ok(
      typeof body.blobPath === 'string' && body.blobPath.length > 0,
      'blobPath should be a non-empty string'
    );

    // readUrl must be a non-empty string
    assert.ok(
      typeof body.readUrl === 'string' && body.readUrl.length > 0,
      'readUrl should be a non-empty string'
    );

    // expiresAt must be a parseable ISO-8601 date string in the future
    assert.ok(typeof body.expiresAt === 'string', 'expiresAt should be a string');
    const expiresAtDate = new Date(body.expiresAt);
    assert.ok(!Number.isNaN(expiresAtDate.getTime()), 'expiresAt should be a valid date');
    assert.ok(expiresAtDate > new Date(), 'expiresAt should be in the future');

    // maxUploadBytes must be a positive number
    assert.ok(
      typeof body.maxUploadBytes === 'number' && body.maxUploadBytes > 0,
      'maxUploadBytes should be a positive number'
    );
  });

  // -------------------------------------------------------------------------
  // 7. fileName is sanitized in the returned blobPath
  // -------------------------------------------------------------------------
  it('sanitizes fileName containing special characters in blobPath', async () => {
    const req = createMockRequest({
      body: validBody({ fileName: 'my report (final) copy #2.pdf' }),
      headers: createAuthHeaders('user@example.com', 'user'),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    const { blobPath } = res.jsonBody;

    assert.ok(!blobPath.includes(' '), 'blobPath should not contain spaces');
    assert.ok(!blobPath.includes('('), 'blobPath should not contain "("');
    assert.ok(!blobPath.includes(')'), 'blobPath should not contain ")"');
    assert.ok(!blobPath.includes('#'), 'blobPath should not contain "#"');

    // The "my" word should survive sanitization
    assert.ok(blobPath.includes('my'), 'blobPath should retain the "my" prefix from the sanitized name');
  });

  // -------------------------------------------------------------------------
  // 8. Default fileName is "source.pdf" when not provided in body
  // -------------------------------------------------------------------------
  it('defaults fileName to "source.pdf" when not provided', async () => {
    const req = createMockRequest({
      body: { contentType: 'application/pdf' }, // no fileName key
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    const { blobPath } = res.jsonBody;
    assert.ok(
      blobPath.endsWith('source.pdf'),
      `blobPath "${blobPath}" should end with "source.pdf"`
    );
  });

  // -------------------------------------------------------------------------
  // 9. Default contentType works when omitted (defaults to application/pdf)
  // -------------------------------------------------------------------------
  it('accepts request with no contentType field (defaults to application/pdf)', async () => {
    const req = createMockRequest({
      body: { fileName: 'no-content-type.pdf' }, // no contentType key
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200, 'omitting contentType should default to application/pdf and succeed');
  });

  // -------------------------------------------------------------------------
  // 10. upsertDocument is called with the correct metadata structure
  // -------------------------------------------------------------------------
  it('calls upsertDocument with correct metadata', async () => {
    const upsertSpy = mm.spy(async () => {});
    mm.setUpsertDocument(upsertSpy);

    const authEmail = 'uploader@redarm.test';
    const req = createMockRequest({
      body: validBody({ fileName: 'test-doc.pdf' }),
      headers: createAuthHeaders(authEmail, 'user'),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(upsertSpy.calls.length, 1, 'upsertDocument should be called exactly once');

    const entity = upsertSpy.calls[0][0];

    // docId must match what was returned in the response
    assert.equal(entity.docId, res.jsonBody.docId, 'upserted docId should match response docId');
    assert.match(entity.docId, UUID_REGEX, 'upserted docId should be a valid UUID v4');

    // ownerEmail must match the authenticated user's email (lowercased)
    assert.equal(
      entity.ownerEmail,
      authEmail.toLowerCase(),
      'ownerEmail should equal the authenticated email'
    );

    // title should be the sanitized file name
    assert.equal(entity.title, 'test-doc.pdf', 'title should be the sanitized fileName');

    // contentType must be application/pdf
    assert.equal(entity.contentType, 'application/pdf', 'contentType should be application/pdf');

    // blobPath should reference the source container
    assert.ok(
      typeof entity.blobPath === 'string' && entity.blobPath.includes('pdf-source'),
      'blobPath should reference the source container'
    );

    // sourceBlobName must embed the owner email and docId
    assert.ok(
      entity.sourceBlobName.includes(authEmail.toLowerCase()),
      'sourceBlobName should include the owner email'
    );
    assert.ok(
      entity.sourceBlobName.includes(entity.docId),
      'sourceBlobName should include the docId'
    );

    // annotationJson should default to the empty-object sentinel
    assert.equal(entity.annotationJson, '{}', 'annotationJson should default to "{}"');

    // version should be initialised to 1
    assert.equal(entity.version, 1, 'initial version should be 1');

    // createdAt and updatedAt must be valid ISO date strings
    assert.ok(typeof entity.createdAt === 'string', 'createdAt should be a string');
    assert.ok(
      !Number.isNaN(new Date(entity.createdAt).getTime()),
      'createdAt should be a valid ISO date'
    );
    assert.ok(typeof entity.updatedAt === 'string', 'updatedAt should be a string');
    assert.ok(
      !Number.isNaN(new Date(entity.updatedAt).getTime()),
      'updatedAt should be a valid ISO date'
    );
  });

  // -------------------------------------------------------------------------
  // 11. blobPath in response includes the owner email and docId segments
  // -------------------------------------------------------------------------
  it('blobPath in response includes owner email and generated docId', async () => {
    const authEmail = 'owner@example.com';
    const req = createMockRequest({
      body: validBody(),
      headers: createAuthHeaders(authEmail, 'user'),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    const { blobPath, docId } = res.jsonBody;

    assert.ok(
      blobPath.includes(authEmail.toLowerCase()),
      'blobPath should contain the authenticated user email'
    );
    assert.ok(blobPath.includes(docId), 'blobPath should contain the generated docId');
  });

  // -------------------------------------------------------------------------
  // 12. buildBlobSasUrl is called twice with correct permissions and TTLs;
  //     sasUrl and readUrl in the response are distinct strings.
  // -------------------------------------------------------------------------
  it('generates distinct upload and read SAS URLs with correct permissions and TTLs', async () => {
    const sasCalls = [];
    mm.setBuildBlobSasUrl((containerName, blobName, permissions, expiresInMinutes) => {
      sasCalls.push({ containerName, blobName, permissions, expiresInMinutes });
      return stubSas(permissions, expiresInMinutes);
    });

    const req = createMockRequest({
      body: validBody(),
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(sasCalls.length, 2, 'buildBlobSasUrl should be called exactly twice');

    // Upload SAS: permissions "cw", TTL 15 minutes
    const uploadCall = sasCalls.find((c) => c.permissions === 'cw');
    assert.ok(uploadCall, 'should have a "cw" SAS call for the upload URL');
    assert.equal(uploadCall.expiresInMinutes, 15, 'upload SAS TTL should be 15 minutes');

    // Read SAS: permissions "r", TTL 120 minutes
    const readCall = sasCalls.find((c) => c.permissions === 'r');
    assert.ok(readCall, 'should have a "r" SAS call for the read URL');
    assert.equal(readCall.expiresInMinutes, 120, 'read SAS TTL should be 120 minutes');

    // Both calls must target the same blob name
    assert.equal(
      uploadCall.blobName,
      readCall.blobName,
      'upload and read SAS should reference the same blob'
    );

    // sasUrl and readUrl must differ (they carry different permission query params)
    assert.notEqual(res.jsonBody.sasUrl, res.jsonBody.readUrl, 'sasUrl and readUrl should be different');
  });

  // -------------------------------------------------------------------------
  // 13. maxUploadBytes in response matches the configured environment value
  // -------------------------------------------------------------------------
  it('maxUploadBytes in response matches MAX_UPLOAD_BYTES env var', async () => {
    const req = createMockRequest({
      body: validBody(),
      headers: createAuthHeaders(),
    });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    // setup.js sets MAX_UPLOAD_BYTES=10485760 (10 MiB)
    assert.equal(res.jsonBody.maxUploadBytes, 10 * 1024 * 1024);
  });
});
