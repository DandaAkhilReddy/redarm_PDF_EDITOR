// backend/test/integration/queue-workers.test.js
//
// Integration tests for the export and OCR worker full pipeline.
// Validates message encoding, job status updates, and storage interactions
// end-to-end across both workers.
//
// CRITICAL REQUIRE ORDER:
//  1. setup     — sets env vars before any source module reads config
//  2. mm        — injects mock tables/storage into require.cache BEFORE handlers
//  3. node:test, helpers
//  4. handler capture — intercept app.storageQueue, then require the handlers

// 1. Env-var setup (must be first)
require('../_helpers/setup');

// 2. Module-level mocks — BEFORE any handler source is loaded
const mm = require('../_helpers/module-mocks');

// 3. Test infrastructure
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockContext } = require('../_helpers/mocks');

// 4. Capture handlers by intercepting app.storageQueue
let exportHandler;
let ocrHandler;

const { app } = require('@azure/functions');
const origQueue = app.storageQueue.bind(app);

app.storageQueue = (name, opts) => {
  if (name === 'export-worker') exportHandler = opts.handler;
  if (name === 'ocr-worker') ocrHandler = opts.handler;
};
require('../../src/functions/exportWorker');
require('../../src/functions/ocrWorker');
app.storageQueue = origQueue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid export task payload. */
function makeExportTask(overrides = {}) {
  return {
    jobId: 'job-int-001',
    docId: 'doc-int-abc',
    ownerEmail: 'user@integration.test',
    attempt: 0,
    ...overrides,
  };
}

/** Build a minimal valid OCR task payload. */
function makeOcrTask(overrides = {}) {
  return {
    jobId: 'job-int-ocr-001',
    docId: 'doc-int-ocr-abc',
    ownerEmail: 'user@integration.test',
    attempt: 0,
    ...overrides,
  };
}

/** Build a minimal valid document entity. */
function makeDoc(overrides = {}) {
  return {
    docId: 'doc-int-abc',
    sourceBlobName: 'user@integration.test/doc-int-abc/source.pdf',
    ownerEmail: 'user@integration.test',
    ...overrides,
  };
}

