// backend/test/functions/authLogin.test.js
// Tests for POST /api/auth/login — backend/src/functions/authLogin.js
//
// Strategy: intercept app.http() registration before requiring the source module
// so we can capture the raw handler function for unit testing without a live
// Azure Functions runtime or a real storage back-end.

require('../_helpers/setup');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { createMockRequest, createBadJsonRequest, createMockContext } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Capture the handler registered by authLogin.js
// ---------------------------------------------------------------------------
let capturedHandler;

const realFunctions = require('@azure/functions');
const originalHttp = realFunctions.app.http;

realFunctions.app.http = function (name, options) {
  if (name === 'auth-login') {
    capturedHandler = options.handler;
  }
  // Call original so other registrations are unaffected
  return originalHttp.call(this, name, options);
};

// Require the source AFTER the intercept is wired up.
// Node's module cache means this only runs once per process, which is fine —
// capturedHandler is assigned synchronously during require().
require('../../src/functions/authLogin');

// Restore the original immediately so later requires are unaffected.
realFunctions.app.http = originalHttp;

assert.ok(capturedHandler, 'authLogin handler was not captured — check registration name');

// ---------------------------------------------------------------------------
// Mock tables.js so tests never touch real Azure Storage
// ---------------------------------------------------------------------------
const tables = require('../../src/lib/tables');

// Pre-hashed passwords (BCRYPT_ROUNDS=4 from setup.js for speed)
const BCRYPT_ROUNDS = 4;
const VALID_PASSWORD = 'CorrectHorseBatteryStaple!';
let VALID_HASH; // populated in beforeEach via bcrypt.hash

// Helper — replaces tables.getUser with a function returning `returnValue`
function mockGetUser(returnValue) {
  tables.getUser = async () => returnValue;
}

// Helper — replaces tables.upsertUser with a spy that records calls
function mockUpsertUser() {
  const calls = [];
  tables.upsertUser = async (entity) => {
    calls.push({ ...entity });
  };
  return calls;
}

// Store originals for restoration
const origGetUser = tables.getUser;
const origUpsertUser = tables.upsertUser;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the captured handler and return its result */
async function login(body, ctx) {
  const req = createMockRequest({ body });
  const context = ctx || createMockContext();
  return capturedHandler(req, context);
}

async function loginBadJson(ctx) {
  const req = createBadJsonRequest();
  const context = ctx || createMockContext();
  return capturedHandler(req, context);
}

