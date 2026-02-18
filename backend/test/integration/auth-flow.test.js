// backend/test/integration/auth-flow.test.js
// Integration tests for the complete authentication flow.
//
// These tests exercise the real handler functions end-to-end: login, token
// extraction, and use of that token against protected endpoints. The only
// things mocked are the storage/table back-ends (via module-mocks.js).

// 1. Env vars -- MUST be loaded before any source module that reads config.js
require('../_helpers/setup');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// 2. Module mocks -- MUST be before any src/ require
const mm = require('../_helpers/module-mocks');

// 3. Test helpers
const { createMockRequest, createMockContext } = require('../_helpers/mocks');
const { createToken } = require('../../src/lib/auth');

// ---------------------------------------------------------------------------
// Capture handlers by intercepting app.http() registrations
// ---------------------------------------------------------------------------
let loginHandler;
let uploadUrlHandler;
let saveAnnotationHandler;

const realFunctions = require('@azure/functions');
const originalHttp = realFunctions.app.http;

realFunctions.app.http = function (name, options) {
  if (name === 'auth-login') {
    loginHandler = options.handler;
  } else if (name === 'docs-upload-url') {
    uploadUrlHandler = options.handler;
  } else if (name === 'docs-save-annotation') {
    saveAnnotationHandler = options.handler;
  }
  return originalHttp.call(this, name, options);
};

// 4. Load handler modules AFTER mocks and intercept are wired up
require('../../src/functions/authLogin');
require('../../src/functions/docsUploadUrl');
require('../../src/functions/docsSaveAnnotation');

// Restore original immediately
realFunctions.app.http = originalHttp;

assert.ok(loginHandler, 'authLogin handler was not captured');
assert.ok(uploadUrlHandler, 'docsUploadUrl handler was not captured');
assert.ok(saveAnnotationHandler, 'docsSaveAnnotation handler was not captured');

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------
const BCRYPT_ROUNDS = 4;
const BOOTSTRAP_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;   // 'admin@test.redarm'
const BOOTSTRAP_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD; // 'TestPassword123!'
const LOCKOUT_THRESHOLD = 5; // from setup.js

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

/** Perform a login via the captured handler and return the response */
async function doLogin(body) {
  const req = createMockRequest({ body });
  const ctx = createMockContext();
  return loginHandler(req, ctx);
}

/** Call the upload-url handler with given auth headers and body */
async function doUploadUrl(headers, body) {
  const req = createMockRequest({ method: 'POST', headers, body });
  const ctx = createMockContext();
  return uploadUrlHandler(req, ctx);
}

