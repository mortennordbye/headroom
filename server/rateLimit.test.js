import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Boots the real app (index.js reads DEMO_MODE / TRUST_PROXY when it loads) on a
// throwaway DATA_DIR and an ephemeral loopback port, then reads the remaining
// count from the draft-7 RateLimit header to see which bucket a request hit.
const require = createRequire(import.meta.url);
const ENV_KEYS = ['DATA_DIR', 'DEMO_MODE', 'TRUST_PROXY'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let server;

async function boot(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hr-ratelimit-')) }, env);
  delete require.cache[require.resolve('./index.js')];
  const app = require('./index.js');
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (forwardedFor) => {
    const r = await fetch(`${base}/api/config`, { headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {} });
    return Number(/remaining=(\d+)/.exec(r.headers.get('ratelimit'))[1]);
  };
}

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('API rate limit keying', () => {
  it('gives each client IP its own bucket in demo mode behind a trusted proxy', async () => {
    const hit = await boot({ DEMO_MODE: '1', TRUST_PROXY: 'loopback' });
    const first = await hit('203.0.113.1');
    expect(await hit('203.0.113.2')).toBe(first);
    expect(await hit('203.0.113.1')).toBe(first - 1);
  });

  it('ignores a spoofed X-Forwarded-For in demo mode without TRUST_PROXY', async () => {
    const hit = await boot({ DEMO_MODE: '1' });
    const first = await hit('203.0.113.1');
    expect(await hit('203.0.113.2')).toBe(first - 1);
  });

  it('keeps one shared bucket outside demo mode, even with TRUST_PROXY set', async () => {
    const hit = await boot({ TRUST_PROXY: 'loopback' });
    const first = await hit('203.0.113.1');
    expect(await hit('203.0.113.2')).toBe(first - 1);
  });
});