/** Encode a payload the same way sendQueueMessage does: base64(JSON). */
function encodeAsQueue(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mm.resetAll();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: queue-workers', () => {

  // -----------------------------------------------------------------------
  // 1. Export worker full pipeline
  // -----------------------------------------------------------------------
  it('export worker full pipeline: queued -> running -> completed with correct storage interactions', async () => {
    const statusUpdates = [];
    const downloadSpy = mm.spy(async () => Buffer.from('integration-pdf-bytes'));
    const uploadSpy = mm.spy(async () => {});
    // buildBlobSasUrl is SYNC — mm.spy() wraps in async which breaks it
    const sasCalls = [];
    const sasSpy = (...args) => {
      sasCalls.push(args);
      return {
        url: 'https://storage.test/pdf-export/user@integration.test/doc-int-abc/job-int-001.pdf?sig=mock',
        expiresOn: new Date(Date.now() + 60 * 24 * 60 * 1000).toISOString(),
      };
    };
    sasSpy.calls = sasCalls;

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status, resultUri: patch.resultUri, error: patch.error });
    });
    mm.setGetDocument(async (docId) => {
      assert.equal(docId, 'doc-int-abc', 'getDocument must be called with the correct docId');
      return makeDoc();
    });
    mm.setDownloadToBuffer(downloadSpy);
    mm.setUploadBuffer(uploadSpy);
    mm.setBuildBlobSasUrl(sasSpy);

    const ctx = createMockContext();
    await exportHandler(makeExportTask(), ctx);

    // Verify job status progression: running then completed
    assert.equal(statusUpdates.length, 2, 'updateJob must be called exactly twice (running + completed)');
    assert.equal(statusUpdates[0].status, 'running', 'First update must set status to "running"');
    assert.equal(statusUpdates[0].jobId, 'job-int-001');
    assert.equal(statusUpdates[1].status, 'completed', 'Second update must set status to "completed"');
    assert.equal(statusUpdates[1].jobId, 'job-int-001');
    assert.ok(statusUpdates[1].resultUri, 'Completed job must have a resultUri');
    assert.equal(statusUpdates[1].error, null, 'Completed job must clear the error field');

    // Verify download from source container
    assert.equal(downloadSpy.calls.length, 1, 'downloadToBuffer must be called exactly once');
    assert.equal(downloadSpy.calls[0][0], 'pdf-source', 'Must download from the source container');
    assert.equal(downloadSpy.calls[0][1], 'user@integration.test/doc-int-abc/source.pdf',
      'Must use sourceBlobName from document');

    // Verify upload to export container
    assert.equal(uploadSpy.calls.length, 1, 'uploadBuffer must be called exactly once');
    assert.equal(uploadSpy.calls[0][0], 'pdf-export', 'Must upload to the export container');
    assert.equal(uploadSpy.calls[0][1], 'user@integration.test/doc-int-abc/job-int-001.pdf',
      'Uploaded blob name must follow <ownerEmail>/<docId>/<jobId>.pdf pattern');

    // Verify SAS URL was generated
    assert.equal(sasSpy.calls.length, 1, 'buildBlobSasUrl must be called once');
    assert.equal(sasSpy.calls[0][0], 'pdf-export');
  });

  // -----------------------------------------------------------------------
  // 2. OCR worker graceful failure when Doc Intelligence not configured
  // -----------------------------------------------------------------------
  it('OCR worker gracefully fails when DOCINTEL_ENDPOINT is not configured', async () => {
    // DOCINTEL_ENDPOINT is not set in setup.js, so createDocIntelClient() returns null
    const statusUpdates = [];

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status, error: patch.error });
    });

    const ctx = createMockContext();
    await ocrHandler(makeOcrTask(), ctx);

    // Must go directly to failed, NOT through running
    assert.equal(statusUpdates.length, 1, 'updateJob must be called exactly once');
    assert.equal(statusUpdates[0].status, 'failed', 'Job must be marked as failed');
    assert.equal(statusUpdates[0].error, 'Document Intelligence not configured',
      'Error message must indicate Doc Intelligence is not configured');

    // Verify no "running" status was set
    const runningCalls = statusUpdates.filter(u => u.status === 'running');
    assert.equal(runningCalls.length, 0,
      '"running" status must NOT be set when Doc Intelligence is not configured');
  });

  // -----------------------------------------------------------------------
  // 3. Export worker - JSON string message decoding
  // -----------------------------------------------------------------------
  it('export worker correctly decodes a JSON string message', async () => {
    const statusUpdates = [];

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status });
    });
    mm.setGetDocument(async () => makeDoc());
    mm.setDownloadToBuffer(async () => Buffer.from('pdf-content'));
    mm.setUploadBuffer(async () => {});
    mm.setBuildBlobSasUrl(() => ({
      url: 'https://example.com/export.pdf?sig=test',
      expiresOn: new Date().toISOString(),
    }));

    // Pass message as a JSON string rather than a plain object
    const jsonString = JSON.stringify(makeExportTask());
    const ctx = createMockContext();
    await exportHandler(jsonString, ctx);

    const completedCall = statusUpdates.find(u => u.status === 'completed');
    assert.ok(completedCall, 'Handler must process a JSON string message and reach "completed" status');
    assert.equal(completedCall.jobId, 'job-int-001',
      'Decoded jobId must match the original payload');
  });

  // -----------------------------------------------------------------------
  // 4. Export worker - base64-encoded message
  // -----------------------------------------------------------------------
  it('export worker correctly decodes a base64-encoded JSON message', async () => {
    const statusUpdates = [];

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status });
    });
    mm.setGetDocument(async () => makeDoc());
    mm.setDownloadToBuffer(async () => Buffer.from('pdf-content'));
    mm.setUploadBuffer(async () => {});
    mm.setBuildBlobSasUrl(() => ({
      url: 'https://example.com/export.pdf?sig=test',
      expiresOn: new Date().toISOString(),
    }));

    // Encode as base64 — same encoding used by sendQueueMessage in storage.js
    const base64Message = encodeAsQueue(makeExportTask());
    const ctx = createMockContext();
    await exportHandler(base64Message, ctx);

    const completedCall = statusUpdates.find(u => u.status === 'completed');
    assert.ok(completedCall,
      'Handler must process a base64-encoded JSON message and reach "completed" status');
    assert.equal(completedCall.jobId, 'job-int-001',
      'Decoded jobId must match the original payload');
  });

  // -----------------------------------------------------------------------
  // 5. Export worker - missing document
  // -----------------------------------------------------------------------
  it('export worker marks job as failed when document is not found', async () => {
    const statusUpdates = [];

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status, error: patch.error });
    });
    mm.setGetDocument(async () => null); // document does not exist

    const ctx = createMockContext();
    await assert.rejects(
      () => exportHandler(makeExportTask(), ctx),
      /Document metadata missing/,
    );

    const failedCall = statusUpdates.find(u => u.status === 'failed');
    assert.ok(failedCall, 'updateJob must be called with status "failed"');
    assert.ok(failedCall.error.includes('Document metadata missing'),
      'Error must mention "Document metadata missing"');
  });

  // -----------------------------------------------------------------------
  // 6. Export worker - storage download failure
  // -----------------------------------------------------------------------
  it('export worker marks job as failed when downloadToBuffer throws', async () => {
    const statusUpdates = [];

    mm.setUpdateJob(async (jobId, patch) => {
      statusUpdates.push({ jobId, status: patch.status, error: patch.error });
    });
    mm.setGetDocument(async () => makeDoc());
    mm.setDownloadToBuffer(async () => {
      throw new Error('Blob storage connection timeout');
    });

    const ctx = createMockContext();
    await assert.rejects(
      () => exportHandler(makeExportTask(), ctx),
      /Blob storage connection timeout/,
    );

    // Verify running was set before the failure
    const runningCall = statusUpdates.find(u => u.status === 'running');
    assert.ok(runningCall, 'Job must have been set to "running" before the download attempt');

    // Verify job was marked failed with the error message
    const failedCall = statusUpdates.find(u => u.status === 'failed');
    assert.ok(failedCall, 'updateJob must be called with status "failed"');
    assert.equal(failedCall.error, 'Blob storage connection timeout',
      'Failed job error must contain the thrown error message');
  });

  // -----------------------------------------------------------------------
  // 7. Export worker - correct blob paths and SAS permissions
  // -----------------------------------------------------------------------
  it('export worker uploads to correct blob path and generates read SAS URL', async () => {
    const uploadCalls = [];
    const sasCalls = [];

    mm.setUpdateJob(async () => {});
    mm.setGetDocument(async () => makeDoc());
    mm.setDownloadToBuffer(async () => Buffer.from('pdf-data'));
    mm.setUploadBuffer(async (container, blobName, buffer, contentType) => {
      uploadCalls.push({ container, blobName, contentType });
    });
    mm.setBuildBlobSasUrl((container, blobName, perms, minutes) => {
      sasCalls.push({ container, blobName, perms, minutes });
      return {
        url: `https://storage.test/${container}/${blobName}?sig=mock&perm=${perms}`,
        expiresOn: new Date().toISOString(),
      };
    });

    const ctx = createMockContext();
    await exportHandler(makeExportTask({
      jobId: 'job-path-test',
      docId: 'doc-path-test',
      ownerEmail: 'pathtest@example.com',
    }), ctx);

    // Verify upload blob path follows <ownerEmail>/<docId>/<jobId>.pdf
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].container, 'pdf-export');
    assert.equal(uploadCalls[0].blobName, 'pathtest@example.com/doc-path-test/job-path-test.pdf',
      'Upload blob name must be <ownerEmail>/<docId>/<jobId>.pdf');
    assert.equal(uploadCalls[0].contentType, 'application/pdf');

    // Verify SAS URL is generated with read permissions
    assert.equal(sasCalls.length, 1);
    assert.equal(sasCalls[0].container, 'pdf-export');
    assert.equal(sasCalls[0].blobName, 'pathtest@example.com/doc-path-test/job-path-test.pdf');
    assert.equal(sasCalls[0].perms, 'r', 'SAS permissions must be read-only ("r")');
    assert.ok(sasCalls[0].minutes > 0, 'SAS expiry minutes must be positive');
  });

  // -----------------------------------------------------------------------
  // 8. Worker message encoding consistency: sendQueueMessage -> exportWorker
  // -----------------------------------------------------------------------
  it('message format from docsExportStart can be consumed by export worker', async () => {
    // Step 1: Capture the payload that docsExportStart sends via sendQueueMessage.
    //         The real sendQueueMessage encodes as base64(JSON), so we simulate
    //         that encoding on the captured raw payload.
    let capturedQueuePayload = null;
    const sendQueueSpy = mm.spy(async (queueName, payload) => {
      capturedQueuePayload = payload;
    });

    // Set up mocks for docsExportStart handler
    mm.setGetDocument(async () => ({
      docId: 'doc-consistency',
      ownerEmail: 'admin@test.redarm',
      sourceBlobName: 'admin@test.redarm/doc-consistency/source.pdf',
      filename: 'test.pdf',
      status: 'ready',
    }));
    mm.setCreateJob(async () => {});
    mm.setSendQueueMessage(sendQueueSpy);

    // Capture the docsExportStart HTTP handler
    let exportStartHandler;
    const origHttp = app.http;
    app.http = (name, opts) => {
      if (name === 'docs-export-start') exportStartHandler = opts.handler;
    };

    const path = require('path');
    const EXPORT_START_PATH = require.resolve('../../src/functions/docsExportStart');
    delete require.cache[EXPORT_START_PATH];
    require('../../src/functions/docsExportStart');
    app.http = origHttp;

    assert.ok(exportStartHandler, 'docsExportStart handler must be captured');

    // Invoke docsExportStart to produce a queue message
    const { createMockRequest, createAuthHeaders } = require('../_helpers/mocks');
    const req = createMockRequest({
      method: 'POST',
      params: { docId: 'doc-consistency' },
      headers: createAuthHeaders('admin@test.redarm'),
      body: { format: 'pdf' },
    });

    const res = await exportStartHandler(req);
    assert.equal(res.status, 202, 'docsExportStart must return 202');
    assert.ok(capturedQueuePayload, 'sendQueueMessage must have been called');

    // Step 2: Encode the captured payload the same way the real sendQueueMessage does
    const base64Encoded = Buffer.from(JSON.stringify(capturedQueuePayload), 'utf8').toString('base64');

    // Step 3: Feed the base64-encoded payload to the export worker and verify
    //         it processes successfully
    const workerStatusUpdates = [];
    mm.resetAll(); // Reset mocks for the worker phase

    mm.setUpdateJob(async (jobId, patch) => {
      workerStatusUpdates.push({ jobId, status: patch.status, resultUri: patch.resultUri });
    });
    mm.setGetDocument(async () => ({
      docId: 'doc-consistency',
      sourceBlobName: 'admin@test.redarm/doc-consistency/source.pdf',
    }));
    mm.setDownloadToBuffer(async () => Buffer.from('real-pdf-content'));
    mm.setUploadBuffer(async () => {});
    mm.setBuildBlobSasUrl(() => ({
      url: 'https://storage.test/pdf-export/consistency.pdf?sig=mock',
      expiresOn: new Date().toISOString(),
    }));

    const workerCtx = createMockContext();
    await exportHandler(base64Encoded, workerCtx);

    // Verify the worker successfully processed the message
    const completedCall = workerStatusUpdates.find(u => u.status === 'completed');
    assert.ok(completedCall,
      'Export worker must reach "completed" status when consuming a message from docsExportStart');
    assert.equal(completedCall.jobId, capturedQueuePayload.jobId,
      'Worker must process the same jobId that docsExportStart enqueued');
    assert.ok(completedCall.resultUri, 'Completed job must have a resultUri');
  });

});
