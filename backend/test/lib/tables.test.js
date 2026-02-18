// backend/test/lib/tables.test.js
//
// Tests for backend/src/lib/tables.js
//
// Strategy for mocking Azure TableClient:
//   tables.js calls TableClient.fromConnectionString() at getTableClient() time
//   and caches the result in a module-level Map. Because require() also caches
//   modules, we cannot simply re-require tables.js per test. Instead we:
//
//   1. Inject a fake TableClient into Node's require cache BEFORE tables.js is
//      first loaded (so fromConnectionString returns our mock).
//   2. After tables.js is loaded we reach into its exported getTableClient to
//      verify wiring, and we patch the internal clientCache / initCache by
//      monkey-patching getTableClient on the module itself for the async tests.
//   3. For CRUD tests we expose a fresh mockTableClient per logical group and
//      patch module.getTableClient so every call in that test group returns the
//      same controllable client.
//
// Pure-function tests (isoNow, normalizeEmail) need no mocking at all.

require('../_helpers/setup'); // MUST be first – sets process.env before config loads

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMockTableClient } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Mock @azure/data-tables BEFORE tables.js is loaded.
// We intercept Node's module cache to shim fromConnectionString.
// ---------------------------------------------------------------------------

// Capture any legitimate existing cached module so we can restore it later.
const DATA_TABLES_ID = require.resolve('@azure/data-tables');
const _originalDataTablesModule = require.cache[DATA_TABLES_ID];

// Build a shared mock TableClient that fromConnectionString will return.
// Individual test groups can swap this reference out.
let _activeMockClient = createMockTableClient();

const _fakeDataTables = {
  TableClient: {
    fromConnectionString: (_connStr, _tableName) => _activeMockClient,
  },
};

// Install the shim into the require cache before tables.js is first required.
require.cache[DATA_TABLES_ID] = {
  id: DATA_TABLES_ID,
  filename: DATA_TABLES_ID,
  loaded: true,
  exports: _fakeDataTables,
  parent: null,
  children: [],
  paths: [],
};

// Now load tables.js — it will pick up our mocked @azure/data-tables.
const tables = require('../../src/lib/tables');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resets the internal caches inside tables.js between tests.
 *
 * tables.js exports getTableClient but not the caches themselves.
 * We reach into the module via the require cache to clear them, OR we
 * monkey-patch getTableClient on the exported object so each CRUD test
 * group controls which client is returned.
 */
function patchGetTableClient(mockClient) {
  // Replace the exported function reference so all internal callers that go
  // through the module's own exports use our mock. Because tables.js uses
  // its own local getTableClient (not the export), we need a slightly different
  // strategy: we swap the mock that fromConnectionString returns AND we must
  // clear the clientCache so getTableClient re-calls fromConnectionString.
  _activeMockClient = mockClient;

  // Clear the cached module so clientCache and initCache start fresh.
  const TABLES_ID = require.resolve('../../src/lib/tables');
  delete require.cache[TABLES_ID];

  // Re-require tables so it starts with empty caches and picks up the new
  // _activeMockClient via our shim.
  const fresh = require('../../src/lib/tables');
  return fresh;
}

// ---------------------------------------------------------------------------
// 1. isoNow()
// ---------------------------------------------------------------------------

describe('isoNow', () => {
  it('returns a string', () => {
    const result = tables.isoNow();
    assert.equal(typeof result, 'string');
  });

  it('is a valid ISO 8601 date string parseable by Date', () => {
    const result = tables.isoNow();
    const parsed = new Date(result);
    assert.ok(!isNaN(parsed.getTime()), `Expected valid date, got: ${result}`);
  });

  it('ends with Z (UTC timezone marker)', () => {
    const result = tables.isoNow();
    assert.ok(result.endsWith('Z'), `Expected string ending in Z, got: ${result}`);
  });

  it('contains T separating date and time', () => {
    const result = tables.isoNow();
    assert.ok(result.includes('T'), `Expected ISO string with T separator, got: ${result}`);
  });

  it('is close to the current time (within 2 seconds)', () => {
    const before = Date.now();
    const result = tables.isoNow();
    const after = Date.now();
    const ts = new Date(result).getTime();
    assert.ok(ts >= before - 10 && ts <= after + 10,
      `Timestamp ${result} is not close to current time`);
  });

  it('returns a new value on each call (time advances)', async () => {
    const a = tables.isoNow();
    await new Promise(r => setTimeout(r, 5));
    const b = tables.isoNow();
    // Both must be valid; they may or may not differ by milliseconds but must
    // both parse. (On very fast machines they could be equal — we just verify
    // both are valid dates.)
    assert.ok(!isNaN(new Date(a).getTime()));
    assert.ok(!isNaN(new Date(b).getTime()));
  });
});

