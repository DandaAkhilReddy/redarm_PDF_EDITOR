// backend/test/integration/job-lifecycle.test.js
//
// Integration tests for the complete job lifecycle:
//   create job -> poll status -> status transitions -> multi-job scenarios
//
// These tests exercise the docsExportStart, docsOcrStart, and jobsGet handlers
// together to verify end-to-end flows including status progression, ownership
// isolation, and error states.
//
// Critical require order:
//   1. require('../_helpers/setup')            -- env vars
//   2. const mm = require('../_helpers/module-mocks') -- cache injection FIRST
//   3. other test helpers
//   4. handler capture + require of source modules

// -- 1. Environment variables (MUST be first) --------------------------------
require('../_helpers/setup');

// -- 2. Module-mocks (MUST come before any handler source require) ------------
const mm = require('../_helpers/module-mocks');

// -- 3. Test framework + helpers ----------------------------------------------
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockRequest, createAuthHeaders } = require('../_helpers/mocks');

// -- 4. Capture all three handlers by intercepting app.http -------------------
let exportHandler;
let ocrHandler;
let jobsGetHandler;

const { app } = require('@azure/functions');
const origHttp = app.http;

app.http = (name, opts) => {
  if (name === 'docs-export-start') exportHandler = opts.handler;
  if (name === 'docs-ocr-start')   ocrHandler    = opts.handler;
  if (name === 'jobs-get')          jobsGetHandler = opts.handler;
};

// Clear cached handler modules so they pick up module-mocks fakes
const path = require('path');
const backendSrc = path.resolve(__dirname, '../../src');

const exportPath = require.resolve(path.join(backendSrc, 'functions/docsExportStart'));
const ocrPath    = require.resolve(path.join(backendSrc, 'functions/docsOcrStart'));
const jobsPath   = require.resolve(path.join(backendSrc, 'functions/jobsGet'));

delete require.cache[exportPath];
delete require.cache[ocrPath];
delete require.cache[jobsPath];

require('../../src/functions/docsExportStart');
require('../../src/functions/docsOcrStart');
require('../../src/functions/jobsGet');

app.http = origHttp;

assert.ok(exportHandler,   'docsExportStart handler was not captured');
assert.ok(ocrHandler,      'docsOcrStart handler was not captured');
assert.ok(jobsGetHandler,  'jobsGet handler was not captured');

// -- Test constants -----------------------------------------------------------
const USER_A_EMAIL = 'alice@test.redarm';
const USER_B_EMAIL = 'bob@test.redarm';
const DOC_ID       = 'doc-lifecycle-001';

function makeDoc(ownerEmail = USER_A_EMAIL) {
  return {
    partitionKey: 'DOC',
    rowKey:       DOC_ID,
    docId:        DOC_ID,
    ownerEmail,
    filename:     'lifecycle-test.pdf',
    status:       'ready',
  };
}

// -- Tests --------------------------------------------------------------------

