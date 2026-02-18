const bcrypt = require("bcryptjs");
const { app } = require("@azure/functions");
const { config } = require("../lib/config");
const { json, error } = require("../lib/responses");
const { createToken } = require("../lib/auth");
const { getUser, upsertUser, isoNow, normalizeEmail } = require("../lib/tables");

async function ensureBootstrapUser(email) {
  if (!config.bootstrapAdminEmail || !config.bootstrapAdminPassword) {
    return null;
  }

  if (email !== config.bootstrapAdminEmail) {
    return null;
  }

  const existing = await getUser(email);
  if (existing) {
    return existing;
  }

  const passwordHash = await bcrypt.hash(config.bootstrapAdminPassword, config.bcryptRounds);
  const now = isoNow();
  await upsertUser({
    email,
    passwordHash,
    role: "admin",
    failedAttempts: 0,
    createdAt: now,
    updatedAt: now
  });
  return getUser(email);
}

app.http("auth-login", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: async (request, context) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return error(400, "invalid_json", "Body must be valid JSON");
    }

    const email = normalizeEmail(payload?.email);
    const password = String(payload?.password || "");

    if (!email || !password) {
      return error(400, "validation_error", "email and password are required");
    }

    if (password.length > 256) {
      return error(400, "validation_error", "password is too long");
    }

    let user = await getUser(email);
    if (!user) {
      user = await ensureBootstrapUser(email);
      if (!user) {
        return error(401, "invalid_credentials", "Invalid credentials");
      }
    }

    const now = new Date();
    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    if (lockedUntil && lockedUntil > now) {
      return error(423, "account_locked", "Account temporarily locked due to failed attempts");
    }

    const passwordMatches = await bcrypt.compare(password, String(user.passwordHash || ""));
    if (!passwordMatches) {
      const failedAttempts = Number(user.failedAttempts || 0) + 1;
      const patch = {
        email,
        failedAttempts,
        updatedAt: isoNow()
      };

      if (failedAttempts >= config.lockoutThreshold) {
        const until = new Date(Date.now() + config.lockoutMinutes * 60 * 1000).toISOString();
        patch.lockedUntil = until;
        patch.failedAttempts = 0;
      }

      await upsertUser(patch);
      return error(401, "invalid_credentials", "Invalid credentials");
    }

    await upsertUser({
      email,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: isoNow()
    });

    const token = createToken(email, String(user.role || "user"));
    context.log(`User authenticated: ${email}`);

    return json(200, {
      accessToken: token,
      expiresIn: config.jwtExpiresIn,
      user: {
        email,
        role: String(user.role || "user")
      }
    });
  }
});