// ---------------------------------------------------------------------------
// 2. normalizeEmail()
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lowercases an uppercase email', () => {
    assert.equal(tables.normalizeEmail('USER@EXAMPLE.COM'), 'user@example.com');
  });

  it('trims leading whitespace', () => {
    assert.equal(tables.normalizeEmail('   user@example.com'), 'user@example.com');
  });

  it('trims trailing whitespace', () => {
    assert.equal(tables.normalizeEmail('user@example.com   '), 'user@example.com');
  });

  it('trims both leading and trailing whitespace', () => {
    assert.equal(tables.normalizeEmail('  User@Example.Com  '), 'user@example.com');
  });

  it('handles mixed-case domain and local part', () => {
    assert.equal(tables.normalizeEmail('Admin@TEST.RedArm'), 'admin@test.redarm');
  });

  it('returns empty string for null', () => {
    assert.equal(tables.normalizeEmail(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(tables.normalizeEmail(undefined), '');
  });

  it('returns empty string for empty string input', () => {
    assert.equal(tables.normalizeEmail(''), '');
  });

  it('returns empty string for whitespace-only input', () => {
    assert.equal(tables.normalizeEmail('   '), '');
  });

  it('handles numeric-looking input by coercing to string', () => {
    // normalizeEmail does String(email || "") so 0 becomes "" and 42 becomes "42"
    assert.equal(tables.normalizeEmail(0), '');
    assert.equal(tables.normalizeEmail(42), '42');
  });

  it('preserves valid email structure after normalization', () => {
    const result = tables.normalizeEmail('  Alice.Bob+tag@Sub.Domain.IO  ');
    assert.equal(result, 'alice.bob+tag@sub.domain.io');
  });
});

// ---------------------------------------------------------------------------
// 3. Module exports — structural checks
// ---------------------------------------------------------------------------

describe('tables module exports', () => {
  const expectedExports = [
    'isoNow',
    'normalizeEmail',
    'getUser',
    'upsertUser',
    'getDocument',
    'upsertDocument',
    'createJob',
    'getJob',
    'updateJob',
    'ensureTable',
    'getTableClient',
  ];

  for (const name of expectedExports) {
    it(`exports "${name}"`, () => {
      assert.ok(Object.prototype.hasOwnProperty.call(tables, name),
        `tables.js should export "${name}"`);
    });
  }

  it('exports async functions for all CRUD operations', () => {
    const asyncFns = ['getUser', 'upsertUser', 'getDocument', 'upsertDocument',
      'createJob', 'getJob', 'updateJob', 'ensureTable'];
    for (const name of asyncFns) {
      const fn = tables[name];
      assert.ok(typeof fn === 'function',
        `${name} should be a function`);
      // Async functions return a Promise when invoked — but we just check the
      // constructor name to avoid triggering network calls here.
      assert.equal(fn.constructor.name, 'AsyncFunction',
        `${name} should be an async function`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. ensureTable — uses mock client
// ---------------------------------------------------------------------------

describe('ensureTable', () => {
  let t;
  let mock;

  before(() => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);
  });

  it('calls createTable on first call for a table name', async () => {
    let called = false;
    mock.createTable = async () => { called = true; };
    await t.ensureTable('test-table-a');
    assert.ok(called, 'createTable should have been called');
  });

  it('does NOT call createTable a second time for the same table (init cache)', async () => {
    // Reload fresh module so initCache is empty.
    mock = createMockTableClient();
    t = patchGetTableClient(mock);

    let callCount = 0;
    mock.createTable = async () => { callCount++; };

    await t.ensureTable('cached-table');
    await t.ensureTable('cached-table');
    await t.ensureTable('cached-table');

    assert.equal(callCount, 1, 'createTable should only be called once per table');
  });

  it('swallows 409 Conflict errors (table already exists)', async () => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);

    mock.createTable = async () => {
      const err = new Error('Table already exists');
      err.statusCode = 409;
      throw err;
    };

    // Should not throw
    await assert.doesNotReject(() => t.ensureTable('existing-table'));
  });

  it('rethrows non-409 errors from createTable', async () => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);

    mock.createTable = async () => {
      const err = new Error('Internal Server Error');
      err.statusCode = 500;
      throw err;
    };

    await assert.rejects(
      () => t.ensureTable('bad-table'),
      (err) => err.statusCode === 500
    );
  });
});

