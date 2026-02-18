// backend/test/functions/docsSaveAnnotation.test.js
// Tests for POST /api/docs/{docId}/save-annotation

// CRITICAL require order:
//  1. setup  — env vars must be in place before any source module loads
//  2. module-mocks — injects mock tables/storage into require.cache BEFORE
//     the handler module is loaded (the handler destructures at require-time)
//  3. everything else

require('../_helpers/setup');
const mm = require('../_helpers/module-mocks');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockRequest, createAuthHeaders, createBadJsonRequest } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Capture the handler by intercepting app.http before requiring the module.
// The module calls app.http("docs-save-annotation", { handler }) at load time.
// ---------------------------------------------------------------------------
let capturedHandler;
const { app } = require('@azure/functions');
const origHttp = app.http;
app.http = (name, opts) => {
  if (name === 'docs-save-annotation') capturedHandler = opts.handler;
};
require('../../src/functions/docsSaveAnnotation');
app.http = origHttp;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a request that has a valid Bearer token and a valid JSON body. */
function makeValidRequest({ docId = 'doc-abc', operations = [], extraPayload = {} } = {}) {
  return createMockRequest({
    method: 'POST',
    headers: createAuthHeaders('owner@test.redarm'),
    params: { docId },
    body: { operations, ...extraPayload }
  });
}

