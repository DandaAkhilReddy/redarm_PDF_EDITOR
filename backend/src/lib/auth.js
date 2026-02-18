const jwt = require("jsonwebtoken");
const { config } = require("./config");
const { error } = require("./responses");

function createToken(email, role) {
  return jwt.sign(
    {
      sub: email,
      role
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: "redarm-cheap-backend",
      audience: "redarm-cheap-ui"
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: "redarm-cheap-backend",
    audience: "redarm-cheap-ui"
  });
}

function getBearerToken(request) {
  let auth = "";
  if (request && request.headers) {
    if (typeof request.headers.get === "function") {
      auth = request.headers.get("authorization") || "";
    } else if (typeof request.headers === "object") {
      auth = request.headers.authorization || request.headers.Authorization || "";
    }
  }
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return "";
  }
  return token;
}

function requireAuth(request) {
  const token = getBearerToken(request);
  if (!token) {
    throw error(401, "unauthorized", "Missing bearer token");
  }
  try {
    const claims = verifyToken(token);
    return {
      email: String(claims.sub || "").toLowerCase(),
      role: String(claims.role || "user")
    };
  } catch {
    throw error(401, "unauthorized", "Invalid or expired token");
  }
}

module.exports = {
  createToken,
  requireAuth
};
