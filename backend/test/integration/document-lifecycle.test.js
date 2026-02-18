// backend/test/integration/document-lifecycle.test.js
// Integration tests for the complete document lifecycle:
//   upload -> save annotations -> versioning -> ownership checks
//
// CRITICAL require order:
//  1. setup       - env vars must be in place before any source module loads
//  2. module-mocks - injects mock tables/storage into require.cache BEFORE
//                    the handler modules are loaded (handlers destructure at require-time)
//  3. everything else

// 1. Test environment (env vars)
require('../_helpers/setup');

// 2. module-mocks -- BEFORE any src/ require
const mm = require('../_helpers/module-mocks');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// 3. Other helpers
const {
  createMockRequest,
  createAuthHeaders,
  createMockContext,
} = require('../_helpers/mocks');

const { createToken } = require('../../src/lib/auth');

// ---------------------------------------------------------------------------
// UUID v4 regex
// ---------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Capture both handlers by intercepting app.http before requiring the modules.
// Each handler module calls app.http(name, { handler }) at load time.
// ---------------------------------------------------------------------------
let uploadHandler;
let saveAnnotationHandler;

const { app } = require('@azure/functions');
const origHttp = app.http;

app.http = (name, opts) => {
  if (name === 'docs-upload-url') {
    uploadHandler = opts.handler;
  } else if (name === 'docs-save-annotation') {
    saveAnnotationHandler = opts.handler;
  }
};

// Load both handler modules -- AFTER module-mocks has patched require.cache
require('../../src/functions/docsUploadUrl');
require('../../src/functions/docsSaveAnnotation');

// Restore original app.http
app.http = origHttp;

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const USER_A_EMAIL = 'alice@redarm.test';
const USER_B_EMAIL = 'bob@redarm.test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid upload-url request. */
function makeUploadRequest({ email = USER_A_EMAIL, fileName = 'report.pdf', contentType = 'application/pdf' } = {}) {
  return createMockRequest({
    method: 'POST',
    headers: createAuthHeaders(email, 'user'),
    body: { fileName, contentType },
  });
}

/** Build a valid save-annotation request. */
function makeSaveAnnotationRequest({ email = USER_A_EMAIL, docId, operations = [], extraPayload = {} } = {}) {
  return createMockRequest({
    method: 'POST',
    headers: createAuthHeaders(email, 'user'),
    params: { docId },
    body: { operations, ...extraPayload },
  });
}

