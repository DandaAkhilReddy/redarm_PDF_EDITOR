// backend/test/lib/utils.test.js
require('../_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFileName, decodeQueueMessage } = require('../../src/lib/utils');

// ---------------------------------------------------------------------------
// sanitizeFileName
// ---------------------------------------------------------------------------

describe('sanitizeFileName', () => {
  it('preserves a normal alphanumeric filename unchanged', () => {
    const result = sanitizeFileName('report2024.pdf');
    assert.equal(result, 'report2024.pdf');
  });

  it('preserves dots and hyphens as valid characters', () => {
    const result = sanitizeFileName('my-document.v2.pdf');
    assert.equal(result, 'my-document.v2.pdf');
  });

  it('replaces spaces and special chars with a single dash', () => {
    const result = sanitizeFileName('hello world!.pdf');
    assert.equal(result, 'hello-world-.pdf');
  });

  it('collapses multiple consecutive special chars into one dash', () => {
    // "file   name" — three spaces should become one dash
    const result = sanitizeFileName('file   name.pdf');
    assert.equal(result, 'file-name.pdf');
  });

  it('removes a leading dash produced by a leading special char', () => {
    // Input starts with "@" which maps to "-", which must then be stripped
    const result = sanitizeFileName('@secret.pdf');
    assert.equal(result, 'secret.pdf');
  });

  it('removes a trailing dash produced by a trailing special char', () => {
    // Input ends with "!" which maps to "-", which must then be stripped
    const result = sanitizeFileName('document!');
    assert.equal(result, 'document');
  });

  it('defaults to "source.pdf" for null', () => {
    const result = sanitizeFileName(null);
    assert.equal(result, 'source.pdf');
  });

  it('defaults to "source.pdf" for undefined', () => {
    const result = sanitizeFileName(undefined);
    assert.equal(result, 'source.pdf');
  });

  it('defaults to "source.pdf" for an empty string', () => {
    // Empty string is falsy → same default path as null/undefined
    const result = sanitizeFileName('');
    assert.equal(result, 'source.pdf');
  });

  it('truncates the output to a maximum of 120 characters', () => {
    // Build a name that will still be all-valid after sanitization (no replacements),
    // so we can verify slice(0, 120) is applied.
    const longName = 'a'.repeat(200) + '.pdf';
    const result = sanitizeFileName(longName);
    assert.equal(result.length, 120);
  });

  it('coerces a non-string truthy value via String()', () => {
    // Numbers must be accepted; String(42) = "42"
    const result = sanitizeFileName(42);
    assert.equal(result, '42');
  });
});

// ---------------------------------------------------------------------------
// decodeQueueMessage
// ---------------------------------------------------------------------------

describe('decodeQueueMessage', () => {
  it('parses a plain JSON string directly', () => {
    const payload = { jobId: 'abc', type: 'export' };
    const result = decodeQueueMessage(JSON.stringify(payload));
    assert.deepEqual(result, payload);
  });

  it('parses a base64-encoded JSON string', () => {
    const payload = { jobId: 'xyz', type: 'ocr' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const result = decodeQueueMessage(encoded);
    assert.deepEqual(result, payload);
  });

  it('returns an empty object for a non-JSON, non-base64 string', () => {
    // A plain word that is not valid JSON and decodes to gibberish base64
    const result = decodeQueueMessage('not-valid-json-or-base64!!!!');
    assert.deepEqual(result, {});
  });

  it('returns an empty object for an empty string', () => {
    const result = decodeQueueMessage('');
    assert.deepEqual(result, {});
  });

  it('parses a Buffer containing valid JSON', () => {
    const payload = { docId: 'doc-001', page: 3 };
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    const result = decodeQueueMessage(buf);
    assert.deepEqual(result, payload);
  });

  it('returns an empty object for a Buffer containing non-JSON bytes', () => {
    const buf = Buffer.from('this is not json', 'utf8');
    const result = decodeQueueMessage(buf);
    assert.deepEqual(result, {});
  });

  it('returns the object as-is when passed a plain object', () => {
    const payload = { docId: 'doc-002', action: 'save' };
    const result = decodeQueueMessage(payload);
    assert.deepEqual(result, payload);
  });

  it('returns an empty object for null', () => {
    const result = decodeQueueMessage(null);
    assert.deepEqual(result, {});
  });

  it('returns an empty object for undefined', () => {
    const result = decodeQueueMessage(undefined);
    assert.deepEqual(result, {});
  });
});
