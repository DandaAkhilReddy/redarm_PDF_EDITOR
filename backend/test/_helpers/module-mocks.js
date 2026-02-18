// backend/test/_helpers/module-mocks.js
// MUST be required BEFORE any source module that imports tables.js or storage.js.
// This replaces those modules in require.cache with controllable mocks.
// Because handler source files destructure at require-time (e.g.
//   const { getUser } = require("../lib/tables");
// ), we use thin wrapper functions that delegate to replaceable inner implementations.

const path = require('path');

// ── Tables mock ──────────────────────────────────────────────────────────────
const tablesPath = require.resolve('../../src/lib/tables');

let _getUser = async () => null;
let _upsertUser = async () => {};
let _getDocument = async () => null;
let _upsertDocument = async () => {};
let _createJob = async () => {};
let _getJob = async () => null;
let _updateJob = async () => {};

const mockTables = {
  isoNow: () => new Date().toISOString(),
  normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
  getUser: async (...a) => _getUser(...a),
  upsertUser: async (...a) => _upsertUser(...a),
  getDocument: async (...a) => _getDocument(...a),
  upsertDocument: async (...a) => _upsertDocument(...a),
  createJob: async (...a) => _createJob(...a),
  getJob: async (...a) => _getJob(...a),
  updateJob: async (...a) => _updateJob(...a),
  ensureTable: async () => {},
  getTableClient: () => ({ createTable: async () => {} }),
};

require.cache[tablesPath] = {
  id: tablesPath,
  filename: tablesPath,
  loaded: true,
  exports: mockTables,
};

// ── Storage mock ─────────────────────────────────────────────────────────────
const storagePath = require.resolve('../../src/lib/storage');

let _ensureContainer = async () => {};
let _buildBlobSasUrl = (container, blob, perms, mins) => ({
  url: `http://mock-sas/${container}/${blob}?sig=mock&perm=${perms}`,
  expiresOn: new Date(Date.now() + (mins || 30) * 60 * 1000).toISOString(),
});
let _uploadJson = async () => {};
let _downloadToBuffer = async () => Buffer.from('mock-pdf-content');
let _uploadBuffer = async () => {};
let _sendQueueMessage = async () => {};

const mockStorage = {
  ensureContainer: async (...a) => _ensureContainer(...a),
  buildBlobSasUrl: (...a) => _buildBlobSasUrl(...a),
  uploadJson: async (...a) => _uploadJson(...a),
  downloadToBuffer: async (...a) => _downloadToBuffer(...a),
  uploadBuffer: async (...a) => _uploadBuffer(...a),
  sendQueueMessage: async (...a) => _sendQueueMessage(...a),
};

require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: mockStorage,
};

// ── Public API ───────────────────────────────────────────────────────────────
module.exports = {
  mockTables,
  mockStorage,

  // Tables setters
  setGetUser(fn)        { _getUser = fn; },
  setUpsertUser(fn)     { _upsertUser = fn; },
  setGetDocument(fn)    { _getDocument = fn; },
  setUpsertDocument(fn) { _upsertDocument = fn; },
  setCreateJob(fn)      { _createJob = fn; },
  setGetJob(fn)         { _getJob = fn; },
  setUpdateJob(fn)      { _updateJob = fn; },

  // Storage setters
  setEnsureContainer(fn)  { _ensureContainer = fn; },
  setBuildBlobSasUrl(fn)  { _buildBlobSasUrl = fn; },
  setUploadJson(fn)       { _uploadJson = fn; },
  setDownloadToBuffer(fn) { _downloadToBuffer = fn; },
  setUploadBuffer(fn)     { _uploadBuffer = fn; },
  setSendQueueMessage(fn) { _sendQueueMessage = fn; },

  // Spy helpers — returns a function that records calls and delegates to impl
  spy(impl = async () => {}) {
    const calls = [];
    const fn = async (...args) => { calls.push(args); return impl(...args); };
    fn.calls = calls;
    return fn;
  },

  resetAll() {
    _getUser = async () => null;
    _upsertUser = async () => {};
    _getDocument = async () => null;
    _upsertDocument = async () => {};
    _createJob = async () => {};
    _getJob = async () => null;
    _updateJob = async () => {};
    _ensureContainer = async () => {};
    _buildBlobSasUrl = (container, blob, perms, mins) => ({
      url: `http://mock-sas/${container}/${blob}?sig=mock&perm=${perms}`,
      expiresOn: new Date(Date.now() + (mins || 30) * 60 * 1000).toISOString(),
    });
    _uploadJson = async () => {};
    _downloadToBuffer = async () => Buffer.from('mock-pdf-content');
    _uploadBuffer = async () => {};
    _sendQueueMessage = async () => {};
  },
};
