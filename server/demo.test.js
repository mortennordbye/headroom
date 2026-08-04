import { describe, it, expect, vi } from 'vitest';
import { DEMO_ERROR, isDemoMode, makeDemoGate } from './demo.js';

describe('isDemoMode', () => {
  it('is on for the documented truthy spellings', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      expect(isDemoMode({ DEMO_MODE: v })).toBe(true);
    }
  });

  it('is off when unset, empty or falsy', () => {
    for (const env of [undefined, {}, { DEMO_MODE: '' }, { DEMO_MODE: '0' }, { DEMO_MODE: 'false' }, { DEMO_MODE: 'no' }]) {
      expect(isDemoMode(env)).toBe(false);
    }
  });
});

describe('makeDemoGate', () => {
  // Minimal Express-shaped doubles: the gate only reads path/method and either
  // calls next() or answers with a status + json body.
  const run = (method, path) => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    makeDemoGate()({ method, path }, res, next);
    return { res, next, passed: next.mock.calls.length > 0 };
  };
  const expectRefused = (r) => {
    expect(r.passed).toBe(false);
    expect(r.res.status).toHaveBeenCalledWith(403);
    expect(r.res.json).toHaveBeenCalledWith({ error: DEMO_ERROR });
  };

  it('lets safe API reads through', () => {
    expect(run('GET', '/api/data').passed).toBe(true);
    expect(run('GET', '/api/history').passed).toBe(true);
    expect(run('GET', '/api/inflation').passed).toBe(true);
    expect(run('GET', '/api/config').passed).toBe(true);
    expect(run('HEAD', '/api/data').passed).toBe(true);
  });

  it('refuses every API mutation', () => {
    for (const [m, p] of [
      ['POST', '/api/data'],
      ['POST', '/api/restore'],
      ['POST', '/api/history/3/restore'],
      ['POST', '/api/auth/config'],
      ['POST', '/api/auth/login'],
      ['PUT', '/api/data'],
      ['PATCH', '/api/data'],
      ['DELETE', '/api/data'],
    ]) {
      expectRefused(run(m, p));
    }
  });

  it('refuses the whole bank namespace, reads included', () => {
    // These GETs are not safe reads: aspsps proxies to Enable Banking on the
    // app's credentials, and callback completes a link as a side effect.
    expectRefused(run('GET', '/api/bank/status'));
    expectRefused(run('GET', '/api/bank/aspsps'));
    expectRefused(run('GET', '/api/bank/callback'));
    expectRefused(run('POST', '/api/bank/sync'));
    expectRefused(run('DELETE', '/api/bank/connection/abc'));
  });

  it('is not fooled by path casing (Express matches routes case-insensitively)', () => {
    expectRefused(run('POST', '/API/DATA'));
    expectRefused(run('GET', '/API/Bank/Aspsps'));
  });

  it('leaves static assets and the SPA shell alone', () => {
    expect(run('GET', '/').passed).toBe(true);
    expect(run('GET', '/settings').passed).toBe(true);
    expect(run('GET', '/static/index-abc123.js').passed).toBe(true);
    expect(run('GET', '/healthz').passed).toBe(true);
  });
});
