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
import { setCategoryBudget, deleteTransaction } from './mutations';

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

  it('skips the save when a write changes nothing', async () => {
    const set = (b: ExportPayload) => {
      setCategoryBudget(b, { category: 'shopping', amount: 111 });
      return b;
    };
    await client.applyMutation(set);
    const rev = await currentRev();
    const again = await client.applyMutation(set);
    expect(again).toEqual({ rev, unchanged: true });
    expect(await currentRev()).toBe(rev);
  });

  it('attributes MCP writes and labels them with the fields they changed', async () => {
    const { rev } = await client.applyMutation(
      (b) => {
        setCategoryBudget(b, { category: 'shopping', amount: 321 });
        return b;
      },
      () => 'categoryBudgets.shopping',
    );
    const newest = (await client.listHistory()).revisions[0];
    expect(newest).toMatchObject({ rev, source: 'mcp', label: 'categoryBudgets.shopping', keys: ['categoryBudgets'] });
  });

  it('folds back-to-back UI saves into one revision but keeps every MCP write', async () => {
    const before = (await client.listHistory()).revisions.length;
    for (let i = 0; i < 3; i++) {
      const b = await getBlob();
      b.aiContext = `ui edit ${i}`;
      await fetch(`${BASE}/api/data`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-data-rev': String(await currentRev()) },
        body: JSON.stringify(b),
      });
    }
    // beforeEach's reseed was a UI save too, so the three edits fold into it.
    expect((await client.listHistory()).revisions.length).toBe(before);
    for (let i = 0; i < 3; i++) {
      await client.applyMutation((b) => {
        setCategoryBudget(b, { category: 'shopping', amount: 100 + i });
        return b;
      });
    }
    const { revisions } = await client.listHistory();
    expect(revisions.length).toBe(before + 3);
    expect(revisions.slice(0, 3).every((r) => r.source === 'mcp')).toBe(true);
    // The folded UI revision still knows everything the session changed.
    expect(revisions[3].keys).toContain('aiContext');
  });

  it('never folds an import into the editing session before it', async () => {
    const post = async (b: ExportPayload, source?: string) =>
      fetch(`${BASE}/api/data`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-data-rev': String(await currentRev()),
          ...(source ? { 'x-headroom-source': source } : {}),
        },
        body: JSON.stringify(b),
      });
    const edited = await getBlob();
    edited.aiContext = 'edited before import';
    await post(edited);
    const before = (await client.listHistory()).revisions;
    await post({ ...edited, aiContext: 'imported' }, 'import');
    const after = (await client.listHistory()).revisions;
    expect(after.length).toBe(before.length + 1);
    expect(after[0].source).toBe('import');
    // The pre-import state is still its own restore point.
    expect((await client.getHistoryRevision(after[1].rev)).content.aiContext).toBe('edited before import');
    // And a client can't claim a server-only source.
    await post({ ...edited, aiContext: 'spoof' }, 'bank-sync');
    expect((await client.listHistory()).revisions[0].source).toBe('ui');
  });

  it('rejects history POSTs without the app header (no cross-site form posts)', async () => {
    const rev = await currentRev();
    expect((await fetch(`${BASE}/api/history/${rev}/undo`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${BASE}/api/history/${rev}/restore`, { method: 'POST' })).status).toBe(403);
  });

  it('marks a revision undoable only while the state before it is kept', async () => {
    const { revisions } = await client.listHistory();
    // The oldest kept revision's predecessor is gone, so it can only be restored.
    expect(revisions[revisions.length - 1].undoable).toBe(false);
    const { rev } = await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'health', amount: 77 });
      return b;
    });
    expect((await client.listHistory()).revisions[0]).toMatchObject({ rev, undoable: true });
  });

  it('undoes one change and keeps a later, unrelated edit', async () => {
    const { rev: budgetRev } = await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 4242 });
      return b;
    });
    await client.applyMutation((b) => {
      b.aiContext = 'later edit';
      return b;
    });
    const out = await client.undoRevision(budgetRev);
    expect(out.keys).toEqual(['categoryBudgets']);
    const blob = await getBlob();
    expect(blob.categoryBudgets).toEqual(fullFixture().categoryBudgets);
    expect(blob.aiContext).toBe('later edit');
    expect((await client.listHistory()).revisions[0]).toMatchObject({ rev: out.rev, source: 'undo' });
  });

  it('refuses to undo a change that was edited again since, and writes nothing', async () => {
    const { rev: first } = await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 1 });
      return b;
    });
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 2 });
      return b;
    });
    const revBefore = await currentRev();
    await expect(client.undoRevision(first)).rejects.toThrow(/categoryBudgets\.transport/);
    expect(await currentRev()).toBe(revBefore);
  });

  it('undoes a bank-row delete: the row and its tombstone both come back out', async () => {
    const b0 = await getBlob();
    b0.dailyTransactions = [...b0.dailyTransactions, { id: 'eb-undo-1', date: '2026-06-20', description: 'Bank row', amount: 10, kind: 'expense' }];
    await fetch(`${BASE}/api/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-data-rev': String(await currentRev()) },
      body: JSON.stringify(b0),
    });
    const { rev } = await client.applyMutation((b) => {
      deleteTransaction(b, { id: 'eb-undo-1' });
      return b;
    });
    expect((await getBlob()).dailyTransactions.some((t) => t.id === 'eb-undo-1')).toBe(false);
    await client.undoRevision(rev);
    const after = await getBlob();
    expect(after.dailyTransactions.some((t) => t.id === 'eb-undo-1')).toBe(true);
    expect(after.deletedBankIds).toEqual(fullFixture().deletedBankIds);
  });

  it('restoring a non-existent revision fails cleanly', async () => {
    await expect(client.restoreRevision(999999)).rejects.toThrow(/no stored revision/);
  });
});

