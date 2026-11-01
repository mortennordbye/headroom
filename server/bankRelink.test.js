import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// bank.js resolves DATA_DIR when it loads, so point it at a throwaway dir first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-relink-'));
process.env.DATA_DIR = dir;
const bank = createRequire(import.meta.url)('./bank.js');
const sessionPath = path.join(dir, 'eb-session.json');

describe('re-link marker', () => {
  it('is cleared by the first successful sync, so only that sync checks the overlap', () => {
    const validUntil = new Date(Date.now() + 864e5).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify({
      connections: [{ id: 'aaaa1111-x', idPrefix: 'eb-aaaa1111-', session_id: 's', valid_until: validUntil, relinked: true, accounts: [] }],
    }));
    bank.recordSync({ ok: false, error: 'boom' });
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).connections[0].relinked).toBe(true);
    bank.recordSync({ ok: true, added: 0, fetched: 0, total: 0 });
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).connections[0]).not.toHaveProperty('relinked');
  });
});

describe('re-link marker after a quick re-link', () => {
  const validUntil = new Date(Date.now() + 864e5).toISOString();
  const write = (linkedAt) => fs.writeFileSync(sessionPath, JSON.stringify({
    connections: [{ id: 'aaaa1111-x', idPrefix: 'eb-aaaa1111-', session_id: 's', valid_until: validUntil, relinked: true, linked_at: linkedAt, accounts: [] }],
  }));
  const relinked = () => JSON.parse(fs.readFileSync(sessionPath, 'utf8')).connections[0].relinked;
  const ok = { ok: true, added: 0, fetched: 0, total: 0 };

  // The next sync fetches from (now - 7 days). While that still reaches rows
  // dated on or before the re-link, the bank can resend old rows under new ids,
  // so the second sync has to check the overlap too.
  it('stays set while the next sync window still reaches back to the re-link', () => {
    write(new Date(Date.now() - 2 * 864e5).toISOString());
    bank.recordSync(ok);
    expect(relinked()).toBe(true);
    bank.recordSync(ok);
    expect(relinked()).toBe(true);
  });

  it('is cleared once the next sync window starts after the re-link', () => {
    write(new Date(Date.now() - 9 * 864e5).toISOString());
    bank.recordSync(ok);
    expect(relinked()).toBeUndefined();
  });
});
