// backend/test/lib/auth.test.js
//
// Tests for backend/src/lib/auth.js
//
// Covers:
//   createToken  — shape, claims, signing
//   requireAuth  — happy paths, all failure modes, header styles
//
// Run with: node --test test/lib/auth.test.js
// Or via:   npm test

require('../_helpers/setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { createToken, requireAuth } = require('../../src/lib/auth');
const { createMockRequest } = require('../_helpers/mocks');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The secret that setup.js puts in JWT_SECRET */
const TEST_SECRET = process.env.JWT_SECRET;

/**
 * Decode a JWT without verifying the signature so we can inspect raw claims
 * without the issuer/audience constraints of the library's own verify.
 */
function decodeClaims(token) {
  return jwt.decode(token, { complete: true });
}

/**
 * Build a request with a plain-object headers style (no .get() method).
 * This exercises the second branch in getBearerToken.
 */
function makePlainHeaderRequest(headerKey, value) {
  return {
    method: 'GET',
    headers: { [headerKey]: value },
    params: {},
    query: new URLSearchParams(),
  };
}

/**
 * Sign a token with an arbitrary secret so it fails our server's verify step.
 */
function signWithWrongSecret(email, role) {
  return jwt.sign(
    { sub: email, role },
    'totally-wrong-secret',
    {
      expiresIn: '1h',
      issuer: 'redarm-cheap-backend',
      audience: 'redarm-cheap-ui',
    }
  );
}

/**
 * Sign a token that has already expired.
 */
function signExpired(email, role) {
  return jwt.sign(
    { sub: email, role },
    TEST_SECRET,
    {
      expiresIn: -1,           // immediately expired
      issuer: 'redarm-cheap-backend',
      audience: 'redarm-cheap-ui',
    }
  );
}

// ---------------------------------------------------------------------------
// createToken
// ---------------------------------------------------------------------------

describe('createToken', () => {
  it('returns a non-empty string', () => {
    const token = createToken('user@example.com', 'admin');
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0, 'token must not be empty');
  });

  it('produces a three-part JWT (header.payload.signature)', () => {
    const token = createToken('user@example.com', 'user');
    const parts = token.split('.');
    assert.equal(parts.length, 3, 'JWT must have exactly three dot-separated parts');
  });

  it('decoded token has the correct sub claim', () => {
    const email = 'test@redarm.io';
    const token = createToken(email, 'user');
    const { payload } = decodeClaims(token);
    assert.equal(payload.sub, email);
  });

  it('decoded token has the correct role claim', () => {
    const token = createToken('someone@redarm.io', 'admin');
    const { payload } = decodeClaims(token);
    assert.equal(payload.role, 'admin');
  });

  it('decoded token has the correct issuer', () => {
    const token = createToken('a@b.com', 'user');
    const { payload } = decodeClaims(token);
    assert.equal(payload.iss, 'redarm-cheap-backend');
  });

  it('decoded token has the correct audience', () => {
    const token = createToken('a@b.com', 'user');
    const { payload } = decodeClaims(token);
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    assert.equal(aud, 'redarm-cheap-ui');
  });

  it('token is verifiable with the configured secret', () => {
    const token = createToken('verify@redarm.io', 'user');
    assert.doesNotThrow(() =>
      jwt.verify(token, TEST_SECRET, {
        issuer: 'redarm-cheap-backend',
        audience: 'redarm-cheap-ui',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// requireAuth — happy paths
// ---------------------------------------------------------------------------

describe('requireAuth — valid token', () => {
  it('returns email and role when the Authorization header is valid (map-style headers)', () => {
    const token = createToken('admin@redarm.io', 'admin');
    // createMockRequest uses a Map-based headers.get() function
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const result = requireAuth(req);
    assert.equal(result.email, 'admin@redarm.io');
    assert.equal(result.role, 'admin');
  });

  it('returns the correct email for a regular user role', () => {
    const token = createToken('regular@redarm.io', 'user');
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const result = requireAuth(req);
    assert.equal(result.email, 'regular@redarm.io');
    assert.equal(result.role, 'user');
  });

  it('lowercases the email from the token sub claim', () => {
    // createToken stores the email as-is in sub; requireAuth lowercases on read
    const token = createToken('UPPER@REDARM.IO', 'user');
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const result = requireAuth(req);
    assert.equal(result.email, 'upper@redarm.io');
  });

  it('accepts Authorization header in plain-object style (lowercase key)', () => {
    const token = createToken('plain@redarm.io', 'user');
    const req = makePlainHeaderRequest('authorization', `Bearer ${token}`);
    const result = requireAuth(req);
    assert.equal(result.email, 'plain@redarm.io');
  });

  it('accepts Authorization header in plain-object style (capitalized key)', () => {
    const token = createToken('plain2@redarm.io', 'admin');
    const req = makePlainHeaderRequest('Authorization', `Bearer ${token}`);
    const result = requireAuth(req);
    assert.equal(result.email, 'plain2@redarm.io');
    assert.equal(result.role, 'admin');
  });

  it('defaults role to "user" when the token has no role claim', () => {
    // Sign a token manually omitting the role field
    const token = jwt.sign(
      { sub: 'norole@redarm.io' },       // no role property
      TEST_SECRET,
      {
        expiresIn: '1h',
        issuer: 'redarm-cheap-backend',
        audience: 'redarm-cheap-ui',
      }
    );
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const result = requireAuth(req);
    assert.equal(result.role, 'user', 'missing role claim should fall back to "user"');
  });
});

// ---------------------------------------------------------------------------
// requireAuth — failure modes
// ---------------------------------------------------------------------------

describe('requireAuth — missing or malformed header', () => {
  it('throws a 401 response object when the Authorization header is absent', () => {
    const req = createMockRequest({ headers: {} });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
    assert.equal(thrown.jsonBody.error.code, 'unauthorized');
  });

  it('throws a 401 when the Authorization header value is an empty string', () => {
    const req = createMockRequest({ headers: { authorization: '' } });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when Bearer is present but the token part is missing', () => {
    // "Bearer " with trailing space but nothing after
    const req = createMockRequest({ headers: { authorization: 'Bearer ' } });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when the scheme is not Bearer (e.g. Basic)', () => {
    const req = createMockRequest({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when the request object has no headers property', () => {
    let thrown;
    try {
      requireAuth({});
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when the request is null', () => {
    let thrown;
    try {
      requireAuth(null);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });
});

describe('requireAuth — invalid token content', () => {
  it('throws a 401 when the token is signed with the wrong secret', () => {
    const token = signWithWrongSecret('hacker@evil.com', 'admin');
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
    assert.equal(thrown.jsonBody.error.code, 'unauthorized');
  });

  it('throws a 401 when the token is expired', () => {
    const token = signExpired('old@redarm.io', 'user');
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
    assert.equal(thrown.jsonBody.error.code, 'unauthorized');
  });

  it('throws a 401 when the token is a random non-JWT string', () => {
    const req = createMockRequest({
      headers: { authorization: 'Bearer this-is-not-a-jwt-at-all' },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when the token is a well-formed JWT but has the wrong issuer', () => {
    const token = jwt.sign(
      { sub: 'spoof@redarm.io', role: 'admin' },
      TEST_SECRET,
      {
        expiresIn: '1h',
        issuer: 'some-other-service',      // wrong issuer
        audience: 'redarm-cheap-ui',
      }
    );
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });

  it('throws a 401 when the token is a well-formed JWT but has the wrong audience', () => {
    const token = jwt.sign(
      { sub: 'spoof@redarm.io', role: 'user' },
      TEST_SECRET,
      {
        expiresIn: '1h',
        issuer: 'redarm-cheap-backend',
        audience: 'some-other-client',    // wrong audience
      }
    );
    const req = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    let thrown;
    try {
      requireAuth(req);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'should have thrown');
    assert.equal(thrown.status, 401);
  });
});
