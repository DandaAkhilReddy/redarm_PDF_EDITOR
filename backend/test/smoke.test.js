require('./_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Test infrastructure smoke test', () => {
  it('loads env vars from setup', () => {
    assert.ok(process.env.STORAGE_CONNECTION_STRING);
    assert.ok(process.env.JWT_SECRET);
  });

  it('can load config after setup', () => {
    const { config } = require('../src/lib/config');
    assert.equal(config.bootstrapAdminEmail, 'admin@test.redarm');
  });

  it('can create mock objects', () => {
    const mocks = require('./_helpers/mocks');
    const table = mocks.createMockTableClient();
    assert.ok(table.getEntity);
    assert.ok(table.upsertEntity);
    const req = mocks.createMockRequest({ method: 'GET' });
    assert.equal(req.method, 'GET');
  });
});