describe('deleting a bank-imported transaction', () => {
  it('stays deleted through the server reconcile, also on later writes', async () => {
    const id = 'eb-abc12345-1';
    await client.applyMutation((b) => {
      b.dailyTransactions = [
        ...b.dailyTransactions,
        { id, date: '2026-06-11', description: 'Card purchase', amount: 300, kind: 'expense' },
      ];
      return b;
    });
    expect((await getBlob()).dailyTransactions.some((t) => t.id === id)).toBe(true);

    await client.applyMutation((b) => {
      deleteTransaction(b, { id });
      return b;
    });
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'health', amount: 500 });
      return b;
    });
    const after = await getBlob();
    expect(after.dailyTransactions.some((t) => t.id === id)).toBe(false);
    expect(after.deletedBankIds).toContain(id);
  });
});

describe('a legacy mortgage balance is migrated on read, and saved only by a write', () => {
  async function storeDrifted() {
    const drifted = fullFixture();
    drifted.assets.houseDebt = 2_700_000;
    // An old save: homeowner + transition hold their own copy, 2 500 000.
    Object.assign(drifted.homeowner!, { currentMortgageBalance: 2_500_000 });
    Object.assign(drifted.transition!, { currentMortgageBalance: 2_500_000 });
    await fetch(`${BASE}/api/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-data-rev': String(await currentRev()) },
      body: JSON.stringify(drifted),
    });
  }

  it("getData shows the active mode's balance on assets.houseDebt", async () => {
    await storeDrifted();
    const { blob } = await client.getData();
    expect(blob.assets.houseDebt).toBe(2_500_000);
    expect(blob.homeowner).not.toHaveProperty('currentMortgageBalance');
    expect(blob.transition).not.toHaveProperty('currentMortgageBalance');
    // The read stored nothing.
    expect((await getBlob()).assets.houseDebt).toBe(2_700_000);
  });

  it('a write saves the migrated shape, as the app does on its next save', async () => {
    await storeDrifted();
    await client.applyMutation((b) => {
      setCategoryBudget(b, { category: 'transport', amount: 1800 });
      return b;
    });
    const stored = await getBlob();
    expect(stored.assets.houseDebt).toBe(2_500_000);
    expect(stored.homeowner).not.toHaveProperty('currentMortgageBalance');
    expect(stored.transition).not.toHaveProperty('currentMortgageBalance');
  });
});
