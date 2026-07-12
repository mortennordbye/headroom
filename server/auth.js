// Optional single-user password auth. Pure, dependency-free helpers (Node crypto
// only) so index.js holds just the wiring and this stays unit-testable.
//
// Two ways to turn auth on, resolved by `resolveAuth` in strict precedence:
//   1. env AUTH_PASSWORD (plaintext, e.g. a k8s Secret) — forces auth on and
//      locks the in-app toggle.
//   2. the app's stored config (a scrypt hash the user set in Settings).
//   3. neither → auth off (the app's default; current behaviour unchanged).
//
// Sessions are in-memory tokens (single process, same rationale as the SSB
// throttle in index.js): a restart just means logging in again. Nothing here
// touches Express or SQLite.
const crypto = require('crypto');

const KEYLEN = 64;

/** scrypt a password → { salt, hash } (hex). */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, KEYLEN).toString('hex');
  return { salt, hash };
}

/** Constant-time verify of a password against a stored scrypt salt+hash. */
function verifyPassword(plain, salt, hash) {
  if (!plain || !salt || !hash) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(plain), salt, KEYLEN);
  } catch {
    return false;
  }
  const stored = Buffer.from(hash, 'hex');
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

/** Constant-time string equality (for the env plaintext password). */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Resolve the effective auth mode from the environment and the stored app config.
 * Returns { enabled, source: 'env'|'app'|'none', verify(plain) }. `verify` is a
 * closure so the caller never has to know which source won.
 */
function resolveAuth(env, stored) {
  const envPw = env && env.AUTH_PASSWORD;
  if (envPw) {
    return { enabled: true, source: 'env', verify: (p) => safeEqual(p, envPw) };
  }
  if (stored && stored.enabled && stored.salt && stored.hash) {
    return { enabled: true, source: 'app', verify: (p) => verifyPassword(p, stored.salt, stored.hash) };
  }
  return { enabled: false, source: 'none', verify: () => false };
}

/** In-memory session store: opaque tokens → expiry. Single-process only. */
function createSessionStore(ttlMs) {
  const sessions = new Map(); // token → expiresAt (ms epoch)
  return {
    create() {
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + ttlMs);
      return token;
    },
    isValid(token) {
      if (!token) return false;
      const exp = sessions.get(token);
      if (!exp) return false;
      if (exp <= Date.now()) { sessions.delete(token); return false; }
      return true;
    },
    destroy(token) { if (token) sessions.delete(token); },
    clear() { sessions.clear(); },
  };
}

/** Parse a Cookie header into a plain object (avoids a cookie-parser dep). */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Serialize a Set-Cookie value. `maxAge` in seconds; `secure` adds the flag. */
function serializeCookie(name, value, { maxAge, secure } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

module.exports = {
  hashPassword,
  verifyPassword,
  safeEqual,
  resolveAuth,
  createSessionStore,
  parseCookies,
  serializeCookie,
};
