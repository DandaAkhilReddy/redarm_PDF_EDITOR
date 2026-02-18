// backend/test/_helpers/mocks.js

/**
 * Creates a mock Azure TableClient with an in-memory store
 */
function createMockTableClient(initialData = {}) {
  const store = new Map();
  // Pre-populate with initial data: { "PARTITION:ROW": entity }
  for (const [key, value] of Object.entries(initialData)) {
    store.set(key, value);
  }

  return {
    createTable: async () => {},
    getEntity: async (partitionKey, rowKey) => {
      const key = `${partitionKey}:${rowKey}`;
      if (!store.has(key)) {
        const err = new Error('Not Found');
        err.statusCode = 404;
        throw err;
      }
      return store.get(key);
    },
    upsertEntity: async (entity, mode) => {
      const key = `${entity.partitionKey}:${entity.rowKey}`;
      if (mode === 'Merge') {
        const existing = store.get(key) || {};
        store.set(key, { ...existing, ...entity });
      } else {
        store.set(key, entity);
      }
    },
    createEntity: async (entity) => {
      const key = `${entity.partitionKey}:${entity.rowKey}`;
      if (store.has(key)) {
        const err = new Error('Conflict');
        err.statusCode = 409;
        throw err;
      }
      store.set(key, entity);
    },
    _store: store // Expose for assertions
  };
}

/**
 * Creates a mock blob container client
 */
function createMockContainerClient(bufferStore = new Map()) {
  return {
    createIfNotExists: async () => {},
    getBlockBlobClient: (blobName) => ({
      upload: async (body, length, options) => {
        bufferStore.set(blobName, { body, length, options });
      },
      uploadData: async (buffer, options) => {
        bufferStore.set(blobName, { buffer, options });
      },
      download: async () => {
        const content = bufferStore.get(blobName)?.buffer || Buffer.from('mock-pdf-content');
        return {
          readableStreamBody: {
            [Symbol.asyncIterator]: async function* () {
              yield content;
            }
          }
        };
      }
    }),
    _store: bufferStore
  };
}

/**
 * Creates a mock queue client
 */
function createMockQueueClient() {
  const messages = [];
  return {
    createIfNotExists: async () => {},
    sendMessage: async (msg) => {
      messages.push(msg);
    },
    _messages: messages
  };
}

/**
 * Creates a mock Azure Functions HTTP request
 */
function createMockRequest({ method = 'POST', body = {}, headers = {}, params = {}, query = {} } = {}) {
  const headerMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }

  return {
    method,
    headers: {
      get: (key) => headerMap.get(key.toLowerCase()) || null,
    },
    params,
    query: new URLSearchParams(query),
    json: async () => {
      if (body === null || body === undefined) throw new Error('Invalid JSON');
      if (typeof body === 'string') return JSON.parse(body);
      return body;
    },
    text: async () => JSON.stringify(body),
  };
}

/**
 * Creates a mock request that throws on .json() — simulates invalid JSON
 */
function createBadJsonRequest({ method = 'POST', headers = {}, params = {} } = {}) {
  const headerMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }
  return {
    method,
    headers: { get: (key) => headerMap.get(key.toLowerCase()) || null },
    params,
    query: new URLSearchParams(),
    json: async () => { throw new SyntaxError('Unexpected token'); },
    text: async () => 'not-json',
  };
}

/**
 * Creates a mock Azure Functions invocation context
 */
function createMockContext() {
  const logs = [];
  return {
    log: (...args) => logs.push({ level: 'info', args }),
    error: (...args) => logs.push({ level: 'error', args }),
    warn: (...args) => logs.push({ level: 'warn', args }),
    invocationId: 'test-invocation-' + Date.now(),
    _logs: logs
  };
}

/**
 * Helper: creates a valid auth header with a real JWT token
 */
function createAuthHeaders(email = 'admin@test.redarm', role = 'admin') {
  // Load setup first to ensure env vars are set
  const { createToken } = require('../../src/lib/auth');
  const token = createToken(email, role);
  return { authorization: `Bearer ${token}` };
}

module.exports = {
  createMockTableClient,
  createMockContainerClient,
  createMockQueueClient,
  createMockRequest,
  createBadJsonRequest,
  createMockContext,
  createAuthHeaders,
};
