import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, safeEqual, resolveAuth, createSessionStore,
  parseCookies, serializeCookie, makeAuthGate,
} from './auth.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password and rejects a wrong one', () => {
    const { salt, hash } = hashPassword('hunter2');
    expect(verifyPassword('hunter2', salt, hash)).toBe(true);
    expect(verifyPassword('wrong', salt, hash)).toBe(false);
  });

  it('is falsy on missing inputs', () => {
    expect(verifyPassword('', 'x', 'y')).toBe(false);
    expect(verifyPassword('p', '', '')).toBe(false);
  });

  it('salts: two hashes of the same password differ', () => {
    expect(hashPassword('same').hash).not.toBe(hashPassword('same').hash);
  });
});

describe('resolveAuth precedence', () => {
  const stored = { enabled: true, ...hashPassword('appsecret') };

  it('env password wins and marks source env', () => {
    const r = resolveAuth({ AUTH_PASSWORD: 'envsecret' }, stored);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('env');
    expect(r.verify('envsecret')).toBe(true);
    expect(r.verify('appsecret')).toBe(false); // app password is ignored under env
  });

  it('falls back to the stored app hash when no env password', () => {
    const r = resolveAuth({}, stored);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('app');
    expect(r.verify('appsecret')).toBe(true);
  });

  it('is off when neither env nor a stored+enabled config is present', () => {
    expect(resolveAuth({}, null).enabled).toBe(false);
    expect(resolveAuth({}, { enabled: false, ...hashPassword('x') }).enabled).toBe(false);
    expect(resolveAuth({}, { enabled: true }).enabled).toBe(false); // enabled but no hash
  });
});

describe('safeEqual', () => {
  it('compares by value, false on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('createSessionStore', () => {
  it('creates valid tokens and destroys them', () => {
    const s = createSessionStore(60_000);
    const t = s.create();
    expect(s.isValid(t)).toBe(true);
    expect(s.isValid('nope')).toBe(false);
    s.destroy(t);
    expect(s.isValid(t)).toBe(false);
  });

  it('expires tokens past their TTL', () => {
    const s = createSessionStore(-1); // already expired
    expect(s.isValid(s.create())).toBe(false);
  });
});

describe('makeAuthGate', () => {
  const EXEMPT = ['/healthz', '/api/version', '/api/auth/status', '/api/auth/login', '/api/auth/logout'];
  // A gate with auth ON, where only the token 'good' is a valid session.
  const gate = makeAuthGate({
    exempt: EXEMPT,
    currentAuth: () => ({ enabled: true }),
    isValidSession: (tok) => tok === 'good',
    tokenFromReq: (req) => req.token,
  });
  // Run the gate against a fake req; returns 'next' or the status it blocked with.
  const run = (path, token) => {
    let outcome = null;
    const res = { status(c) { outcome = c; return this; }, json() { return this; } };
    gate({ path, token }, res, () => { outcome = 'next'; });
    return outcome;
  };

  it('blocks a protected API route without a valid session', () => {
    expect(run('/api/data')).toBe(401);
    expect(run('/api/data', 'bad')).toBe(401);
    expect(run('/api/data', 'good')).toBe('next');
  });

  it('blocks case-variant paths too (regression: case-insensitive routing bypass)', () => {
    // Express matches `/API/data` to the `/api/data` handler, so the gate must
    // also treat it as protected — a case-sensitive check was an auth bypass.
    expect(run('/API/data')).toBe(401);
    expect(run('/Api/Data')).toBe(401);
    expect(run('/API/DATA', 'bad')).toBe(401);
    expect(run('/API/data', 'good')).toBe('next');
  });

  it('lets non-API and exempt paths through (any case)', () => {
    expect(run('/index.html')).toBe('next');
    expect(run('/healthz')).toBe('next');
    expect(run('/HEALTHZ')).toBe('next');
    expect(run('/api/auth/login')).toBe('next');
    expect(run('/API/AUTH/LOGIN')).toBe('next');
  });

  it('is a no-op when auth is disabled', () => {
    const off = makeAuthGate({
      exempt: EXEMPT, currentAuth: () => ({ enabled: false }),
      isValidSession: () => false, tokenFromReq: () => undefined,
    });
    let outcome = null;
    off({ path: '/api/data' }, { status(c) { outcome = c; return this; }, json() { return this; } }, () => { outcome = 'next'; });
    expect(outcome).toBe('next');
  });
});

describe('cookie helpers', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; hr_session=abc%20def')).toEqual({ a: '1', hr_session: 'abc def' });
    expect(parseCookies('')).toEqual({});
  });

  it('serializes with flags', () => {
    const c = serializeCookie('hr_session', 'tok', { maxAge: 100, secure: true });
    expect(c).toContain('hr_session=tok');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=100');
    expect(c).toContain('Secure');
    expect(serializeCookie('x', 'y')).not.toContain('Secure');
  });
});