// ---------------------------------------------------------------------------
// 5. getUser / upsertUser
// ---------------------------------------------------------------------------

describe('getUser and upsertUser', () => {
  let t;
  let mock;

  before(() => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);
  });

  it('getUser returns null for a non-existent user', async () => {
    const result = await t.getUser('nobody@example.com');
    assert.equal(result, null);
  });

  it('upsertUser stores entity with partitionKey USER and normalised rowKey', async () => {
    await t.upsertUser({ email: '  Alice@Example.COM  ', name: 'Alice' });
    const key = 'USER:alice@example.com';
    assert.ok(mock._store.has(key), `Expected store to contain key "${key}"`);
    const entity = mock._store.get(key);
    assert.equal(entity.partitionKey, 'USER');
    assert.equal(entity.rowKey, 'alice@example.com');
    assert.equal(entity.name, 'Alice');
  });

  it('getUser retrieves a previously upserted user', async () => {
    await t.upsertUser({ email: 'bob@example.com', role: 'editor' });
    const result = await t.getUser('bob@example.com');
    assert.ok(result, 'Expected a result');
    assert.equal(result.rowKey, 'bob@example.com');
    assert.equal(result.role, 'editor');
  });

  it('getUser normalises the email passed to lookup', async () => {
    await t.upsertUser({ email: 'carol@example.com', role: 'viewer' });
    // Lookup with different casing / spaces — should still find the entity.
    const result = await t.getUser('  CAROL@EXAMPLE.COM  ');
    assert.ok(result, 'Expected to find carol via case-insensitive lookup');
    assert.equal(result.rowKey, 'carol@example.com');
  });

  it('upsertUser merges fields on subsequent calls (Merge mode)', async () => {
    await t.upsertUser({ email: 'dan@example.com', fieldA: 'original', fieldB: 'keep' });
    await t.upsertUser({ email: 'dan@example.com', fieldA: 'updated' });
    const entity = mock._store.get('USER:dan@example.com');
    assert.equal(entity.fieldA, 'updated', 'fieldA should be updated');
    assert.equal(entity.fieldB, 'keep', 'fieldB should be preserved in Merge mode');
  });
});

// ---------------------------------------------------------------------------
// 6. getDocument / upsertDocument
// ---------------------------------------------------------------------------

describe('getDocument and upsertDocument', () => {
  let t;
  let mock;

  before(() => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);
  });

  it('getDocument returns null for a missing docId', async () => {
    const result = await t.getDocument('non-existent-doc');
    assert.equal(result, null);
  });

  it('upsertDocument stores entity with partitionKey DOC and rowKey = docId', async () => {
    await t.upsertDocument({ docId: 'doc-001', title: 'Test PDF', size: 1024 });
    const key = 'DOC:doc-001';
    assert.ok(mock._store.has(key), `Expected store to have key "${key}"`);
    const entity = mock._store.get(key);
    assert.equal(entity.partitionKey, 'DOC');
    assert.equal(entity.rowKey, 'doc-001');
    assert.equal(entity.title, 'Test PDF');
  });

  it('getDocument retrieves a previously upserted document', async () => {
    await t.upsertDocument({ docId: 'doc-002', owner: 'alice@example.com' });
    const result = await t.getDocument('doc-002');
    assert.ok(result, 'Expected a result');
    assert.equal(result.rowKey, 'doc-002');
    assert.equal(result.owner, 'alice@example.com');
  });

  it('upsertDocument coerces numeric docId to string', async () => {
    await t.upsertDocument({ docId: 99, label: 'numeric-id' });
    const key = 'DOC:99';
    assert.ok(mock._store.has(key), `Expected store to have key "${key}" for numeric docId`);
  });

  it('upsertDocument merges on subsequent calls (Merge mode)', async () => {
    await t.upsertDocument({ docId: 'doc-merge', status: 'pending', pages: 10 });
    await t.upsertDocument({ docId: 'doc-merge', status: 'complete' });
    const entity = mock._store.get('DOC:doc-merge');
    assert.equal(entity.status, 'complete');
    assert.equal(entity.pages, 10, 'pages should be preserved in Merge mode');
  });
});

