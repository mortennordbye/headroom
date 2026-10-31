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