describe('Integration: Job Lifecycle', () => {

  beforeEach(() => {
    mm.resetAll();
  });

  // ---------------------------------------------------------------------------
  // 1. Start export -> poll until complete
  // ---------------------------------------------------------------------------
  it('start export -> poll queued -> running -> completed', async () => {
    // In-memory job store to track state across handler calls
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc());
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setUpdateJob(async (jobId, updates) => {
      if (jobStore[jobId]) Object.assign(jobStore[jobId], updates);
    });
    mm.setSendQueueMessage(async () => {});

    // Step 1: Start export job
    const startReq = createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    });
    const startRes = await exportHandler(startReq);

    assert.equal(startRes.status, 202, 'Export start should return 202');
    const jobId = startRes.jsonBody.jobId;
    assert.ok(jobId, 'Response must include jobId');

    // Step 2: Poll -- should be "queued"
    const pollReq1 = createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    });
    const pollRes1 = await jobsGetHandler(pollReq1);

    assert.equal(pollRes1.status, 200);
    assert.equal(pollRes1.jsonBody.status, 'queued');
    assert.equal(pollRes1.jsonBody.type, 'export');
    assert.equal(pollRes1.jsonBody.resultUri, null);

    // Step 3: Simulate worker updating to "running"
    jobStore[jobId].status = 'running';
    jobStore[jobId].updatedAt = new Date().toISOString();

    const pollReq2 = createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    });
    const pollRes2 = await jobsGetHandler(pollReq2);

    assert.equal(pollRes2.status, 200);
    assert.equal(pollRes2.jsonBody.status, 'running');
    assert.equal(pollRes2.jsonBody.resultUri, null);

    // Step 4: Simulate worker updating to "completed" with resultUri
    const resultUri = 'https://storage.example.com/exports/result.pdf';
    jobStore[jobId].status = 'completed';
    jobStore[jobId].resultUri = resultUri;
    jobStore[jobId].updatedAt = new Date().toISOString();

    const pollReq3 = createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    });
    const pollRes3 = await jobsGetHandler(pollReq3);

    assert.equal(pollRes3.status, 200);
    assert.equal(pollRes3.jsonBody.status, 'completed');
    assert.equal(pollRes3.jsonBody.resultUri, resultUri);
    assert.equal(pollRes3.jsonBody.error, null);
  });

  // ---------------------------------------------------------------------------
  // 2. Start OCR -> poll until complete
  // ---------------------------------------------------------------------------
  it('start OCR -> poll queued -> running -> completed', async () => {
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc());
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setSendQueueMessage(async () => {});

    // Step 1: Start OCR job
    const startReq = createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { pages: '1-3' },
    });
    const startRes = await ocrHandler(startReq);

    assert.equal(startRes.status, 202, 'OCR start should return 202');
    const jobId = startRes.jsonBody.jobId;
    assert.ok(jobId, 'Response must include jobId');

    // Step 2: Poll -- should be "queued"
    const pollRes1 = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));

    assert.equal(pollRes1.status, 200);
    assert.equal(pollRes1.jsonBody.status, 'queued');
    assert.equal(pollRes1.jsonBody.type, 'ocr');

    // Step 3: Simulate worker updating to "running"
    jobStore[jobId].status = 'running';
    jobStore[jobId].updatedAt = new Date().toISOString();

    const pollRes2 = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));

    assert.equal(pollRes2.status, 200);
    assert.equal(pollRes2.jsonBody.status, 'running');

    // Step 4: Simulate worker completing with resultUri
    const resultUri = 'https://storage.example.com/ocr/result.json';
    jobStore[jobId].status = 'completed';
    jobStore[jobId].resultUri = resultUri;
    jobStore[jobId].updatedAt = new Date().toISOString();

    const pollRes3 = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));

    assert.equal(pollRes3.status, 200);
    assert.equal(pollRes3.jsonBody.status, 'completed');
    assert.equal(pollRes3.jsonBody.resultUri, resultUri);
    assert.equal(pollRes3.jsonBody.error, null);
  });

  // ---------------------------------------------------------------------------
  // 3. Job status transitions: queued -> running -> completed
  // ---------------------------------------------------------------------------
  it('verifies correct status at each transition: queued -> running -> completed', async () => {
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc());
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setSendQueueMessage(async () => {});

    // Start export job -- creates it as "queued"
    const startRes = await exportHandler(createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    }));
    const jobId = startRes.jsonBody.jobId;

    // Verify QUEUED
    const job = jobStore[jobId];
    assert.equal(job.status, 'queued', 'Job must start as queued');
    assert.equal(job.type, 'export');
    assert.equal(job.attempt, 0);
    assert.ok(job.createdAt, 'createdAt must be set');
    assert.ok(job.updatedAt, 'updatedAt must be set');

    const pollQueued = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollQueued.jsonBody.status, 'queued');
    assert.equal(pollQueued.jsonBody.resultUri, null);
    assert.equal(pollQueued.jsonBody.error, null);

    // Transition to RUNNING
    job.status = 'running';
    job.updatedAt = new Date().toISOString();

    const pollRunning = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollRunning.jsonBody.status, 'running');
    assert.equal(pollRunning.jsonBody.resultUri, null);

    // Transition to COMPLETED
    const resultUri = 'https://storage.example.com/exports/final.pdf';
    job.status = 'completed';
    job.resultUri = resultUri;
    job.updatedAt = new Date().toISOString();

    const pollCompleted = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollCompleted.jsonBody.status, 'completed');
    assert.equal(pollCompleted.jsonBody.resultUri, resultUri);
    assert.equal(pollCompleted.jsonBody.error, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Failed job: start export -> mark failed -> verify error returned
  // ---------------------------------------------------------------------------
  it('returns error details when a job transitions to failed', async () => {
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc());
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setSendQueueMessage(async () => {});

    // Start export job
    const startRes = await exportHandler(createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    }));
    const jobId = startRes.jsonBody.jobId;
    assert.equal(startRes.status, 202);

    // Simulate worker failing the job
    const errorMessage = 'PDF rendering timeout exceeded after 30 seconds';
    jobStore[jobId].status = 'failed';
    jobStore[jobId].error = errorMessage;
    jobStore[jobId].resultUri = null;
    jobStore[jobId].updatedAt = new Date().toISOString();

    // Poll should show failed status with error
    const pollRes = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));

    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.jsonBody.status, 'failed');
    assert.equal(pollRes.jsonBody.error, errorMessage);
    assert.equal(pollRes.jsonBody.resultUri, null);
    assert.equal(pollRes.jsonBody.jobId, jobId);
    assert.equal(pollRes.jsonBody.type, 'export');
  });

  // ---------------------------------------------------------------------------
  // 5. Multi-job for same document: export + OCR both get unique jobIds
  // ---------------------------------------------------------------------------
  it('starts both export and OCR jobs for the same document with independent states', async () => {
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc());
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setSendQueueMessage(async () => {});

    // Start export job
    const exportRes = await exportHandler(createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    }));
    assert.equal(exportRes.status, 202);
    const exportJobId = exportRes.jsonBody.jobId;

    // Start OCR job for the SAME document
    const ocrRes = await ocrHandler(createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { pages: '1-5' },
    }));
    assert.equal(ocrRes.status, 202);
    const ocrJobId = ocrRes.jsonBody.jobId;

    // Job IDs must be unique
    assert.notEqual(exportJobId, ocrJobId, 'Export and OCR jobs must have different jobIds');

    // Both jobs should exist in the store
    assert.ok(jobStore[exportJobId], 'Export job must exist in store');
    assert.ok(jobStore[ocrJobId], 'OCR job must exist in store');

    // Verify types are correct
    assert.equal(jobStore[exportJobId].type, 'export');
    assert.equal(jobStore[ocrJobId].type, 'ocr');

    // Both start as queued
    assert.equal(jobStore[exportJobId].status, 'queued');
    assert.equal(jobStore[ocrJobId].status, 'queued');

    // Complete the export job, leave OCR as queued
    jobStore[exportJobId].status = 'completed';
    jobStore[exportJobId].resultUri = 'https://storage.example.com/exports/done.pdf';
    jobStore[exportJobId].updatedAt = new Date().toISOString();

    // Poll export -- should be completed
    const pollExport = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId: exportJobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollExport.jsonBody.status, 'completed');
    assert.equal(pollExport.jsonBody.type, 'export');

    // Poll OCR -- should STILL be queued (independent of export)
    const pollOcr = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId: ocrJobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollOcr.jsonBody.status, 'queued');
    assert.equal(pollOcr.jsonBody.type, 'ocr');
    assert.equal(pollOcr.jsonBody.resultUri, null);
  });

  // ---------------------------------------------------------------------------
  // 6. Job ownership: User A's job cannot be polled by User B
  // ---------------------------------------------------------------------------
  it('returns 403 when User B tries to poll a job owned by User A', async () => {
    const jobStore = {};

    mm.setGetDocument(async () => makeDoc(USER_A_EMAIL));
    mm.setCreateJob(async (job) => { jobStore[job.jobId] = { ...job }; });
    mm.setGetJob(async (jobId) => jobStore[jobId] || null);
    mm.setSendQueueMessage(async () => {});

    // User A starts an export job
    const startRes = await exportHandler(createMockRequest({
      method:  'POST',
      params:  { docId: DOC_ID },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    }));
    assert.equal(startRes.status, 202);
    const jobId = startRes.jsonBody.jobId;

    // User A can poll successfully
    const pollA = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));
    assert.equal(pollA.status, 200, 'Owner should get 200');
    assert.equal(pollA.jsonBody.jobId, jobId);

    // User B tries to poll User A's job -- should get 403
    const pollB = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId },
      headers: createAuthHeaders(USER_B_EMAIL),
    }));
    assert.equal(pollB.status, 403, 'Non-owner should get 403');
    assert.equal(pollB.jsonBody.error.code, 'forbidden');
  });

  // ---------------------------------------------------------------------------
  // 7. Job not found: polling a non-existent jobId returns 404
  // ---------------------------------------------------------------------------
  it('returns 404 when polling a non-existent jobId', async () => {
    mm.setGetJob(async () => null);

    const pollRes = await jobsGetHandler(createMockRequest({
      method:  'GET',
      params:  { jobId: 'nonexistent-job-id-999' },
      headers: createAuthHeaders(USER_A_EMAIL),
    }));

    assert.equal(pollRes.status, 404);
    assert.equal(pollRes.jsonBody.error.code, 'not_found');
  });

  // ---------------------------------------------------------------------------
  // 8. Start job for non-existent document: returns 404
  // ---------------------------------------------------------------------------
  it('returns 404 when starting an export for a non-existent document', async () => {
    const createJobSpy = mm.spy(async () => {});
    const sendQueueSpy = mm.spy(async () => {});
    mm.setGetDocument(async () => null);
    mm.setCreateJob(createJobSpy);
    mm.setSendQueueMessage(sendQueueSpy);

    const res = await exportHandler(createMockRequest({
      method:  'POST',
      params:  { docId: 'nonexistent-doc-xyz' },
      headers: createAuthHeaders(USER_A_EMAIL),
      body:    { format: 'pdf' },
    }));

    assert.equal(res.status, 404, 'Should return 404 for missing document');
    assert.equal(res.jsonBody.error.code, 'not_found');

    // createJob and sendQueueMessage must NOT have been called
    assert.equal(createJobSpy.calls.length, 0, 'createJob must not be called for missing document');
    assert.equal(sendQueueSpy.calls.length, 0, 'sendQueueMessage must not be called for missing document');
  });
});