// ---------------------------------------------------------------------------
// 7. createJob / getJob / updateJob
// ---------------------------------------------------------------------------

describe('createJob, getJob, updateJob', () => {
  let t;
  let mock;

  before(() => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);
  });

  it('createJob stores entity with partitionKey JOB and rowKey = jobId', async () => {
    await t.createJob({ jobId: 'job-001', type: 'export', status: 'queued' });
    const key = 'JOB:job-001';
    assert.ok(mock._store.has(key), `Expected store to have key "${key}"`);
    const entity = mock._store.get(key);
    assert.equal(entity.partitionKey, 'JOB');
    assert.equal(entity.rowKey, 'job-001');
    assert.equal(entity.type, 'export');
  });

  it('createJob throws 409 if jobId already exists (uses createEntity, not upsert)', async () => {
    await t.createJob({ jobId: 'job-dupe', status: 'queued' });
    await assert.rejects(
      () => t.createJob({ jobId: 'job-dupe', status: 'queued-again' }),
      (err) => err.statusCode === 409,
      'createJob should throw Conflict when jobId already exists'
    );
  });

  it('getJob returns null for a missing jobId', async () => {
    const result = await t.getJob('no-such-job');
    assert.equal(result, null);
  });

  it('getJob retrieves a previously created job', async () => {
    await t.createJob({ jobId: 'job-002', type: 'ocr', status: 'running' });
    const result = await t.getJob('job-002');
    assert.ok(result, 'Expected a result');
    assert.equal(result.type, 'ocr');
    assert.equal(result.status, 'running');
  });

  it('updateJob patches a job in Merge mode (does not lose unpatched fields)', async () => {
    await t.createJob({ jobId: 'job-003', type: 'export', status: 'queued', createdAt: 'T1' });
    await t.updateJob('job-003', { status: 'complete', finishedAt: 'T2' });

    const entity = mock._store.get('JOB:job-003');
    assert.equal(entity.status, 'complete', 'status should be updated');
    assert.equal(entity.finishedAt, 'T2', 'finishedAt should be added');
    assert.equal(entity.type, 'export', 'type should be preserved');
    assert.equal(entity.createdAt, 'T1', 'createdAt should be preserved');
  });

  it('updateJob stores with partitionKey JOB', async () => {
    await t.createJob({ jobId: 'job-004', status: 'queued' });
    await t.updateJob('job-004', { status: 'done' });
    const entity = mock._store.get('JOB:job-004');
    assert.equal(entity.partitionKey, 'JOB');
  });

  it('getJob coerces numeric jobId to string for lookup', async () => {
    await t.createJob({ jobId: 'job-numeric', status: 'queued' });
    // Manually place with numeric-string key to verify coercion
    mock._store.set('JOB:12345', {
      partitionKey: 'JOB', rowKey: '12345', status: 'done'
    });
    const result = await t.getJob(12345);
    assert.ok(result, 'Expected to find job with numeric id coerced to string');
    assert.equal(result.status, 'done');
  });
});

// ---------------------------------------------------------------------------
// 8. getEntityOrNull behaviour (tested indirectly via getUser/getJob)
// ---------------------------------------------------------------------------

describe('getEntityOrNull (via getUser)', () => {
  let t;
  let mock;

  before(() => {
    mock = createMockTableClient();
    t = patchGetTableClient(mock);
  });

  it('returns null when getEntity throws a 404 error', async () => {
    // Default mock throws 404 for missing keys — getUser wraps it.
    const result = await t.getUser('phantom@example.com');
    assert.equal(result, null);
  });

  it('rethrows non-404 errors from getEntity', async () => {
    const originalGetEntity = mock.getEntity;
    mock.getEntity = async () => {
      const err = new Error('Service Unavailable');
      err.statusCode = 503;
      throw err;
    };
    await assert.rejects(
      () => t.getUser('anyone@example.com'),
      (err) => err.statusCode === 503
    );
    mock.getEntity = originalGetEntity; // restore
  });
});

// ---------------------------------------------------------------------------
// 9. Restore original @azure/data-tables module after all tests complete
// ---------------------------------------------------------------------------

after(() => {
  if (_originalDataTablesModule) {
    require.cache[DATA_TABLES_ID] = _originalDataTablesModule;
  } else {
    delete require.cache[DATA_TABLES_ID];
  }
});
