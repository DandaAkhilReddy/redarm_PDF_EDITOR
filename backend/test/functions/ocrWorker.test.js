// backend/test/functions/ocrWorker.test.js
//
// Tests for the queue-triggered OCR worker (backend/src/functions/ocrWorker.js).
//
// Strategy
// --------
// The worker registers itself via app.storageQueue() at module load time.
// We intercept that call to capture the handler before the real app object
// can process it.
//
// The worker destructures { getDocument, updateJob, isoNow } from tables.js
// and { downloadToBuffer, uploadJson, buildBlobSasUrl } from storage.js at
// require-time, so plain require.cache replacement would freeze those
// references.  module-mocks.js installs thin wrapper functions once; each
// wrapper delegates to a replaceable inner implementation (_getDocument etc.)
// that is swapped per-test via mm.setGetDocument(fn) / mm.setUpdateJob(fn).
// The wrapper reference itself never changes, so the destructured binding in
// the handler always calls through to the current inner implementation.
//
// CRITICAL REQUIRE ORDER
// ----------------------
// 1. require('../_helpers/setup')          — env vars before anything reads config
// 2. const mm = require('../_helpers/module-mocks') — installs cache stubs BEFORE
//    the handler is required (so destructures bind to the wrappers, not real impls)
// 3. Other non-source requires (node:test, assert, mocks helpers)
// 4. Capture handler via app.storageQueue + require('../../src/functions/ocrWorker')
//
// Because DOCINTEL_ENDPOINT and DOCINTEL_KEY are intentionally absent from the
// test environment, createDocIntelClient() returns null for every invocation.
// The majority of tests therefore exercise the "not configured" path or the
// early-return guards that execute before the client is even checked.

require('../_helpers/setup');
const mm = require('../_helpers/module-mocks');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockContext } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Capture the handler by intercepting app.storageQueue
// ---------------------------------------------------------------------------

let capturedHandler;
const { app } = require('@azure/functions');
const origQueue = app.storageQueue;
app.storageQueue = (name, opts) => {
  if (name === 'ocr-worker') capturedHandler = opts.handler;
};
require('../../src/functions/ocrWorker');
app.storageQueue = origQueue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a payload the same way the real queue sender does (base64 JSON),
 * so decodeQueueMessage() inside the worker picks it up correctly.
 */
