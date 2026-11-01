import { describe, it, expect } from 'vitest';
import { startBankSyncSchedule, singleFlight } from './bankSync.js';

const nowMs = Date.parse('2026-07-11T00:00:00.000Z');
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('startBankSyncSchedule', () => {
  it('returns null when disabled (intervalHours <= 0)', () => {
    const opts = { runSync: async () => ({}), lastSyncAgeMs: () => Infinity };
    expect(startBankSyncSchedule({ intervalHours: 0, ...opts })).toBeNull();
    expect(startBankSyncSchedule({ intervalHours: -1, ...opts })).toBeNull();
  });

  it('syncs promptly on first start when nothing has ever synced, then can be stopped', async () => {
    const logs = [];
    let ran = 0;
    const handle = startBankSyncSchedule({
      intervalHours: 24,
      runSync: async () => { ran++; return { added: 2, fetched: 5 }; },
      lastSyncAgeMs: () => Infinity, // firstDelay → 0
      log: (m) => logs.push(m),
      clock: () => nowMs,
    });
    expect(handle).not.toBeNull();
    await tick();
    expect(ran).toBe(1);
    expect(logs.some((m) => m.includes('+2') && m.includes('fetched 5'))).toBe(true);
    handle.stop();
  });

  it('delays the first sync when a recent sync exists (no immediate tick)', async () => {
    let ran = 0;
    const handle = startBankSyncSchedule({
      intervalHours: 24,
      runSync: async () => { ran++; return {}; },
      lastSyncAgeMs: () => 3600_000, // synced 1h ago → 23h left, well beyond the test window
      log: () => {},
      clock: () => nowMs,
    });
    await tick();
    expect(ran).toBe(0);
    handle.stop();
  });

  it('logs a failed sync instead of throwing', async () => {
    const logs = [];
    const handle = startBankSyncSchedule({
      intervalHours: 24,
      runSync: async () => { throw new Error('consent expired'); },
      lastSyncAgeMs: () => Infinity,
      log: (m) => logs.push(m),
      clock: () => nowMs,
    });
    await tick();
    expect(logs.some((m) => m.includes('failed') && m.includes('consent expired'))).toBe(true);
    handle.stop();
  });
});

describe('singleFlight', () => {
  it('joins overlapping calls to one run, then starts a fresh run once it settles', async () => {
    let runs = 0;
    let release;
    const run = singleFlight(() => { runs += 1; return new Promise((r) => { release = r; }); });
    const a = run();
    const b = run();
    expect(b).toBe(a);
    await tick();
    expect(runs).toBe(1);
    release('done');
    expect(await a).toBe('done');
    expect(await b).toBe('done');
    void run();
    await tick();
    expect(runs).toBe(2);
  });

  it('clears after a failure so the next call retries', async () => {
    let runs = 0;
    const run = singleFlight(async () => { runs += 1; if (runs === 1) throw new Error('boom'); return 'ok'; });
    await expect(run()).rejects.toThrow('boom');
    expect(await run()).toBe('ok');
  });
});