/** A minimal valid document record as returned by tables.getDocument. */
function makeDocument({ ownerEmail = 'owner@test.redarm', version = 1 } = {}) {
  return { ownerEmail, version, annotationJson: '{}' };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('docsSaveAnnotation handler — POST /api/docs/{docId}/save-annotation', () => {

  beforeEach(() => {
    // Reset all mock inner-implementations to their safe defaults before each test
    // so state does not leak between cases.
    mm.resetAll();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication
  // -------------------------------------------------------------------------
  it('returns 401 when no Authorization header is provided', async () => {
    const req = createMockRequest({
      method: 'POST',
      params: { docId: 'doc-abc' },
      body: { operations: [] }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  it('returns 401 when an invalid/expired Bearer token is provided', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
      params: { docId: 'doc-abc' },
      body: { operations: [] }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'unauthorized');
  });

  // -------------------------------------------------------------------------
  // 2. Path parameter validation
  // -------------------------------------------------------------------------
  it('returns 400 when docId param is missing (empty string)', async () => {
    // Azure Functions passes an empty string when the segment is absent.
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: '' },
      body: { operations: [] }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(res.jsonBody.error.message.toLowerCase().includes('docid'));
  });

  // -------------------------------------------------------------------------
  // 3. Body / JSON parsing
  // -------------------------------------------------------------------------
  it('returns 400 when the request body is not valid JSON', async () => {
    const req = createBadJsonRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'invalid_json');
  });

  // -------------------------------------------------------------------------
  // 4. Payload shape validation — validateAnnotationPayload
  // -------------------------------------------------------------------------
  it('returns 400 when payload is null (not an object)', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: null    // createMockRequest treats null as invalid → throws in json()
    });

    // body = null causes request.json() to throw, so we get invalid_json.
    // Verify the handler still returns a 4xx (either 400 invalid_json or
    // 400 validation_error — both are acceptable rejections).
    const res = await capturedHandler(req);

    assert.ok(res.status >= 400 && res.status < 500);
  });

  it('returns 400 when payload is a JSON string instead of an object', async () => {
    // We need request.json() to resolve to a primitive (string), not an object.
    const req = {
      method: 'POST',
      headers: { get: (k) => k === 'authorization' ? `Bearer ${createAuthHeaders('owner@test.redarm').authorization.split(' ')[1]}` : null },
      params: { docId: 'doc-abc' },
      query: new URLSearchParams(),
      json: async () => 'just a string'  // resolves to a non-object primitive
    };

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(res.jsonBody.error.message.includes('object'));
  });

  it('returns 400 when operations field is missing from payload', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: { notOperations: [] }   // operations key absent
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(res.jsonBody.error.message.includes('operations'));
  });

  it('returns 400 when operations is not an array', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: { operations: 'not-an-array' }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(res.jsonBody.error.message.includes('operations'));
  });

  it('returns 400 when operations array exceeds 1000 items', async () => {
    const ops = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: { operations: ops }
    });

    const res = await capturedHandler(req);

    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.ok(res.jsonBody.error.message.toLowerCase().includes('too many'));
  });

  it('accepts exactly 1000 operations without a validation error', async () => {
    // Set up mocks so the handler can proceed past validation.
    mm.setGetDocument(async () => makeDocument());
    mm.setUpsertDocument(async () => {});

    const ops = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: { operations: ops }
    });

    const res = await capturedHandler(req);

    // Should not be a validation error — 200 if doc found, or 404 if not.
    assert.notEqual(res.jsonBody?.error?.code, 'validation_error');
  });

  // -------------------------------------------------------------------------
  // 5. Document lookup
  // -------------------------------------------------------------------------
  it('returns 404 when the document does not exist', async () => {
    mm.setGetDocument(async () => null);

    const req = makeValidRequest({ docId: 'nonexistent-doc' });
    const res = await capturedHandler(req);

    assert.equal(res.status, 404);
    assert.equal(res.jsonBody.error.code, 'not_found');
  });

  // -------------------------------------------------------------------------
  // 6. Ownership check
  // -------------------------------------------------------------------------
  it('returns 403 when authenticated user does not own the document', async () => {
    // Document is owned by a different email.
    mm.setGetDocument(async () => makeDocument({ ownerEmail: 'other@test.redarm' }));

    // The auth token is for owner@test.redarm — mismatch → 403.
    const req = makeValidRequest({ docId: 'doc-abc' });
    const res = await capturedHandler(req);

    assert.equal(res.status, 403);
    assert.equal(res.jsonBody.error.code, 'forbidden');
  });

  it('returns 200 when ownerEmail case differs from authenticated email (normalised)', async () => {
    // ownerEmail stored in mixed case — handler normalises both sides with toLowerCase.
    mm.setGetDocument(async () => makeDocument({ ownerEmail: 'OWNER@TEST.REDARM' }));
    mm.setUpsertDocument(async () => {});

    const req = makeValidRequest({ docId: 'doc-abc' });
    const res = await capturedHandler(req);

    // Normalisation means OWNER@TEST.REDARM → owner@test.redarm === identity.email
    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.ok, true);
  });

  // -------------------------------------------------------------------------
  // 7. Successful save — return shape
  // -------------------------------------------------------------------------
  it('returns 200 with ok:true and a versionId string on successful save', async () => {
    mm.setGetDocument(async () => makeDocument({ version: 1 }));
    mm.setUpsertDocument(async () => {});

    const req = makeValidRequest({ operations: [{ type: 'highlight' }] });
    const res = await capturedHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.ok, true);
    assert.match(res.jsonBody.versionId, /^v\d+$/);
  });

  // -------------------------------------------------------------------------
  // 8. Version increment logic
  // -------------------------------------------------------------------------
  it('increments version from 1 to 2 (versionId = "v2")', async () => {
    mm.setGetDocument(async () => makeDocument({ version: 1 }));
    mm.setUpsertDocument(async () => {});

    const req = makeValidRequest();
    const res = await capturedHandler(req);

    assert.equal(res.jsonBody.versionId, 'v2');
  });

  it('increments version from 5 to 6 (versionId = "v6")', async () => {
    mm.setGetDocument(async () => makeDocument({ version: 5 }));
    mm.setUpsertDocument(async () => {});

    const req = makeValidRequest();
    const res = await capturedHandler(req);

    assert.equal(res.jsonBody.versionId, 'v6');
  });

  it('passes the incremented version number to upsertDocument', async () => {
    let captured;
    mm.setGetDocument(async () => makeDocument({ version: 3 }));
    mm.setUpsertDocument(async (entity) => { captured = entity; });

    const req = makeValidRequest();
    await capturedHandler(req);

    assert.equal(captured.version, 4);
  });

  // -------------------------------------------------------------------------
  // 9. annotationJson stored as stringified payload
  // -------------------------------------------------------------------------
  it('stores annotationJson as the JSON-stringified form of the full payload', async () => {
    const payload = { operations: [{ type: 'rect', page: 2 }], meta: 'test-meta' };
    let upsertArg;
    mm.setGetDocument(async () => makeDocument());
    mm.setUpsertDocument(async (entity) => { upsertArg = entity; });

    const req = createMockRequest({
      method: 'POST',
      headers: createAuthHeaders('owner@test.redarm'),
      params: { docId: 'doc-abc' },
      body: payload
    });
    await capturedHandler(req);

    assert.equal(upsertArg.annotationJson, JSON.stringify(payload));
  });

  it('passes the correct docId to upsertDocument', async () => {
    let upsertArg;
    mm.setGetDocument(async () => makeDocument());
    mm.setUpsertDocument(async (entity) => { upsertArg = entity; });

    const req = makeValidRequest({ docId: 'my-special-doc-id' });
    await capturedHandler(req);

    assert.equal(upsertArg.docId, 'my-special-doc-id');
  });
});