/** Call the save-annotation handler with given auth headers, params, and body */
async function doSaveAnnotation(headers, params, body) {
  const req = createMockRequest({ method: 'POST', headers, params, body });
  const ctx = createMockContext();
  return saveAnnotationHandler(req, ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Auth Flow', () => {
  let validHash;

  beforeEach(async () => {
    mm.resetAll();

    if (!validHash) {
      validHash = await bcrypt.hash(BOOTSTRAP_PASSWORD, BCRYPT_ROUNDS);
    }
  });

  // -----------------------------------------------------------------------
  // 1. Login -> token -> authenticated request
  // -----------------------------------------------------------------------
  it('login produces a JWT that authenticates against a protected endpoint', async () => {
    // Setup: user exists in the mock table
    mm.setGetUser(async () => makeUser(BOOTSTRAP_EMAIL, validHash, { role: 'admin' }));
    mm.setUpsertUser(mm.spy());
    mm.setUpsertDocument(mm.spy());

    // Step 1: Login
    const loginRes = await doLogin({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD });
    assert.equal(loginRes.status, 200, 'Login should succeed');
    const token = loginRes.jsonBody.accessToken;
    assert.ok(token, 'Login response must include accessToken');

    // Step 2: Use the token against a protected endpoint (docs/upload-url)
    const uploadRes = await doUploadUrl(
      { authorization: `Bearer ${token}` },
      { fileName: 'test.pdf', contentType: 'application/pdf' }
    );
    assert.equal(uploadRes.status, 200, 'Protected endpoint should accept the login token');
    assert.ok(uploadRes.jsonBody.docId, 'Upload response should include docId');
    assert.ok(uploadRes.jsonBody.sasUrl, 'Upload response should include sasUrl');
  });

  // -----------------------------------------------------------------------
  // 2. Login -> use token -> verify user identity
  // -----------------------------------------------------------------------
  it('protected endpoint receives the correct user email from the token', async () => {
    const email = 'verify-identity@test.redarm';
    const hash = await bcrypt.hash('SomePassword1!', BCRYPT_ROUNDS);

    mm.setGetUser(async () => makeUser(email, hash, { role: 'editor' }));
    mm.setUpsertUser(mm.spy());

    // Spy on upsertDocument to capture what the handler receives as the owner
    const docSpy = mm.spy();
    mm.setUpsertDocument(docSpy);

    // Login
    const loginRes = await doLogin({ email, password: 'SomePassword1!' });
    assert.equal(loginRes.status, 200);
    const token = loginRes.jsonBody.accessToken;

    // Call protected endpoint
    const uploadRes = await doUploadUrl(
      { authorization: `Bearer ${token}` },
      { fileName: 'identity-check.pdf', contentType: 'application/pdf' }
    );
    assert.equal(uploadRes.status, 200);

    // Verify the handler stored the correct ownerEmail from the token
    assert.ok(docSpy.calls.length > 0, 'upsertDocument must have been called');
    const savedDoc = docSpy.calls[0][0];
    assert.equal(savedDoc.ownerEmail, email, 'ownerEmail should match the logged-in user');
  });

  // -----------------------------------------------------------------------
  // 3. Invalid credentials -> retry with valid -> success
  // -----------------------------------------------------------------------
  it('failed login then successful login on retry', async () => {
    const email = 'retry-user@test.redarm';
    const correctPassword = 'CorrectPassword1!';
    const hash = await bcrypt.hash(correctPassword, BCRYPT_ROUNDS);

    mm.setGetUser(async () => makeUser(email, hash));
    mm.setUpsertUser(mm.spy());

    // Attempt 1: wrong password -> 401
    const badRes = await doLogin({ email, password: 'WrongPassword!' });
    assert.equal(badRes.status, 401, 'Wrong password should return 401');
    assert.equal(badRes.jsonBody.error.code, 'invalid_credentials');

    // Attempt 2: correct password -> 200
    const goodRes = await doLogin({ email, password: correctPassword });
    assert.equal(goodRes.status, 200, 'Correct password should return 200');
    assert.ok(goodRes.jsonBody.accessToken, 'Successful login must return a token');
  });

  // -----------------------------------------------------------------------
  // 4. Account lockout flow
  // -----------------------------------------------------------------------
  it('locks account after 5 failed attempts, then rejects even correct password', async () => {
    const email = 'lockout-user@test.redarm';
    const correctPassword = 'LockoutTest1!';
    const hash = await bcrypt.hash(correctPassword, BCRYPT_ROUNDS);

    // Track the user's state across login attempts
    let currentUser = makeUser(email, hash, { failedAttempts: 0 });

    mm.setGetUser(async () => ({ ...currentUser }));
    mm.setUpsertUser(async (patch) => {
      // Apply the patch the handler sends, simulating a real table merge
      currentUser = { ...currentUser, ...patch };
    });

    // Make LOCKOUT_THRESHOLD (5) bad login attempts
    for (let i = 1; i <= LOCKOUT_THRESHOLD; i++) {
      const res = await doLogin({ email, password: 'WrongPassword!' });
      // All should be 401 (invalid credentials) -- the lock kicks in on the 5th
      assert.equal(res.status, 401, `Attempt ${i} should return 401`);
    }

    // The 5th attempt should have set lockedUntil in the future
    assert.ok(currentUser.lockedUntil, 'lockedUntil should be set after reaching lockout threshold');
    const lockedUntil = new Date(currentUser.lockedUntil);
    assert.ok(lockedUntil > new Date(), 'lockedUntil should be in the future');

    // Now even the correct password should return 423 (locked)
    const lockedRes = await doLogin({ email, password: correctPassword });
    assert.equal(lockedRes.status, 423, 'Correct password should still return 423 while locked');
    assert.equal(lockedRes.jsonBody.error.code, 'account_locked');
  });

  // -----------------------------------------------------------------------
  // 5. Lockout recovery after expiry
  // -----------------------------------------------------------------------
  it('allows login after lockout period expires', async () => {
    const email = 'lockout-recovery@test.redarm';
    const correctPassword = 'RecoveryTest1!';
    const hash = await bcrypt.hash(correctPassword, BCRYPT_ROUNDS);

    // Track the user's state across login attempts
    let currentUser = makeUser(email, hash, { failedAttempts: 0 });

    mm.setGetUser(async () => ({ ...currentUser }));
    mm.setUpsertUser(async (patch) => {
      currentUser = { ...currentUser, ...patch };
    });

    // Lock the account by making LOCKOUT_THRESHOLD bad attempts
    for (let i = 1; i <= LOCKOUT_THRESHOLD; i++) {
      await doLogin({ email, password: 'WrongPassword!' });
    }

    // Verify locked
    assert.ok(currentUser.lockedUntil, 'Account should be locked');
    const lockedRes = await doLogin({ email, password: correctPassword });
    assert.equal(lockedRes.status, 423, 'Should be locked');

    // Simulate lock expiry: set lockedUntil to the past
    currentUser.lockedUntil = new Date(Date.now() - 60 * 1000).toISOString();

    // Now login should succeed again
    const recoveryRes = await doLogin({ email, password: correctPassword });
    assert.equal(recoveryRes.status, 200, 'Login should succeed after lock expires');
    assert.ok(recoveryRes.jsonBody.accessToken, 'Should receive a token after recovery');
  });

  // -----------------------------------------------------------------------
  // 6. Cross-user isolation
  // -----------------------------------------------------------------------
  it('user B cannot access user A\'s document', async () => {
    const emailA = 'usera@test.redarm';
    const emailB = 'userb@test.redarm';
    const passwordA = 'PasswordA1!';
    const passwordB = 'PasswordB1!';
    const hashA = await bcrypt.hash(passwordA, BCRYPT_ROUNDS);
    const hashB = await bcrypt.hash(passwordB, BCRYPT_ROUNDS);

    // User lookup by email
    mm.setGetUser(async (email) => {
      if (email === emailA) return makeUser(emailA, hashA, { role: 'user' });
      if (email === emailB) return makeUser(emailB, hashB, { role: 'user' });
      return null;
    });
    mm.setUpsertUser(mm.spy());
    mm.setUpsertDocument(mm.spy());

    // Login as user A
    const loginA = await doLogin({ email: emailA, password: passwordA });
    assert.equal(loginA.status, 200);
    const tokenA = loginA.jsonBody.accessToken;

    // Login as user B
    const loginB = await doLogin({ email: emailB, password: passwordB });
    assert.equal(loginB.status, 200);
    const tokenB = loginB.jsonBody.accessToken;

    // Create a document owned by user A
    const docId = 'doc-owned-by-a';
    mm.setGetDocument(async (id) => {
      if (id === docId) {
        return {
          docId,
          ownerEmail: emailA,
          title: 'private.pdf',
          annotationJson: '{}',
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return null;
    });

    // User A can access their own document
    const resA = await doSaveAnnotation(
      { authorization: `Bearer ${tokenA}` },
      { docId },
      { operations: [{ type: 'highlight', page: 1 }] }
    );
    assert.equal(resA.status, 200, 'User A should access their own document');

    // User B tries to access user A's document -> 403
    const resB = await doSaveAnnotation(
      { authorization: `Bearer ${tokenB}` },
      { docId },
      { operations: [{ type: 'highlight', page: 1 }] }
    );
    assert.equal(resB.status, 403, 'User B should be denied access to User A\'s document');
    assert.equal(resB.jsonBody.error.code, 'forbidden');
  });

  // -----------------------------------------------------------------------
  // 7. Token expiry / tampering
  // -----------------------------------------------------------------------
  it('tampered token is rejected by protected endpoints', async () => {
    const email = 'tamper-test@test.redarm';
    const password = 'TamperTest1!';
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    mm.setGetUser(async () => makeUser(email, hash));
    mm.setUpsertUser(mm.spy());

    // Login to get a valid token
    const loginRes = await doLogin({ email, password });
    assert.equal(loginRes.status, 200);
    const validToken = loginRes.jsonBody.accessToken;

    // Verify the valid token works
    mm.setUpsertDocument(mm.spy());
    const goodRes = await doUploadUrl(
      { authorization: `Bearer ${validToken}` },
      { fileName: 'ok.pdf', contentType: 'application/pdf' }
    );
    assert.equal(goodRes.status, 200, 'Valid token should work');

    // Tamper with the token: flip a character in the signature (last segment)
    const parts = validToken.split('.');
    const signature = parts[2];
    const flippedChar = signature[0] === 'A' ? 'B' : 'A';
    parts[2] = flippedChar + signature.slice(1);
    const tamperedToken = parts.join('.');

    const badRes = await doUploadUrl(
      { authorization: `Bearer ${tamperedToken}` },
      { fileName: 'should-fail.pdf', contentType: 'application/pdf' }
    );
    assert.equal(badRes.status, 401, 'Tampered token should be rejected with 401');
    assert.equal(badRes.jsonBody.error.code, 'unauthorized');
  });

  // -----------------------------------------------------------------------
  // 8. Email normalisation across auth flow
  // -----------------------------------------------------------------------
  it('mixed-case email is normalised throughout the auth flow', async () => {
    const normalizedEmail = BOOTSTRAP_EMAIL; // 'admin@test.redarm'

    // Track what getUser receives
    const getUserCalls = [];
    mm.setGetUser(async (email) => {
      getUserCalls.push(email);
      if (email === normalizedEmail) {
        return makeUser(normalizedEmail, validHash, { role: 'admin' });
      }
      return null;
    });
    mm.setUpsertUser(mm.spy());

    // Login with mixed-case version of bootstrap email
    const mixedCaseEmail = 'ADMIN@Test.REDARM';
    const loginRes = await doLogin({ email: mixedCaseEmail, password: BOOTSTRAP_PASSWORD });
    assert.equal(loginRes.status, 200, 'Login with mixed-case email should succeed');

    // Verify getUser was called with normalised email
    assert.ok(getUserCalls.length > 0, 'getUser should have been called');
    assert.equal(getUserCalls[0], normalizedEmail,
      'getUser should receive the normalised (lowercased) email');

    // Verify the response user email is normalised
    assert.equal(loginRes.jsonBody.user.email, normalizedEmail,
      'Response user.email should be normalised to lowercase');

    // Extract the token and verify the identity inside it is normalised
    const token = loginRes.jsonBody.accessToken;
    const docSpy = mm.spy();
    mm.setUpsertDocument(docSpy);

    const uploadRes = await doUploadUrl(
      { authorization: `Bearer ${token}` },
      { fileName: 'case-test.pdf', contentType: 'application/pdf' }
    );
    assert.equal(uploadRes.status, 200);

    // The token-derived email used in the protected handler should be lowercase
    assert.ok(docSpy.calls.length > 0, 'upsertDocument should have been called');
    const savedDoc = docSpy.calls[0][0];
    assert.equal(savedDoc.ownerEmail, normalizedEmail,
      'ownerEmail from token should be normalised to lowercase');
  });
});