function makeLockedUser(email, hash) {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hr from now
  return {
    email,
    passwordHash: hash,
    role: 'user',
    failedAttempts: 0,
    lockedUntil: futureDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeUser(email, hash, overrides = {}) {
  return {
    email,
    passwordHash: hash,
    role: 'user',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  // Hash once before the suite to avoid repeated async work
  let validHash;
  beforeEach(async () => {
    // Restore originals before each test to avoid state leak
    tables.getUser = origGetUser;
    tables.upsertUser = origUpsertUser;

    if (!validHash) {
      validHash = await bcrypt.hash(VALID_PASSWORD, BCRYPT_ROUNDS);
    }
    VALID_HASH = validHash;
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it('returns 400 for invalid JSON body', async () => {
    const res = await loginBadJson();
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'invalid_json');
  });

  it('returns 400 when email is missing', async () => {
    mockGetUser(null);
    const res = await login({ password: VALID_PASSWORD });
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.match(res.jsonBody.error.message, /email and password/i);
  });

  it('returns 400 when password is missing', async () => {
    mockGetUser(null);
    const res = await login({ email: 'user@example.com' });
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.match(res.jsonBody.error.message, /email and password/i);
  });

  it('returns 400 when both email and password are missing', async () => {
    mockGetUser(null);
    const res = await login({});
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
  });

  it('returns 400 when password exceeds 256 characters', async () => {
    mockGetUser(null);
    const longPassword = 'A'.repeat(257);
    const res = await login({ email: 'user@example.com', password: longPassword });
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error.code, 'validation_error');
    assert.match(res.jsonBody.error.message, /too long/i);
  });

  it('accepts a password that is exactly 256 characters (boundary)', async () => {
    // Should NOT get a 400 for length — may get 401 for bad credentials, which is fine
    mockGetUser(makeUser('boundary@example.com', VALID_HASH));
    mockUpsertUser();
    const exactPassword = 'B'.repeat(256);
    const wrongHash = await bcrypt.hash('differentpassword', BCRYPT_ROUNDS);
    tables.getUser = async () => makeUser('boundary@example.com', wrongHash);
    const upsertCalls = mockUpsertUser();
    const res = await login({ email: 'boundary@example.com', password: exactPassword });
    // Not a 400 validation error — must be 401 (wrong pw) or 200 (coincidental match)
    assert.notEqual(res.status, 400, 'Should not fail with validation_error for 256-char password');
    void upsertCalls; // suppress unused var warning
  });

  // -------------------------------------------------------------------------
  // Unknown user / bootstrap
  // -------------------------------------------------------------------------

  it('returns 401 for unknown user that is not the bootstrap email', async () => {
    tables.getUser = async () => null;
    const res = await login({ email: 'unknown@nowhere.com', password: VALID_PASSWORD });
    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'invalid_credentials');
  });

  it('creates bootstrap user and returns 200 with token for bootstrap email', async () => {
    // First call (getUser inside handler): null — user does not exist yet
    // Second call (getUser inside ensureBootstrapUser): null — triggers creation
    // Third call (getUser at end of ensureBootstrapUser): return a user
    const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL; // 'admin@test.redarm'
    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD; // 'TestPassword123!'
    const bootstrapHash = await bcrypt.hash(bootstrapPassword, BCRYPT_ROUNDS);
    const bootstrapUser = makeUser(bootstrapEmail, bootstrapHash, { role: 'admin' });

    let callCount = 0;
    tables.getUser = async () => {
      callCount += 1;
      if (callCount <= 2) return null; // handler + ensureBootstrapUser first lookup
      return bootstrapUser;            // ensureBootstrapUser final getUser
    };
    mockUpsertUser();

    const res = await login({ email: bootstrapEmail, password: bootstrapPassword });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.jsonBody)}`);
    assert.ok(res.jsonBody.accessToken, 'Response must include accessToken');
  });

  // -------------------------------------------------------------------------
  // Successful login
  // -------------------------------------------------------------------------

  it('returns 200 with JWT for valid credentials', async () => {
    tables.getUser = async () => makeUser('alice@example.com', VALID_HASH);
    mockUpsertUser();

    const res = await login({ email: 'alice@example.com', password: VALID_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.jsonBody.accessToken);
  });

  it('response includes accessToken, expiresIn, user.email and user.role', async () => {
    const email = 'bob@example.com';
    tables.getUser = async () => makeUser(email, VALID_HASH, { role: 'editor' });
    mockUpsertUser();

    const res = await login({ email, password: VALID_PASSWORD });
    assert.equal(res.status, 200);

    const body = res.jsonBody;
    assert.ok(body.accessToken, 'accessToken must be present');
    assert.ok(body.expiresIn, 'expiresIn must be present');
    assert.ok(body.user, 'user object must be present');
    assert.equal(body.user.email, email);
    assert.equal(body.user.role, 'editor');
  });

  it('accessToken is a non-empty string (JWT format)', async () => {
    tables.getUser = async () => makeUser('carol@example.com', VALID_HASH);
    mockUpsertUser();

    const res = await login({ email: 'carol@example.com', password: VALID_PASSWORD });
    assert.equal(res.status, 200);

    const { accessToken } = res.jsonBody;
    assert.equal(typeof accessToken, 'string');
    // JWTs have exactly 3 dot-separated segments
    const parts = accessToken.split('.');
    assert.equal(parts.length, 3, 'accessToken should be a 3-segment JWT');
  });

  // -------------------------------------------------------------------------
  // Lockout
  // -------------------------------------------------------------------------

  it('returns 423 for a locked account', async () => {
    tables.getUser = async () => makeLockedUser('locked@example.com', VALID_HASH);
    mockUpsertUser();

    const res = await login({ email: 'locked@example.com', password: VALID_PASSWORD });
    assert.equal(res.status, 423);
    assert.equal(res.jsonBody.error.code, 'account_locked');
  });

  it('does not lock an account whose lockedUntil is in the past', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    const user = makeUser('expired-lock@example.com', VALID_HASH, { lockedUntil: pastDate });
    tables.getUser = async () => user;
    mockUpsertUser();

    const res = await login({ email: 'expired-lock@example.com', password: VALID_PASSWORD });
    // Should proceed past lockout check — 200 if password matches
    assert.equal(res.status, 200);
  });

  // -------------------------------------------------------------------------
  // Failed attempts & locking logic
  // -------------------------------------------------------------------------

  it('increments failedAttempts on wrong password', async () => {
    const user = makeUser('dave@example.com', VALID_HASH, { failedAttempts: 1 });
    tables.getUser = async () => user;
    const upsertCalls = mockUpsertUser();

    const res = await login({ email: 'dave@example.com', password: 'WrongPassword!' });
    assert.equal(res.status, 401);
    assert.equal(res.jsonBody.error.code, 'invalid_credentials');

    // upsertUser should have been called with incremented failedAttempts
    assert.ok(upsertCalls.length > 0, 'upsertUser must be called after failed attempt');
    const patch = upsertCalls[0];
    assert.equal(patch.failedAttempts, 2, 'failedAttempts should be incremented to 2');
  });

  it('locks account when failedAttempts reaches lockout threshold (5)', async () => {
    // LOCKOUT_THRESHOLD=5 from setup.js — 4 prior failures → this is the 5th
    const user = makeUser('eve@example.com', VALID_HASH, { failedAttempts: 4 });
    tables.getUser = async () => user;
    const upsertCalls = mockUpsertUser();

    const res = await login({ email: 'eve@example.com', password: 'WrongPassword!' });
    assert.equal(res.status, 401);

    const patch = upsertCalls[0];
    assert.ok(patch.lockedUntil, 'lockedUntil should be set when threshold is reached');
    // After lock, failedAttempts resets to 0
    assert.equal(patch.failedAttempts, 0, 'failedAttempts should reset to 0 after locking');

    // lockedUntil should be in the future
    const lockedUntil = new Date(patch.lockedUntil);
    assert.ok(lockedUntil > new Date(), 'lockedUntil should be a future timestamp');
  });

  it('resets failedAttempts and clears lockedUntil on successful login', async () => {
    const user = makeUser('frank@example.com', VALID_HASH, { failedAttempts: 3, lockedUntil: null });
    tables.getUser = async () => user;
    const upsertCalls = mockUpsertUser();

    const res = await login({ email: 'frank@example.com', password: VALID_PASSWORD });
    assert.equal(res.status, 200);

    const patch = upsertCalls[0];
    assert.equal(patch.failedAttempts, 0, 'failedAttempts must be reset to 0 on success');
    assert.equal(patch.lockedUntil, null, 'lockedUntil must be cleared on success');
  });

  // -------------------------------------------------------------------------
  // Email normalisation
  // -------------------------------------------------------------------------

  it('normalises email to lowercase and trimmed before lookup', async () => {
    let receivedEmail;
    tables.getUser = async (email) => {
      receivedEmail = email;
      return makeUser('grace@example.com', VALID_HASH);
    };
    mockUpsertUser();

    await login({ email: '  Grace@EXAMPLE.COM  ', password: VALID_PASSWORD });
    assert.equal(receivedEmail, 'grace@example.com', 'Email passed to getUser must be lowercased and trimmed');
  });

  it('returned user.email in response is normalised (lowercase)', async () => {
    tables.getUser = async () => makeUser('heidi@example.com', VALID_HASH);
    mockUpsertUser();

    const res = await login({ email: 'HEIDI@EXAMPLE.COM', password: VALID_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.user.email, 'heidi@example.com');
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  it('calls context.log on successful authentication', async () => {
    tables.getUser = async () => makeUser('ivan@example.com', VALID_HASH);
    mockUpsertUser();

    const ctx = createMockContext();
    const res = await login({ email: 'ivan@example.com', password: VALID_PASSWORD }, ctx);
    assert.equal(res.status, 200);

    assert.ok(ctx._logs.length > 0, 'context.log should be called at least once on success');

    const infoLogs = ctx._logs.filter(l => l.level === 'info');
    assert.ok(infoLogs.length > 0, 'At least one info log should be emitted');

    const logText = infoLogs.map(l => l.args.join(' ')).join(' ');
    assert.match(logText, /ivan@example\.com/, 'Log message should contain the authenticated email');
  });
});