/** A minimal document record as stored after upload. */
function makeDocumentRecord({ docId, ownerEmail = USER_A_EMAIL, version = 1, annotationJson = '{}' } = {}) {
  return {
    docId,
    ownerEmail: ownerEmail.toLowerCase(),
    title: 'report.pdf',
    blobPath: `pdf-source/${ownerEmail.toLowerCase()}/${docId}/report.pdf`,
    sourceBlobName: `${ownerEmail.toLowerCase()}/${docId}/report.pdf`,
    contentType: 'application/pdf',
    annotationJson,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Document Lifecycle Integration Tests', () => {

  beforeEach(() => {
    mm.resetAll();
  });

  // -------------------------------------------------------------------------
  // 1. Upload URL -> verify document created
  // -------------------------------------------------------------------------
  it('upload-url returns docId, SAS URLs, and calls upsertDocument with correct metadata', async () => {
    const upsertSpy = mm.spy(async () => {});
    mm.setUpsertDocument(upsertSpy);

    const req = makeUploadRequest({ email: USER_A_EMAIL, fileName: 'thesis.pdf' });
    const res = await uploadHandler(req);

    assert.equal(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.jsonBody)}`);

    // Response must contain docId (UUID), sasUrl, readUrl
    const body = res.jsonBody;
    assert.ok(typeof body.docId === 'string', 'docId should be a string');
    assert.match(body.docId, UUID_REGEX, 'docId should be a valid UUID v4');
    assert.ok(typeof body.sasUrl === 'string' && body.sasUrl.length > 0, 'sasUrl should be a non-empty string');
    assert.ok(typeof body.readUrl === 'string' && body.readUrl.length > 0, 'readUrl should be a non-empty string');
    assert.ok(typeof body.blobPath === 'string' && body.blobPath.length > 0, 'blobPath should be a non-empty string');

    // upsertDocument must have been called exactly once
    assert.equal(upsertSpy.calls.length, 1, 'upsertDocument should be called exactly once');

    const entity = upsertSpy.calls[0][0];
    assert.equal(entity.docId, body.docId, 'upserted docId should match response docId');
    assert.equal(entity.ownerEmail, USER_A_EMAIL.toLowerCase(), 'ownerEmail should match authenticated user');
    assert.equal(entity.title, 'thesis.pdf', 'title should be the sanitized fileName');
    assert.equal(entity.contentType, 'application/pdf', 'contentType should be application/pdf');
    assert.equal(entity.annotationJson, '{}', 'annotationJson should default to "{}"');
    assert.equal(entity.version, 1, 'initial version should be 1');
    assert.ok(typeof entity.createdAt === 'string', 'createdAt should be set');
    assert.ok(typeof entity.updatedAt === 'string', 'updatedAt should be set');
  });

  // -------------------------------------------------------------------------
  // 2. Upload -> Save annotation (end-to-end flow)
  // -------------------------------------------------------------------------
  it('upload document then save annotation on the same docId succeeds', async () => {
    // Phase 1: Upload -- capture the docId created by the upload handler
    let capturedDocId;
    const upsertSpy = mm.spy(async (entity) => {
      if (entity.version === 1) {
        capturedDocId = entity.docId;
      }
    });
    mm.setUpsertDocument(upsertSpy);

    const uploadReq = makeUploadRequest({ email: USER_A_EMAIL });
    const uploadRes = await uploadHandler(uploadReq);

    assert.equal(uploadRes.status, 200);
    const docId = uploadRes.jsonBody.docId;
    assert.ok(docId, 'upload must return a docId');
    assert.equal(capturedDocId, docId, 'upsertDocument must receive the same docId');

    // Phase 2: Save annotation -- wire up getDocument to return the uploaded doc
    mm.setGetDocument(async (requestedDocId) => {
      if (requestedDocId === docId) {
        return makeDocumentRecord({ docId, ownerEmail: USER_A_EMAIL, version: 1 });
      }
      return null;
    });

    // Reset the upsert spy for the annotation save
    const annotationUpsertSpy = mm.spy(async () => {});
    mm.setUpsertDocument(annotationUpsertSpy);

    const saveReq = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId,
      operations: [{ type: 'highlight', page: 1, rect: { x: 10, y: 20, w: 100, h: 30 } }],
    });
    const saveRes = await saveAnnotationHandler(saveReq);

    assert.equal(saveRes.status, 200, `Expected 200 but got ${saveRes.status}: ${JSON.stringify(saveRes.jsonBody)}`);
    assert.equal(saveRes.jsonBody.ok, true);
    assert.equal(saveRes.jsonBody.versionId, 'v2', 'version should increment from 1 to 2');

    // Verify annotation was persisted
    assert.equal(annotationUpsertSpy.calls.length, 1, 'upsertDocument should be called once for save');
    const savedEntity = annotationUpsertSpy.calls[0][0];
    assert.equal(savedEntity.docId, docId, 'saved annotation should reference the correct docId');
    assert.equal(savedEntity.version, 2, 'saved version should be 2');
  });

  // -------------------------------------------------------------------------
  // 3. Annotation versioning (sequential saves increment correctly)
  // -------------------------------------------------------------------------
  it('sequential annotation saves increment version: 1->2, then 2->3', async () => {
    const docId = 'versioning-test-doc';
    let currentVersion = 1;

    // getDocument returns the current version dynamically
    mm.setGetDocument(async (requestedDocId) => {
      if (requestedDocId === docId) {
        return makeDocumentRecord({ docId, ownerEmail: USER_A_EMAIL, version: currentVersion });
      }
      return null;
    });

    // upsertDocument updates our in-memory version tracker
    mm.setUpsertDocument(async (entity) => {
      if (entity.version) {
        currentVersion = entity.version;
      }
    });

    // First save: version 1 -> 2
    const req1 = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId,
      operations: [{ type: 'highlight', page: 1 }],
    });
    const res1 = await saveAnnotationHandler(req1);

    assert.equal(res1.status, 200);
    assert.equal(res1.jsonBody.versionId, 'v2', 'first save should produce version v2');
    assert.equal(currentVersion, 2, 'in-memory version should now be 2');

    // Second save: version 2 -> 3
    const req2 = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId,
      operations: [{ type: 'underline', page: 2 }],
    });
    const res2 = await saveAnnotationHandler(req2);

    assert.equal(res2.status, 200);
    assert.equal(res2.jsonBody.versionId, 'v3', 'second save should produce version v3');
    assert.equal(currentVersion, 3, 'in-memory version should now be 3');
  });

  // -------------------------------------------------------------------------
  // 4. Document ownership enforcement
  // -------------------------------------------------------------------------
  it('user B cannot save annotations on user A document (403)', async () => {
    const docId = 'ownership-test-doc';

    // Document is owned by User A
    mm.setGetDocument(async (requestedDocId) => {
      if (requestedDocId === docId) {
        return makeDocumentRecord({ docId, ownerEmail: USER_A_EMAIL, version: 1 });
      }
      return null;
    });

    const upsertSpy = mm.spy(async () => {});
    mm.setUpsertDocument(upsertSpy);

    // User B tries to annotate User A's document
    const req = makeSaveAnnotationRequest({
      email: USER_B_EMAIL,
      docId,
      operations: [{ type: 'highlight', page: 1 }],
    });
    const res = await saveAnnotationHandler(req);

    assert.equal(res.status, 403, 'should return 403 for non-owner');
    assert.equal(res.jsonBody.error.code, 'forbidden');
    assert.equal(upsertSpy.calls.length, 0, 'upsertDocument should NOT be called for forbidden access');
  });

  // -------------------------------------------------------------------------
  // 5. Save annotation with various operation types
  // -------------------------------------------------------------------------
  it('saves annotations with diverse operation types and verifies full payload is stored', async () => {
    const docId = 'diverse-ops-doc';
    const operations = [
      { type: 'highlight', page: 1, color: '#ffff00', rect: { x: 10, y: 20, w: 200, h: 15 } },
      { type: 'underline', page: 1, color: '#0000ff', rect: { x: 10, y: 50, w: 200, h: 2 } },
      { type: 'text', page: 2, content: 'Important note', position: { x: 50, y: 100 } },
      { type: 'strikethrough', page: 3, rect: { x: 0, y: 0, w: 300, h: 12 } },
      { type: 'freehand', page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], strokeWidth: 2 },
    ];

    mm.setGetDocument(async (requestedDocId) => {
      if (requestedDocId === docId) {
        return makeDocumentRecord({ docId, ownerEmail: USER_A_EMAIL, version: 1 });
      }
      return null;
    });

    let storedEntity;
    mm.setUpsertDocument(async (entity) => {
      storedEntity = entity;
    });

    const req = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId,
      operations,
    });
    const res = await saveAnnotationHandler(req);

    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.ok, true);

    // Verify the full payload is stored as JSON
    assert.ok(storedEntity, 'upsertDocument should have been called');
    const parsed = JSON.parse(storedEntity.annotationJson);
    assert.ok(Array.isArray(parsed.operations), 'stored payload should have operations array');
    assert.equal(parsed.operations.length, 5, 'all 5 operations should be stored');

    // Verify each operation type is present
    const storedTypes = parsed.operations.map((op) => op.type);
    assert.ok(storedTypes.includes('highlight'), 'should include highlight');
    assert.ok(storedTypes.includes('underline'), 'should include underline');
    assert.ok(storedTypes.includes('text'), 'should include text');
    assert.ok(storedTypes.includes('strikethrough'), 'should include strikethrough');
    assert.ok(storedTypes.includes('freehand'), 'should include freehand');

    // Verify the text operation retains its content
    const textOp = parsed.operations.find((op) => op.type === 'text');
    assert.equal(textOp.content, 'Important note', 'text content should be preserved');
  });

  // -------------------------------------------------------------------------
  // 6. Document not found
  // -------------------------------------------------------------------------
  it('returns 404 when saving annotation for a non-existent docId', async () => {
    // getDocument returns null for everything (default after resetAll)
    mm.setGetDocument(async () => null);

    const req = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId: 'does-not-exist-abc123',
      operations: [{ type: 'highlight', page: 1 }],
    });
    const res = await saveAnnotationHandler(req);

    assert.equal(res.status, 404, 'should return 404 for non-existent document');
    assert.equal(res.jsonBody.error.code, 'not_found');
  });

  // -------------------------------------------------------------------------
  // 7. Upload URL with special characters in fileName
  // -------------------------------------------------------------------------
  it('upload with special characters in fileName produces a sanitized blobPath', async () => {
    mm.setUpsertDocument(async () => {});

    const req = makeUploadRequest({
      email: USER_A_EMAIL,
      fileName: 'my report (final) copy #2 & notes!.pdf',
    });
    const res = await uploadHandler(req);

    assert.equal(res.status, 200);
    const { blobPath } = res.jsonBody;

    // Verify special characters are removed/replaced
    assert.ok(!blobPath.includes(' '), 'blobPath should not contain spaces');
    assert.ok(!blobPath.includes('('), 'blobPath should not contain "("');
    assert.ok(!blobPath.includes(')'), 'blobPath should not contain ")"');
    assert.ok(!blobPath.includes('#'), 'blobPath should not contain "#"');
    assert.ok(!blobPath.includes('&'), 'blobPath should not contain "&"');
    assert.ok(!blobPath.includes('!'), 'blobPath should not contain "!"');

    // The meaningful parts of the filename should survive sanitization
    assert.ok(blobPath.includes('my'), 'blobPath should retain recognizable parts of the original name');
    assert.ok(blobPath.endsWith('.pdf'), 'blobPath should end with .pdf');
  });

  // -------------------------------------------------------------------------
  // 8. Multiple documents for same user
  // -------------------------------------------------------------------------
  it('same user can upload two documents with unique docIds and annotate both independently', async () => {
    // Track all upserted documents
    const upsertedDocs = [];
    mm.setUpsertDocument(async (entity) => {
      upsertedDocs.push(entity);
    });

    // Upload document 1
    const uploadReq1 = makeUploadRequest({ email: USER_A_EMAIL, fileName: 'doc-one.pdf' });
    const uploadRes1 = await uploadHandler(uploadReq1);
    assert.equal(uploadRes1.status, 200);
    const docId1 = uploadRes1.jsonBody.docId;

    // Upload document 2
    const uploadReq2 = makeUploadRequest({ email: USER_A_EMAIL, fileName: 'doc-two.pdf' });
    const uploadRes2 = await uploadHandler(uploadReq2);
    assert.equal(uploadRes2.status, 200);
    const docId2 = uploadRes2.jsonBody.docId;

    // Both docIds should be valid UUIDs and distinct
    assert.match(docId1, UUID_REGEX, 'docId1 should be a valid UUID');
    assert.match(docId2, UUID_REGEX, 'docId2 should be a valid UUID');
    assert.notEqual(docId1, docId2, 'two uploads should produce different docIds');

    // Verify two upserts were made (one per upload)
    assert.equal(upsertedDocs.length, 2, 'should have upserted exactly 2 documents');
    assert.equal(upsertedDocs[0].docId, docId1, 'first upsert should be for docId1');
    assert.equal(upsertedDocs[1].docId, docId2, 'second upsert should be for docId2');

    // Now annotate both documents independently
    // Wire up getDocument to return the correct doc based on docId
    mm.setGetDocument(async (requestedDocId) => {
      if (requestedDocId === docId1) {
        return makeDocumentRecord({ docId: docId1, ownerEmail: USER_A_EMAIL, version: 1 });
      }
      if (requestedDocId === docId2) {
        return makeDocumentRecord({ docId: docId2, ownerEmail: USER_A_EMAIL, version: 1 });
      }
      return null;
    });

    // Reset upsert tracking for annotation phase
    const annotationUpserts = [];
    mm.setUpsertDocument(async (entity) => {
      annotationUpserts.push(entity);
    });

    // Annotate document 1
    const saveReq1 = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId: docId1,
      operations: [{ type: 'highlight', page: 1, note: 'doc1 annotation' }],
    });
    const saveRes1 = await saveAnnotationHandler(saveReq1);

    assert.equal(saveRes1.status, 200);
    assert.equal(saveRes1.jsonBody.ok, true);
    assert.equal(saveRes1.jsonBody.versionId, 'v2');

    // Annotate document 2
    const saveReq2 = makeSaveAnnotationRequest({
      email: USER_A_EMAIL,
      docId: docId2,
      operations: [{ type: 'text', page: 3, content: 'doc2 annotation' }],
    });
    const saveRes2 = await saveAnnotationHandler(saveReq2);

    assert.equal(saveRes2.status, 200);
    assert.equal(saveRes2.jsonBody.ok, true);
    assert.equal(saveRes2.jsonBody.versionId, 'v2');

    // Verify both annotations were stored with the correct docIds
    assert.equal(annotationUpserts.length, 2, 'should have upserted annotations for 2 documents');
    assert.equal(annotationUpserts[0].docId, docId1, 'first annotation upsert should be for docId1');
    assert.equal(annotationUpserts[1].docId, docId2, 'second annotation upsert should be for docId2');

    // Verify the payloads are distinct
    const payload1 = JSON.parse(annotationUpserts[0].annotationJson);
    const payload2 = JSON.parse(annotationUpserts[1].annotationJson);
    assert.equal(payload1.operations[0].note, 'doc1 annotation', 'doc1 annotation payload should be correct');
    assert.equal(payload2.operations[0].content, 'doc2 annotation', 'doc2 annotation payload should be correct');
  });
});
