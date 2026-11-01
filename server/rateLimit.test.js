import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

// Boots the real app (index.js reads DEMO_MODE / TRUST_PROXY when it loads) on a
// throwaway DATA_DIR and an ephemeral loopback port, then reads the remaining
// count from the draft-7 RateLimit header to see which bucket a request hit.
const require = createRequire(import.meta.url);
const ENV_KEYS = ['DATA_DIR', 'DEMO_MODE', 'TRUST_PROXY', 'ALLOWED_HOSTS'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let server;
let dataDir;
let base;

// node:http rather than fetch, so the Host header can be set freely.
const get = (headers) => new Promise((resolve, reject) => {
  http.get(`${base}/api/config`, { headers }, (r) => { r.resume(); r.on('end', () => resolve(r)); }).on('error', reject);
});

async function boot(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-ratelimit-'));
  Object.assign(process.env, { DATA_DIR: dataDir }, env);
  delete require.cache[require.resolve('./index.js')];
  const app = require('./index.js');
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  return async (forwardedFor) => {
    const r = await get(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {});
    return Number(/remaining=(\d+)/.exec(r.headers.ratelimit)[1]);
  };
}

// index.js doesn't expose its DB handle, so close the server and remove the
// dir with force (the open SQLite file doesn't block removal on POSIX).
afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
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

describe('ALLOWED_HOSTS with TRUST_PROXY set', () => {
  it('checks the raw Host header, so a spoofed X-Forwarded-Host does not pass', async () => {
    await boot({ DEMO_MODE: '1', TRUST_PROXY: 'loopback', ALLOWED_HOSTS: 'demo.example.com' });
    expect((await get({ Host: 'evil.test', 'X-Forwarded-Host': 'demo.example.com' })).statusCode).toBe(403);
    expect((await get({ Host: 'demo.example.com:8080' })).statusCode).toBe(200);
    expect((await get({ Host: 'demo.example.com', 'X-Forwarded-Host': 'evil.test' })).statusCode).toBe(200);
  });
});
