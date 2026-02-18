// backend/test/lib/responses.test.js
require('../_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { json, error } = require('../../src/lib/responses');

describe('responses.json()', () => {
  it('returns the correct status code', () => {
    const res = json(200, { ok: true });
    assert.equal(res.status, 200);
  });

  it('returns the body as jsonBody', () => {
    const body = { message: 'hello', count: 42 };
    const res = json(200, body);
    assert.deepEqual(res.jsonBody, body);
  });

  it('always sets Content-Type to application/json', () => {
    const res = json(200, {});
    assert.equal(res.headers['Content-Type'], 'application/json');
  });

  it('merges custom headers alongside Content-Type', () => {
    const res = json(201, { created: true }, {
      'X-Request-Id': 'abc-123',
      'Cache-Control': 'no-store',
    });
    assert.equal(res.headers['Content-Type'], 'application/json');
    assert.equal(res.headers['X-Request-Id'], 'abc-123');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  it('custom headers can override Content-Type', () => {
    const res = json(200, 'text', { 'Content-Type': 'text/plain' });
    assert.equal(res.headers['Content-Type'], 'text/plain');
  });

  it('accepts an empty object body without throwing', () => {
    const res = json(204, {});
    assert.deepEqual(res.jsonBody, {});
    assert.equal(res.status, 204);
  });

  it('works correctly across common success and error status codes', () => {
    const codes = [200, 201, 400, 401, 403, 404, 409, 422, 500, 503];
    for (const code of codes) {
      const res = json(code, { status: code });
      assert.equal(res.status, code, `Expected status ${code}`);
      assert.equal(res.jsonBody.status, code);
    }
  });

  it('produces no extra top-level keys beyond status, jsonBody, and headers', () => {
    const res = json(200, { x: 1 });
    const keys = Object.keys(res).sort();
    assert.deepEqual(keys, ['headers', 'jsonBody', 'status']);
  });
});

describe('responses.error()', () => {
  it('returns the correct HTTP status code', () => {
    const res = error(400, 'BAD_REQUEST', 'Missing field');
    assert.equal(res.status, 400);
  });

  it('nests error under the error key in jsonBody', () => {
    const res = error(400, 'BAD_REQUEST', 'Missing field');
    assert.ok(res.jsonBody.error, 'jsonBody.error should exist');
  });

  it('includes code and message inside the error object', () => {
    const res = error(401, 'UNAUTHORIZED', 'Token expired');
    assert.equal(res.jsonBody.error.code, 'UNAUTHORIZED');
    assert.equal(res.jsonBody.error.message, 'Token expired');
  });

  it('omits the details key entirely when details argument is not provided', () => {
    const res = error(404, 'NOT_FOUND', 'Document not found');
    assert.equal(Object.prototype.hasOwnProperty.call(res.jsonBody.error, 'details'), false);
  });

  it('omits the details key entirely when details is undefined', () => {
    const res = error(500, 'INTERNAL_ERROR', 'Something went wrong', undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(res.jsonBody.error, 'details'), false);
  });

  it('includes details in the error object when provided', () => {
    const details = [{ field: 'email', issue: 'required' }, { field: 'password', issue: 'too_short' }];
    const res = error(422, 'VALIDATION_ERROR', 'Validation failed', details);
    assert.deepEqual(res.jsonBody.error.details, details);
  });

  it('includes details when the value is a plain object', () => {
    const details = { expected: 'string', received: 'number', path: 'body.count' };
    const res = error(400, 'TYPE_ERROR', 'Wrong type', details);
    assert.deepEqual(res.jsonBody.error.details, details);
  });

  it('sets Content-Type to application/json on error responses', () => {
    const res = error(500, 'INTERNAL_ERROR', 'Unexpected failure');
    assert.equal(res.headers['Content-Type'], 'application/json');
  });

  it('produces the correct shape for a 401 Unauthorized response', () => {
    const res = error(401, 'UNAUTHORIZED', 'Invalid credentials');
    assert.deepEqual(res, {
      status: 401,
      jsonBody: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid credentials',
        },
      },
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('produces the correct shape for a 500 with details', () => {
    const res = error(500, 'STORAGE_ERROR', 'Write failed', { table: 'documents', op: 'upsert' });
    assert.deepEqual(res, {
      status: 500,
      jsonBody: {
        error: {
          code: 'STORAGE_ERROR',
          message: 'Write failed',
          details: { table: 'documents', op: 'upsert' },
        },
      },
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