function encodeMessage(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Convenience: run handler and capture any thrown error.
 * Returns { error } so callers can assert on whether the handler threw.
 */
async function runHandler(message, context) {
  try {
    await capturedHandler(message, context);
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

// ---------------------------------------------------------------------------
// Spy factories — record updateJob calls per-test
// ---------------------------------------------------------------------------

/** Returns [spyFn, getCalls] where getCalls() returns the recorded call list. */
function makeUpdateJobSpy(impl = async () => {}) {
  const calls = [];
  const fn = async (jobId, patch) => {
    calls.push({ jobId, patch });
    return impl(jobId, patch);
  };
  fn.calls = calls;
  return fn;
}

function makeUploadJsonSpy(impl = async () => {}) {
  const calls = [];
  const fn = async (container, blobName, value) => {
    calls.push({ container, blobName, value });
    return impl(container, blobName, value);
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ocrWorker handler', () => {

  beforeEach(() => {
    // Reset all mock inner implementations to their defaults.
    // This ensures tests are fully isolated.
    mm.resetAll();
  });

  // -------------------------------------------------------------------------
  // Handler capture sanity check
  // -------------------------------------------------------------------------

  it('captures the ocr-worker handler', () => {
    assert.ok(capturedHandler, 'capturedHandler should have been set by app.storageQueue interception');
    assert.equal(typeof capturedHandler, 'function');
  });

  // -------------------------------------------------------------------------
  // Early-return guards: missing jobId / docId
  // -------------------------------------------------------------------------

  it('returns early and calls context.error when jobId is missing', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({ docId: 'doc-001' }); // no jobId

    await capturedHandler(msg, ctx);

    // No table mutations must have occurred
    assert.equal(updateJobSpy.calls.length, 0, 'updateJob must not be called for invalid payload');

    // context.error must have been called exactly once
    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.equal(errorLogs.length, 1, 'context.error should be called once');
    assert.ok(
      String(errorLogs[0].args[0]).toLowerCase().includes('invalid'),
      'error message should mention "invalid"'
    );
  });

  it('returns early and calls context.error when docId is missing', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: 'job-001' }); // no docId

    await capturedHandler(msg, ctx);

    assert.equal(updateJobSpy.calls.length, 0, 'updateJob must not be called for invalid payload');

    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.equal(errorLogs.length, 1, 'context.error should be called once');
  });

  it('returns early and calls context.error when both jobId and docId are missing', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({}); // neither field

    await capturedHandler(msg, ctx);

    assert.equal(updateJobSpy.calls.length, 0);
    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.equal(errorLogs.length, 1);
  });

  it('treats jobId of empty string as missing and returns early', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: '', docId: 'doc-001' });

    await capturedHandler(msg, ctx);

    assert.equal(updateJobSpy.calls.length, 0);
    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.equal(errorLogs.length, 1);
  });

  // -------------------------------------------------------------------------
  // "Doc Intelligence not configured" path
  // (DOCINTEL_ENDPOINT and DOCINTEL_KEY are absent from the test env, so
  //  createDocIntelClient() always returns null in this test suite)
  // -------------------------------------------------------------------------

  it('updates job to "failed" with correct error when Doc Intelligence is not configured', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: 'job-002', docId: 'doc-002' });

    await capturedHandler(msg, ctx);

    assert.equal(updateJobSpy.calls.length, 1, 'exactly one updateJob call expected');
    const call = updateJobSpy.calls[0];
    assert.equal(call.jobId, 'job-002');
    assert.equal(call.patch.status, 'failed');
    assert.equal(call.patch.error, 'Document Intelligence not configured');
  });

  it('does NOT call updateJob with "running" when Doc Intelligence is not configured', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: 'job-003', docId: 'doc-003' });

    await capturedHandler(msg, ctx);

    // Only the "failed" update must have fired — there must be no "running" update
    const runningCalls = updateJobSpy.calls.filter(c => c.patch.status === 'running');
    assert.equal(runningCalls.length, 0, '"running" status update should not be issued when client is null');
  });

  it('returns without throwing when Doc Intelligence is not configured', async () => {
    mm.setUpdateJob(async () => {});

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: 'job-004', docId: 'doc-004' });

    // Should resolve, not reject
    await assert.doesNotReject(() => capturedHandler(msg, ctx));
  });

  it('does not log a context.error when Doc Intelligence is not configured (graceful failure)', async () => {
    // The worker silently fails the job without emitting a context.error in
    // the "client is null" branch — that is intentional by design.
    mm.setUpdateJob(async () => {});

    const ctx = createMockContext();
    const msg = encodeMessage({ jobId: 'job-005', docId: 'doc-005' });

    await capturedHandler(msg, ctx);

    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.equal(
      errorLogs.length,
      0,
      'context.error should NOT be called in the "not configured" path'
    );
  });

  // -------------------------------------------------------------------------
  // Message encoding variants (decodeQueueMessage coverage)
  // -------------------------------------------------------------------------

  it('accepts a plain JSON string message (not base64)', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    // Pass raw JSON string — decodeQueueMessage handles this format too
    const msg = JSON.stringify({ jobId: 'job-006', docId: 'doc-006' });

    await capturedHandler(msg, ctx);

    // Should reach the "not configured" path and update job to failed
    assert.equal(updateJobSpy.calls.length, 1);
    assert.equal(updateJobSpy.calls[0].patch.status, 'failed');
    assert.equal(updateJobSpy.calls[0].patch.error, 'Document Intelligence not configured');
  });

  it('accepts a plain object message (Azure Functions v4 passes objects directly)', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const ctx = createMockContext();
    const msg = { jobId: 'job-007', docId: 'doc-007' };

    await capturedHandler(msg, ctx);

    assert.equal(updateJobSpy.calls.length, 1);
    assert.equal(updateJobSpy.calls[0].jobId, 'job-007');
    assert.equal(updateJobSpy.calls[0].patch.status, 'failed');
    assert.equal(updateJobSpy.calls[0].patch.error, 'Document Intelligence not configured');
  });

  // -------------------------------------------------------------------------
  // Configured-path / error-path tests
  //
  // These tests set DOCINTEL_ENDPOINT and DOCINTEL_KEY so that
  // createDocIntelClient() returns a non-null client object, allowing the
  // try block inside the handler to be reached.  We do NOT need to mock
  // @azure/ai-form-recognizer because the errors we simulate (getDocument
  // throwing, downloadToBuffer throwing, doc not found) all occur before
  // beginAnalyzeDocument is ever called.
  //
  // Because config is read once at module-load time, we must delete
  // require.cache for config + ocrWorker, then re-require to pick up the
  // new env vars, capturing a fresh handler.  We restore everything in a
  // finally block.
  //
  // Using mm.set*() to control behavior means the fresh handler's
  // destructured bindings still point at the module-mocks wrappers — so
  // mm.setGetDocument(fn) works correctly even for the re-required handler.
  // -------------------------------------------------------------------------

  it('calls updateJob("failed") and re-throws when getDocument throws an unexpected error', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const storageError = new Error('Table storage unavailable');
    mm.setGetDocument(async () => { throw storageError; });

    // Temporarily set DOCINTEL env vars so the client is non-null
    process.env.DOCINTEL_ENDPOINT = 'https://fake.cognitiveservices.azure.com/';
    process.env.DOCINTEL_KEY = 'fake-key-1234567890abcdef';

    const CONFIG_PATH = require.resolve('../../src/lib/config');
    const WORKER_PATH = require.resolve('../../src/functions/ocrWorker');
    delete require.cache[CONFIG_PATH];
    delete require.cache[WORKER_PATH];

    let freshHandler;
    const origQ = app.storageQueue;
    app.storageQueue = (name, opts) => {
      if (name === 'ocr-worker') freshHandler = opts.handler;
    };
    require('../../src/functions/ocrWorker');
    app.storageQueue = origQ;

    try {
      const ctx = createMockContext();
      const msg = encodeMessage({ jobId: 'job-err-01', docId: 'doc-err-01', ownerEmail: 'user@test.com' });

      await assert.rejects(
        () => freshHandler(msg, ctx),
        (err) => {
          assert.equal(err.message, 'Table storage unavailable');
          return true;
        }
      );

      // The "running" update fires before getDocument
      const runningCall = updateJobSpy.calls.find(c => c.patch.status === 'running');
      assert.ok(runningCall, '"running" updateJob must be called before getDocument');

      // The "failed" update must also fire
      const failedCall = updateJobSpy.calls.find(c => c.patch.status === 'failed');
      assert.ok(failedCall, '"failed" updateJob must be called after the error');
      assert.equal(failedCall.patch.error, 'Table storage unavailable');

    } finally {
      delete process.env.DOCINTEL_ENDPOINT;
      delete process.env.DOCINTEL_KEY;
      mm.resetAll();
      delete require.cache[require.resolve('../../src/lib/config')];
      delete require.cache[require.resolve('../../src/functions/ocrWorker')];
      require('../../src/lib/config');
    }
  });

  it('calls context.error with job id and error message when worker throws', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);

    const blobError = new Error('Blob download failed');
    mm.setGetDocument(async () => ({
      docId: 'doc-err-02',
      sourceBlobName: 'some/source.pdf'
    }));
    mm.setDownloadToBuffer(async () => { throw blobError; });

    process.env.DOCINTEL_ENDPOINT = 'https://fake.cognitiveservices.azure.com/';
    process.env.DOCINTEL_KEY = 'fake-key-1234567890abcdef';

    const CONFIG_PATH = require.resolve('../../src/lib/config');
    const WORKER_PATH = require.resolve('../../src/functions/ocrWorker');
    delete require.cache[CONFIG_PATH];
    delete require.cache[WORKER_PATH];

    let freshHandler;
    const origQ = app.storageQueue;
    app.storageQueue = (name, opts) => {
      if (name === 'ocr-worker') freshHandler = opts.handler;
    };
    require('../../src/functions/ocrWorker');
    app.storageQueue = origQ;

    try {
      const ctx = createMockContext();
      const msg = encodeMessage({ jobId: 'job-err-02', docId: 'doc-err-02', ownerEmail: 'user@test.com' });

      await assert.rejects(() => freshHandler(msg, ctx));

      // context.error must have been called and include the job id
      const errorLogs = ctx._logs.filter(l => l.level === 'error');
      assert.ok(errorLogs.length > 0, 'context.error must be called when the worker throws');
      const errorText = String(errorLogs[0].args[0]);
      assert.ok(
        errorText.includes('job-err-02'),
        `context.error should include the job id, got: "${errorText}"`
      );
      assert.ok(
        errorText.includes('Blob download failed'),
        `context.error should include the error message, got: "${errorText}"`
      );

    } finally {
      delete process.env.DOCINTEL_ENDPOINT;
      delete process.env.DOCINTEL_KEY;
      mm.resetAll();
      delete require.cache[require.resolve('../../src/lib/config')];
      delete require.cache[require.resolve('../../src/functions/ocrWorker')];
      require('../../src/lib/config');
    }
  });

  it('updates job to "running" before attempting to fetch the document', async () => {
    const callOrder = [];
    mm.setUpdateJob(async (jobId, patch) => {
      callOrder.push(`updateJob:${patch.status}`);
    });
    mm.setGetDocument(async () => {
      callOrder.push('getDocument');
      return null; // will cause "Document metadata missing" throw
    });

    process.env.DOCINTEL_ENDPOINT = 'https://fake.cognitiveservices.azure.com/';
    process.env.DOCINTEL_KEY = 'fake-key-1234567890abcdef';

    const CONFIG_PATH = require.resolve('../../src/lib/config');
    const WORKER_PATH = require.resolve('../../src/functions/ocrWorker');
    delete require.cache[CONFIG_PATH];
    delete require.cache[WORKER_PATH];

    let freshHandler;
    const origQ = app.storageQueue;
    app.storageQueue = (name, opts) => {
      if (name === 'ocr-worker') freshHandler = opts.handler;
    };
    require('../../src/functions/ocrWorker');
    app.storageQueue = origQ;

    try {
      const ctx = createMockContext();
      const msg = encodeMessage({ jobId: 'job-order-01', docId: 'doc-order-01' });

      await assert.rejects(() => freshHandler(msg, ctx));

      // "running" must appear in callOrder before "getDocument"
      const runningIdx = callOrder.indexOf('updateJob:running');
      const getDocIdx = callOrder.indexOf('getDocument');
      assert.ok(runningIdx !== -1, '"running" update must have fired');
      assert.ok(getDocIdx !== -1, 'getDocument must have been called');
      assert.ok(runningIdx < getDocIdx, '"running" update must precede getDocument call');

    } finally {
      delete process.env.DOCINTEL_ENDPOINT;
      delete process.env.DOCINTEL_KEY;
      mm.resetAll();
      delete require.cache[require.resolve('../../src/lib/config')];
      delete require.cache[require.resolve('../../src/functions/ocrWorker')];
      require('../../src/lib/config');
    }
  });

  it('throws "Document metadata missing" when document is not found', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);
    mm.setGetDocument(async () => null); // getDocument returns null → doc is falsy

    process.env.DOCINTEL_ENDPOINT = 'https://fake.cognitiveservices.azure.com/';
    process.env.DOCINTEL_KEY = 'fake-key-1234567890abcdef';

    const CONFIG_PATH = require.resolve('../../src/lib/config');
    const WORKER_PATH = require.resolve('../../src/functions/ocrWorker');
    delete require.cache[CONFIG_PATH];
    delete require.cache[WORKER_PATH];

    let freshHandler;
    const origQ = app.storageQueue;
    app.storageQueue = (name, opts) => {
      if (name === 'ocr-worker') freshHandler = opts.handler;
    };
    require('../../src/functions/ocrWorker');
    app.storageQueue = origQ;

    try {
      const ctx = createMockContext();
      const msg = encodeMessage({ jobId: 'job-nodoc', docId: 'doc-nodoc' });

      await assert.rejects(
        () => freshHandler(msg, ctx),
        (err) => {
          assert.ok(
            err.message.includes('Document metadata missing'),
            `Expected "Document metadata missing", got: "${err.message}"`
          );
          return true;
        }
      );

      const failedCall = updateJobSpy.calls.find(c => c.patch.status === 'failed');
      assert.ok(failedCall, 'job must be updated to "failed"');
      assert.ok(
        failedCall.patch.error.includes('Document metadata missing'),
        'failed patch error should contain the thrown message'
      );

    } finally {
      delete process.env.DOCINTEL_ENDPOINT;
      delete process.env.DOCINTEL_KEY;
      mm.resetAll();
      delete require.cache[require.resolve('../../src/lib/config')];
      delete require.cache[require.resolve('../../src/functions/ocrWorker')];
      require('../../src/lib/config');
    }
  });

  it('throws "Document metadata missing" when sourceBlobName is absent from document', async () => {
    const updateJobSpy = makeUpdateJobSpy();
    mm.setUpdateJob(updateJobSpy);
    // doc exists but has no sourceBlobName
    mm.setGetDocument(async () => ({
      docId: 'doc-noblobname',
      ownerEmail: 'user@test.com'
      // sourceBlobName intentionally omitted
    }));

    process.env.DOCINTEL_ENDPOINT = 'https://fake.cognitiveservices.azure.com/';
    process.env.DOCINTEL_KEY = 'fake-key-1234567890abcdef';

    const CONFIG_PATH = require.resolve('../../src/lib/config');
    const WORKER_PATH = require.resolve('../../src/functions/ocrWorker');
    delete require.cache[CONFIG_PATH];
    delete require.cache[WORKER_PATH];

    let freshHandler;
    const origQ = app.storageQueue;
    app.storageQueue = (name, opts) => {
      if (name === 'ocr-worker') freshHandler = opts.handler;
    };
    require('../../src/functions/ocrWorker');
    app.storageQueue = origQ;

    try {
      const ctx = createMockContext();
      const msg = encodeMessage({ jobId: 'job-noblobname', docId: 'doc-noblobname' });

      await assert.rejects(
        () => freshHandler(msg, ctx),
        (err) => {
          assert.ok(
            err.message.includes('Document metadata missing'),
            `Expected "Document metadata missing", got: "${err.message}"`
          );
          return true;
        }
      );

    } finally {
      delete process.env.DOCINTEL_ENDPOINT;
      delete process.env.DOCINTEL_KEY;
      mm.resetAll();
      delete require.cache[require.resolve('../../src/lib/config')];
      delete require.cache[require.resolve('../../src/functions/ocrWorker')];
      require('../../src/lib/config');
    }
  });

});
