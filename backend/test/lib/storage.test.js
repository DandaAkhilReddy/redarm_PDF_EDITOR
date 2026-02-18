// backend/test/lib/storage.test.js
// Tests for backend/src/lib/storage.js
//
// The storage module creates a BlobServiceClient at module load time from the
// connection string, making the network-dependent functions (ensureContainer,
// uploadJson, downloadToBuffer, uploadBuffer, sendQueueMessage) impractical to
// unit-test without a live Azurite instance.
//
// buildBlobSasUrl is a pure computation that signs a token with HMAC-SHA256
// using the account key and never touches the network, making it fully
// testable here.

require('../_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---- module load -------------------------------------------------------
// setup.js sets STORAGE_CONNECTION_STRING (with 127.0.0.1) before this require,
// so config.js and storage.js will not throw on load.
const storage = require('../../src/lib/storage');

// ---- helpers -----------------------------------------------------------
const CONTAINER = 'pdf-source';
const BLOB = 'uploads/test-doc.pdf';

// ---- tests -------------------------------------------------------------

describe('storage module', () => {

  describe('exports', () => {
    it('exports ensureContainer as a function', () => {
      assert.equal(typeof storage.ensureContainer, 'function');
    });

    it('exports buildBlobSasUrl as a function', () => {
      assert.equal(typeof storage.buildBlobSasUrl, 'function');
    });

    it('exports uploadJson as a function', () => {
      assert.equal(typeof storage.uploadJson, 'function');
    });

    it('exports downloadToBuffer as a function', () => {
      assert.equal(typeof storage.downloadToBuffer, 'function');
    });

    it('exports uploadBuffer as a function', () => {
      assert.equal(typeof storage.uploadBuffer, 'function');
    });

    it('exports sendQueueMessage as a function', () => {
      assert.equal(typeof storage.sendQueueMessage, 'function');
    });
  });

  describe('buildBlobSasUrl', () => {

    it('returns an object with url and expiresOn properties', () => {
      const result = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(result !== null && typeof result === 'object',
        'result should be an object');
      assert.ok(Object.prototype.hasOwnProperty.call(result, 'url'),
        'result should have a url property');
      assert.ok(Object.prototype.hasOwnProperty.call(result, 'expiresOn'),
        'result should have an expiresOn property');
    });

    it('url is a non-empty string', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.equal(typeof url, 'string');
      assert.ok(url.length > 0, 'url must not be empty');
    });

    it('url contains the container name', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(url.includes(CONTAINER),
        `url "${url}" should contain container name "${CONTAINER}"`);
    });

    it('url contains the blob name', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      // The blob name may be percent-encoded, but the segments should be present.
      // Simple check: both path segments appear in the url.
      assert.ok(url.includes('uploads') && url.includes('test-doc.pdf'),
        `url "${url}" should contain blob path segments`);
    });

    it('url starts with http://127.0.0.1:10000 for local dev connection string', () => {
      // setup.js injects a connection string that contains 127.0.0.1 —
      // storage.js detects this and builds a local-emulator URL.
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(url.startsWith('http://127.0.0.1:10000'),
        `url "${url}" should start with http://127.0.0.1:10000 for local dev`);
    });

    it('url contains the storage account name', () => {
      // setup.js sets STORAGE_ACCOUNT_NAME=devstoreaccount1
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(url.includes('devstoreaccount1'),
        `url "${url}" should contain the account name "devstoreaccount1"`);
    });

    it('url contains a SAS token (sig= query parameter)', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(url.includes('sig='),
        `url "${url}" should contain a sig= SAS signature parameter`);
    });

    it('url contains an se= (signed expiry) query parameter', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.ok(url.includes('se='),
        `url "${url}" should contain an se= signed expiry parameter`);
    });

    it('expiresOn is a valid ISO 8601 date string', () => {
      const { expiresOn } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      assert.equal(typeof expiresOn, 'string',
        'expiresOn should be a string');
      const parsed = new Date(expiresOn);
      assert.ok(!Number.isNaN(parsed.getTime()),
        `expiresOn "${expiresOn}" should parse to a valid Date`);
      // A round-tripped ISO string keeps the same millisecond value.
      assert.equal(parsed.toISOString(), expiresOn,
        'expiresOn should be a canonical ISO 8601 string');
    });

    it('expiresOn is in the future', () => {
      const before = Date.now();
      const { expiresOn } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      const expiresMs = new Date(expiresOn).getTime();
      assert.ok(expiresMs > before,
        `expiresOn (${expiresOn}) should be in the future`);
    });

    it('expiresOn defaults to ~30 minutes from now', () => {
      const before = Date.now();
      const { expiresOn } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      const after = Date.now();
      const expiresMs = new Date(expiresOn).getTime();
      const expectedMin = before + 29 * 60 * 1000; // 29 min lower bound
      const expectedMax = after  + 31 * 60 * 1000; // 31 min upper bound
      assert.ok(expiresMs >= expectedMin && expiresMs <= expectedMax,
        `expiresOn (${expiresOn}) should be approximately 30 min from now`);
    });

    it('custom expiresInMinutes shifts the expiry accordingly', () => {
      const before = Date.now();
      const { expiresOn } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r', 120);
      const after = Date.now();
      const expiresMs = new Date(expiresOn).getTime();
      const expectedMin = before + 119 * 60 * 1000;
      const expectedMax = after  + 121 * 60 * 1000;
      assert.ok(expiresMs >= expectedMin && expiresMs <= expectedMax,
        `expiresOn (${expiresOn}) should be approximately 120 min from now`);
    });

    it('read-only permission "r" produces a url with sp=r in the SAS token', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'r');
      // The Azure SDK encodes the permission as the sp= query param.
      assert.ok(url.includes('sp=r'),
        `url "${url}" should contain sp=r for read-only permission`);
    });

    it('create+write permission "cw" produces a url with sp=cw in the SAS token', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'cw');
      assert.ok(url.includes('sp=cw'),
        `url "${url}" should contain sp=cw for create+write permissions`);
    });

    it('read+create+write permission "rcw" produces a url with sp=rcw in the SAS token', () => {
      const { url } = storage.buildBlobSasUrl(CONTAINER, BLOB, 'rcw');
      assert.ok(url.includes('sp=rcw'),
        `url "${url}" should contain sp=rcw for read+create+write permissions`);
    });

    it('different containers produce different urls', () => {
      const { url: url1 } = storage.buildBlobSasUrl('pdf-source',  BLOB, 'r');
      const { url: url2 } = storage.buildBlobSasUrl('pdf-export',  BLOB, 'r');
      // The container segment differs, so the full urls must differ.
      assert.notEqual(url1, url2,
        'urls for different containers should not be identical');
      assert.ok(url1.includes('pdf-source'),  'url1 should reference pdf-source');
      assert.ok(url2.includes('pdf-export'),  'url2 should reference pdf-export');
    });

    it('different blob names produce different urls', () => {
      const { url: url1 } = storage.buildBlobSasUrl(CONTAINER, 'a/file-a.pdf', 'r');
      const { url: url2 } = storage.buildBlobSasUrl(CONTAINER, 'b/file-b.pdf', 'r');
      assert.notEqual(url1, url2,
        'urls for different blob names should not be identical');
    });
  });

  describe('async function signatures', () => {
    // Verify async functions without making real network calls (no Azurite needed)
    it('ensureContainer is an AsyncFunction', () => {
      assert.equal(storage.ensureContainer.constructor.name, 'AsyncFunction',
        'ensureContainer should be an async function');
    });

    it('sendQueueMessage is an AsyncFunction', () => {
      assert.equal(storage.sendQueueMessage.constructor.name, 'AsyncFunction',
        'sendQueueMessage should be an async function');
    });

    it('uploadJson is an AsyncFunction', () => {
      assert.equal(storage.uploadJson.constructor.name, 'AsyncFunction',
        'uploadJson should be an async function');
    });

    it('downloadToBuffer is an AsyncFunction', () => {
      assert.equal(storage.downloadToBuffer.constructor.name, 'AsyncFunction',
        'downloadToBuffer should be an async function');
    });

    it('uploadBuffer is an AsyncFunction', () => {
      assert.equal(storage.uploadBuffer.constructor.name, 'AsyncFunction',
        'uploadBuffer should be an async function');
    });
  });
});
