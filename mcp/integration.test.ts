// Data-safety fleet (against a real throwaway server — NEVER live data).
//
// These exercise the full write path through the app's own /api/data, so they
// catch anything the pure tests can't: lossy round-trips, the server merge/
// preserve/reconcile guards, optimistic-concurrency conflicts, and — most
// important — that a data-LOSING payload is rejected by the server without
// destroying what's already stored.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportPayload } from '../src/context/FinanceContext';
import { fullFixture, topLevelKeys } from './fixture';
import { setCategoryBudget } from './mutations';

const PORT = 3987;
const BASE = `http://localhost:${PORT}`;

let proc: ChildProcess;
let client: typeof import('./client');

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('throwaway server did not become healthy');
}

async function currentRev(): Promise<number> {
  const res = await fetch(`${BASE}/api/data`);
  return Number(res.headers.get('x-data-rev') ?? 0);
}

/** Reset stored state to the pristine full fixture so every test starts clean. */
async function reseed() {
  const rev = await currentRev();
  const res = await fetch(`${BASE}/api/data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-data-rev': String(rev) },
    body: JSON.stringify(fullFixture()),
  });
  if (!res.ok) throw new Error(`reseed failed (${res.status})`);
}

async function getBlob(): Promise<ExportPayload> {
  return (await (await fetch(`${BASE}/api/data`)).json()) as ExportPayload;
}

beforeAll(async () => {
  process.env.HEADROOM_URL = BASE;
  const dir = mkdtempSync(join(tmpdir(), 'hr-mcp-'));
  proc = spawn('node', ['server/index.js'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForHealth();
  // first write creates the row
  await fetch(`${BASE}/api/data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-data-rev': '0' },
    body: JSON.stringify(fullFixture()),
  });
  client = await import('./client'); // import AFTER HEADROOM_URL is set
}, 30000);

afterAll(() => {
  proc?.kill();
});

beforeEach(reseed);

describe('round-trip fidelity', () => {
  it('the full blob survives a POST + GET byte-for-byte', async () => {
    // Merge-stable fixture: what we stored is exactly what we read back.
    expect(await getBlob()).toEqual(fullFixture());
  });
});

describe('applyMutation preserves all other data through the real server', () => {
  it('a category-budget write changes only categoryBudgets', async () => {
    const before = fullFixture();
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 1800 });
      return b;
    });
    const after = await getBlob();
    expect(after.categoryBudgets?.transport).toBe(1800);
    for (const key of topLevelKeys()) {
      if (key === 'categoryBudgets') continue;
      expect(after[key as keyof ExportPayload], `field "${key}" must survive the write`).toEqual(
        before[key as keyof ExportPayload],
      );
    }
  });

  it('the rev increments on a write', async () => {
    const r0 = await currentRev();
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'health', amount: 500 });
      return b;
    });
    expect(await currentRev()).toBeGreaterThan(r0);
  });
});

describe('concurrency: no lost updates', () => {
  it('two racing writes both land (the loser retries on 409)', async () => {
    await Promise.all([
      client.applyMutation((b) => {
        setCategoryBudget(b, { category: 'transport', amount: 1000 });
        return b;
      }),
      client.applyMutation((b) => {
        setCategoryBudget(b, { category: 'health', amount: 700 });
        return b;
      }),
    ]);
    const after = await getBlob();
    expect(after.categoryBudgets?.transport).toBe(1000);
    expect(after.categoryBudgets?.health).toBe(700);
    // originals still there too
    expect(after.categoryBudgets?.groceries).toBe(6000);
  });
});

describe('the server is a backstop: a data-losing write cannot destroy stored data', () => {
  it('a mutation that drops a required field is rejected (400) and stored data is untouched', async () => {
    await expect(
      client.applyMutation((b) => {
        // A hypothetical buggy mutation that violates the required shape.
        delete (b as Partial<ExportPayload>).income;
        return b as ExportPayload;
      }),
    ).rejects.toThrow(/400/);
    // Nothing was written: the full fixture is intact.
    expect(await getBlob()).toEqual(fullFixture());
  });

  it('a stale write is rejected with 409 and the current rev', async () => {
    const rev = await currentRev();
    const stale = await fetch(`${BASE}/api/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-data-rev': String(rev - 1) },
      body: JSON.stringify(fullFixture()),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { currentRev: number }).currentRev).toBe(rev);
  });
});

describe('revision history (in-volume undo net)', () => {
  it('records committed revisions, newest first, with timestamps', async () => {
    const { revisions } = await client.listHistory();
    expect(revisions.length).toBeGreaterThan(0);
    // strictly descending by rev
    for (let i = 1; i < revisions.length; i++) {
      expect(revisions[i - 1].rev).toBeGreaterThan(revisions[i].rev);
    }
    expect(typeof revisions[0].ts).toBe('string');
    expect(revisions[0].bytes).toBeGreaterThan(0);
  });

  it('serves the full blob for a past revision', async () => {
    const rev = await currentRev();
    const snap = await client.getHistoryRevision(rev);
    expect(snap.rev).toBe(rev);
    expect(snap.content).toEqual(fullFixture()); // beforeEach reseeded this rev
  });

  it('restores a past revision, and the restore is itself reversible', async () => {
    const good = await currentRev(); // fullFixture is stored here
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 4242 });
      return b;
    });
    expect((await getBlob()).categoryBudgets?.transport).toBe(4242);

    const out = await client.restoreRevision(good);
    expect(out.restoredFrom).toBe(good);
    // back to the pristine fixture (no stray transport budget)
    expect(await getBlob()).toEqual(fullFixture());
    // and the restore was recorded as a newer revision than the bad write
    expect(out.rev).toBeGreaterThan(good);
  });

  it('prunes to the retention limit (oldest revisions drop off)', async () => {
    const { limit } = await client.listHistory();
    for (let i = 0; i < limit + 5; i++) {
      await client.applyMutation((b) => {
        setCategoryBudget(b, { category: 'shopping', amount: 100 + i });
        return b;
      });
    }
    const { revisions } = await client.listHistory();
    expect(revisions.length).toBe(limit);
    // newest kept, and it reflects the last write
    const newest = await client.getHistoryRevision(revisions[0].rev);
    expect(newest.content.categoryBudgets?.shopping).toBe(100 + (limit + 5 - 1));
  });

  it('restoring a non-existent revision fails cleanly', async () => {
    await expect(client.restoreRevision(999999)).rejects.toThrow(/no stored revision/);
  });
});
