import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { mountStatic } = require('./staticAssets');

describe('mountStatic', () => {
  let dist;
  let server;
  let base;

  beforeAll(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-static-'));
    fs.mkdirSync(path.join(dist, 'static'));
    fs.writeFileSync(path.join(dist, 'static', 'index-abc123.js'), 'export {};');
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dist, 'sw.js'), '// sw');
    const app = express();
    mountStatic(app, dist);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('caches hashed chunks for good', async () => {
    const res = await fetch(`${base}/static/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it.each(['/', '/index.html', '/sw.js', '/budget'])('keeps %s revalidating', async (url) => {
    const res = await fetch(`${base}${url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
  });

  it('404s a missing chunk instead of serving the shell', async () => {
    const res = await fetch(`${base}/static/gone-000000.js`);
    expect(res.status).toBe(404);
  });
});
