// backend/test/functions/exportWorker.test.js
// Tests for the export-worker queue-triggered Azure Function.

require('../_helpers/setup');
const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockContext } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Capture the handler registered by exportWorker.js before it is loaded.
// We intercept app.storageQueue so the module never tries to actually register
// against a live Azure Functions runtime.
// ---------------------------------------------------------------------------
let capturedHandler;
const { app } = require('@azure/functions');
const origQueue = app.storageQueue;
app.storageQueue = (name, opts) => {
  if (name === 'export-worker') {
    capturedHandler = opts.handler;
  }
};
require('../../src/functions/exportWorker');
app.storageQueue = origQueue;

// ---------------------------------------------------------------------------
// Module-level mocks for all external dependencies used by exportWorker.js
// ---------------------------------------------------------------------------
const tables = require('../../src/lib/tables');
const storage = require('../../src/lib/storage');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid task payload. */
function makeTask(overrides = {}) {
  return {
    jobId: 'job-001',
    docId: 'doc-abc',
    ownerEmail: 'user@example.com',
    attempt: 0,
    ...overrides,
  };
}

/** Build a minimal valid document entity. */
function makeDoc(overrides = {}) {
  return {
    docId: 'doc-abc',
    sourceBlobName: 'user@example.com/doc-abc/source.pdf',
    ...overrides,
  };
}

/** Run capturedHandler with message and a fresh mock context. */
async function runHandler(message, context) {
  return capturedHandler(message, context || createMockContext());
}

// ---------------------------------------------------------------------------
// Reset all mocks before each test so state does not bleed between tests.
// ---------------------------------------------------------------------------
beforeEach(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportWorker — handler registration', () => {
  it('registers the export-worker handler via app.storageQueue', () => {
    assert.equal(typeof capturedHandler, 'function',
      'capturedHandler should be a function after module load');
  });
});

describe('exportWorker — early-exit for invalid payloads', () => {
  it('returns early and does not call updateJob when jobId is missing', async () => {
    const updateJobMock = mock.method(tables, 'updateJob', async () => {});
    const ctx = createMockContext();

    await runHandler(makeTask({ jobId: '' }), ctx);

    assert.equal(updateJobMock.mock.callCount(), 0,
      'updateJob must not be called for messages without a jobId');

    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.ok(errorLogs.length > 0, 'An error must be logged for invalid payload');
  });

  it('returns early and does not call updateJob when docId is missing', async () => {
    const updateJobMock = mock.method(tables, 'updateJob', async () => {});
    const ctx = createMockContext();

    await runHandler(makeTask({ docId: '' }), ctx);

    assert.equal(updateJobMock.mock.callCount(), 0,
      'updateJob must not be called for messages without a docId');

    const errorLogs = ctx._logs.filter(l => l.level === 'error');
    assert.ok(errorLogs.length > 0, 'An error must be logged for invalid payload');
  });

  it('returns early when both jobId and docId are absent', async () => {
    const updateJobMock = mock.method(tables, 'updateJob', async () => {});

    await runHandler(makeTask({ jobId: undefined, docId: undefined }));

    assert.equal(updateJobMock.mock.callCount(), 0);
  });
});

describe('exportWorker — job status progression', () => {
  it('updates job status to "running" before any document lookup', async () => {
    const callOrder = [];

    mock.method(tables, 'updateJob', async (jobId, patch) => {
      callOrder.push({ fn: 'updateJob', status: patch.status });
    });
    mock.method(tables, 'getDocument', async () => {
      callOrder.push({ fn: 'getDocument' });
      return makeDoc();
    });
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('pdf'));
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://example.com/export.pdf?sig=xxx',
      expiresOn: new Date().toISOString(),
    }));

    await runHandler(makeTask());

    assert.ok(callOrder.length >= 2, 'Expected at least updateJob then getDocument');
    assert.equal(callOrder[0].fn, 'updateJob');
    assert.equal(callOrder[0].status, 'running',
      'First updateJob call must set status to "running"');
    assert.equal(callOrder[1].fn, 'getDocument',
      'getDocument must be called after the "running" update');
  });

  it('updates job to "completed" with resultUri on successful export', async () => {
    const updateJobCalls = [];

    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('pdf-bytes'));
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://storage.example.com/pdf-export/user@example.com/doc-abc/job-001.pdf?sig=abc',
      expiresOn: new Date().toISOString(),
    }));

    await runHandler(makeTask());

    const completedCall = updateJobCalls.find(p => p.status === 'completed');
    assert.ok(completedCall, 'updateJob must be called with status "completed"');
    assert.ok(typeof completedCall.resultUri === 'string' && completedCall.resultUri.length > 0,
      'Completed job must include a resultUri');
    assert.equal(completedCall.error, null,
      'Completed job must clear the error field');
  });

  it('updates job to "failed" when an error occurs', async () => {
    const updateJobCalls = [];

    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => {
      throw new Error('Storage unavailable');
    });

    await assert.rejects(
      () => runHandler(makeTask()),
      /Storage unavailable/,
    );

    const failedCall = updateJobCalls.find(p => p.status === 'failed');
    assert.ok(failedCall, 'updateJob must be called with status "failed" after an error');
    assert.equal(failedCall.error, 'Storage unavailable',
      'Failed job must record the error message');
  });
});

describe('exportWorker — document validation', () => {
  it('throws and marks job failed when getDocument returns null', async () => {
    const updateJobCalls = [];
    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => null);

    await assert.rejects(
      () => runHandler(makeTask()),
      /Document metadata missing source blob reference/,
    );

    const failedCall = updateJobCalls.find(p => p.status === 'failed');
    assert.ok(failedCall, 'updateJob must set status to "failed"');
  });

  it('throws and marks job failed when sourceBlobName is absent from document', async () => {
    const updateJobCalls = [];
    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => makeDoc({ sourceBlobName: '' }));

    await assert.rejects(
      () => runHandler(makeTask()),
      /Document metadata missing source blob reference/,
    );

    const failedCall = updateJobCalls.find(p => p.status === 'failed');
    assert.ok(failedCall);
    assert.equal(failedCall.error, 'Document metadata missing source blob reference');
  });
});

describe('exportWorker — storage interactions', () => {
  it('downloads from the source container using the document sourceBlobName', async () => {
    const downloadCalls = [];

    mock.method(tables, 'updateJob', async () => {});
    mock.method(tables, 'getDocument', async () =>
      makeDoc({ sourceBlobName: 'owner@x.com/doc-abc/source.pdf' }));
    mock.method(storage, 'downloadToBuffer', async (container, blobName) => {
      downloadCalls.push({ container, blobName });
      return Buffer.from('raw-pdf');
    });
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://example.com/x?sig=y',
      expiresOn: new Date().toISOString(),
    }));

    await runHandler(makeTask());

    assert.equal(downloadCalls.length, 1, 'downloadToBuffer must be called exactly once');
    assert.equal(downloadCalls[0].container, 'pdf-source',
      'Must download from the source container (pdf-source)');
    assert.equal(downloadCalls[0].blobName, 'owner@x.com/doc-abc/source.pdf',
      'Must use the sourceBlobName from the document entity');
  });

  it('uploads to the export container with path <ownerEmail>/<docId>/<jobId>.pdf', async () => {
    const uploadCalls = [];

    mock.method(tables, 'updateJob', async () => {});
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('raw-pdf'));
    mock.method(storage, 'uploadBuffer', async (container, blobName, buffer, contentType) => {
      uploadCalls.push({ container, blobName, contentType });
    });
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://example.com/x?sig=y',
      expiresOn: new Date().toISOString(),
    }));

    await runHandler(makeTask({
      jobId: 'job-001',
      docId: 'doc-abc',
      ownerEmail: 'user@example.com',
    }));

    assert.equal(uploadCalls.length, 1, 'uploadBuffer must be called exactly once');
    assert.equal(uploadCalls[0].container, 'pdf-export',
      'Must upload to the export container (pdf-export)');
    assert.equal(uploadCalls[0].blobName, 'user@example.com/doc-abc/job-001.pdf',
      'Export blob name must follow the <ownerEmail>/<docId>/<jobId>.pdf pattern');
    assert.equal(uploadCalls[0].contentType, 'application/pdf',
      'Content-Type must be application/pdf');
  });

  it('generates a read SAS URL for the exported blob', async () => {
    const sasCalls = [];

    mock.method(tables, 'updateJob', async () => {});
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('pdf'));
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', (container, blobName, perms, minutes) => {
      sasCalls.push({ container, blobName, perms, minutes });
      return {
        url: `https://example.com/${container}/${blobName}?sig=test`,
        expiresOn: new Date().toISOString(),
      };
    });

    await runHandler(makeTask({
      jobId: 'job-001',
      docId: 'doc-abc',
      ownerEmail: 'user@example.com',
    }));

    assert.equal(sasCalls.length, 1, 'buildBlobSasUrl must be called exactly once');
    assert.equal(sasCalls[0].container, 'pdf-export');
    assert.equal(sasCalls[0].blobName, 'user@example.com/doc-abc/job-001.pdf');
    assert.equal(sasCalls[0].perms, 'r', 'SAS permissions must be read-only');
    assert.ok(sasCalls[0].minutes > 0, 'SAS expiry minutes must be positive');
  });
});

describe('exportWorker — error re-throw behavior', () => {
  it('re-throws the original error after marking the job as failed', async () => {
    const originalError = new Error('Downstream failure');

    mock.method(tables, 'updateJob', async () => {});
    mock.method(tables, 'getDocument', async () => {
      throw originalError;
    });

    let caught;
    try {
      await runHandler(makeTask());
    } catch (err) {
      caught = err;
    }

    assert.ok(caught, 'An error must be thrown by the handler');
    assert.strictEqual(caught, originalError,
      'The re-thrown error must be the exact same object as the original');
  });
});

describe('exportWorker — message decoding', () => {
  it('handles a JSON string message (string-serialised payload)', async () => {
    const updateJobCalls = [];

    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('pdf'));
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://example.com/x?sig=y',
      expiresOn: new Date().toISOString(),
    }));

    // Pass a JSON string rather than a plain object
    const jsonString = JSON.stringify(makeTask());
    await runHandler(jsonString);

    const completedCall = updateJobCalls.find(p => p.status === 'completed');
    assert.ok(completedCall,
      'Handler must process a JSON string message and complete successfully');
  });

  it('handles a base64-encoded JSON message', async () => {
    const updateJobCalls = [];

    mock.method(tables, 'updateJob', async (jobId, patch) => {
      updateJobCalls.push(patch);
    });
    mock.method(tables, 'getDocument', async () => makeDoc());
    mock.method(storage, 'downloadToBuffer', async () => Buffer.from('pdf'));
    mock.method(storage, 'uploadBuffer', async () => {});
    mock.method(storage, 'buildBlobSasUrl', () => ({
      url: 'https://example.com/x?sig=y',
      expiresOn: new Date().toISOString(),
    }));

    // Azure storage queues send messages as base64 by convention
    const base64Message = Buffer.from(JSON.stringify(makeTask()), 'utf8').toString('base64');
    await runHandler(base64Message);

    const completedCall = updateJobCalls.find(p => p.status === 'completed');
    assert.ok(completedCall,
      'Handler must process a base64-encoded JSON message and complete successfully');
  });
});
