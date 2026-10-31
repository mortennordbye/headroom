import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { migrateImportedMortgage, migrateMortgageBalance, type MortgageSliceFields } from './mortgageSlices';
import { changedKeys, deepEqual, revertChange } from '../../server/revert.js';
import {
  NOW, hasLegacyCopies, importAndSave, loadAndSave, shownBalance, type Blob,
} from './persistedRoundTrip.testHelpers';

// Property-based tests for the mortgage-balance migration and the revision
// undo: random legacy and current blobs (missing slices, NaN, negatives,
// strings where numbers belong, unknown housing modes) and random revision
// pairs. Run counts stay modest so the suite stays fast.

const RUNS = { numRuns: 150 };

/** Anything a stored or hand-edited balance field might hold. */
const anyBalance = fc.oneof(
  fc.integer({ min: -500_000, max: 9_000_000 }),
  fc.constantFrom(0, 3_000_000, 1_250_000, 2_480_000),
  fc.double(), // NaN, ±Infinity, -0, subnormals
  fc.constantFrom('1 900 000', '2,5', 'abc', ''),
  fc.constant(null),
);
const anyMode = fc.oneof(
  fc.constantFrom('first_buyer', 'homeowner', 'transitioning'),
  fc.constantFrom('renter', '', 'HOMEOWNER'),
  fc.constant(undefined),
);
const anyMonth = fc.oneof(fc.constantFrom('2025-12', '2026-03', '2026-09'), fc.constantFrom('2026-13', '03/2026', ''), fc.integer());

/** A blob in the old three-field shape, any part of it possibly missing or junk. */
const legacyBlob = fc.record({
  housingMode: anyMode,
  assets: fc.record({ houseDebt: anyBalance, houseValue: fc.integer({ min: 0, max: 8_000_000 }) }, { requiredKeys: [] }),
  homeowner: fc.record({
    currentMortgageBalance: anyBalance,
    currentMortgageBalanceAsOf: anyMonth,
    rente: fc.double({ min: 0, max: 12, noNaN: true }),
  }, { requiredKeys: [] }),
  transition: fc.record({ currentMortgageBalance: anyBalance, currentHouseValue: fc.integer({ min: 0, max: 8_000_000 }) }, { requiredKeys: [] }),
}, { requiredKeys: [] }) as fc.Arbitrary<Blob>;

/** A legacy blob the server could have stored: POST /api/data refuses one
 *  without an assets object, and so does an undo that would leave one. */
const storedLegacyBlob = legacyBlob.map((b): Blob => ({ ...b, assets: b.assets ?? {} }));

/** A legacy blob whose copies all hold the same balance (no drift). */
const inSyncLegacyBlob = fc.record({
  housingMode: fc.constantFrom('first_buyer', 'homeowner', 'transitioning'),
  balance: fc.integer({ min: 1, max: 6_000_000 }).filter((b) => b !== 3_000_000),
  asOf: fc.constantFrom('2025-12', '2026-03', '2026-09'),
  income: fc.integer({ min: 20_000, max: 90_000 }),
}).map(({ housingMode, balance, asOf, income }): Blob => ({
  income, housingMode,
  assets: { houseDebt: balance, houseValue: 4_000_000, savingsAccounts: [] },
  homeowner: { currentMortgageBalance: balance, currentMortgageBalanceAsOf: asOf, nedbetalingstidAsOf: '2025-11' },
  transition: { currentMortgageBalance: balance },
}));

const asSlices = (b: Blob) => b as MortgageSliceFields;
const houseDebtOf = (b: Blob) => (b.assets as Blob | undefined)?.houseDebt;

/** `b` without the "written this month" date stamps. The load stamps a missing
 *  loan term date and owner-mode balance date, but only on a slice the blob
 *  carried, so a slice filled from defaults (or brought in by an import) is
 *  stamped one load later; an import also stamps the balance date outside the
 *  owner modes, where nothing reads it. Those are not balance changes. */
function unstamped(b: Blob): Blob {
  const h = b.homeowner as Blob | undefined;
  if (!h) return b;
  const { nedbetalingstidAsOf: _term, ...rest } = h;
  const owner = b.housingMode === 'homeowner' || b.housingMode === 'transitioning';
  if (!owner || rest.currentMortgageBalanceAsOf === NOW) delete rest.currentMortgageBalanceAsOf;
  return { ...b, homeowner: rest };
}

describe('migrateMortgageBalance (property)', () => {
  it('never throws, drops the old copies, and is idempotent', () => {
    fc.assert(fc.property(legacyBlob, (raw) => {
      const once = migrateMortgageBalance(asSlices(raw), NOW);
      expect(hasLegacyCopies(once)).toBe(false);
      const twice = migrateMortgageBalance(once, NOW);
      expect(twice).toBe(once); // nothing left to change: the same object back
    }), RUNS);
  });

  it('writes houseDebt only as a finite, non-negative number', () => {
    fc.assert(fc.property(legacyBlob, (raw) => {
      const out = migrateMortgageBalance(asSlices(raw), NOW) as Blob;
      const before = houseDebtOf(raw);
      const after = houseDebtOf(out);
      if (!Object.is(after, before)) {
        expect(typeof after).toBe('number');
        expect(Number.isFinite(after)).toBe(true);
        expect(after as number).toBeGreaterThanOrEqual(0);
      }
    }), RUNS);
  });

  it('through the full load, the balance shown is finite and the saved blob is stable', () => {
    fc.assert(fc.property(legacyBlob, (raw) => {
      const saved = loadAndSave(raw);
      expect(hasLegacyCopies(saved)).toBe(false);
      expect(Number.isFinite(houseDebtOf(saved))).toBe(true);
      const shown = shownBalance(saved);
      expect(Number.isFinite(shown)).toBe(true);
      expect(shown).toBeGreaterThanOrEqual(0);
      // The balance read straight off a stored blob (as a stored snapshot is) is
      // the one the load keeps, unless a string needed the load's sanitizing.
      if (!JSON.stringify(raw).includes('"currentMortgageBalance":"') && typeof houseDebtOf(raw) !== 'string') {
        expect(shownBalance(raw)).toBe(shown);
      }
      expect(unstamped(loadAndSave(saved))).toEqual(unstamped(saved));
    }), RUNS);
  });
});

describe('migrateImportedMortgage (property)', () => {
  it('never throws, drops the old copies, and leaves nothing for a later load to migrate', () => {
    fc.assert(fc.property(legacyBlob, legacyBlob, (stored, file) => {
      const current = migrateMortgageBalance(asSlices(stored), NOW);
      const out = migrateImportedMortgage(current, asSlices(file), NOW);
      expect(hasLegacyCopies(out)).toBe(false);
      expect(migrateMortgageBalance(out, NOW)).toEqual(out);
    }), RUNS);
  });

  it('through the full import, no NaN reaches houseDebt and the result loads unchanged', () => {
    fc.assert(fc.property(legacyBlob, legacyBlob, (stored, file) => {
      const state = loadAndSave(stored);
      const out = importAndSave(state, file);
      expect(hasLegacyCopies(out)).toBe(false);
      expect(Number.isFinite(houseDebtOf(out))).toBe(true);
      expect(Number.isFinite(shownBalance(out))).toBe(true);
      expect(unstamped(loadAndSave(out))).toEqual(unstamped(out));
    }), RUNS);
  });

  it('importing the app\'s own saved state changes nothing', () => {
    fc.assert(fc.property(legacyBlob, (stored) => {
      const state = loadAndSave(stored);
      // A negative houseDebt is kept by the load and clamped by the import.
      fc.pre((houseDebtOf(state) as number) >= 0);
      expect(unstamped(importAndSave(state, state))).toEqual(unstamped(state));
    }), RUNS);
  });
});

describe('revertChange (property)', () => {
  it('never throws, and either applies or names conflicts under the keys it was given', () => {
    fc.assert(fc.property(legacyBlob, legacyBlob, legacyBlob, (current, after, before) => {
      const keys = changedKeys(before, after);
      const r = revertChange(current, after, before, keys);
      if (r.conflicts) {
        expect(r.conflicts.length).toBeGreaterThan(0);
        for (const c of r.conflicts) expect(keys.some((k) => c === k || c.startsWith(`${k}.`) || c.startsWith(`${k}[`)), c).toBe(true);
      } else {
        // Keys the revision did not touch are left exactly as they are now.
        for (const k of Object.keys(current)) if (!keys.includes(k)) expect(r.blob[k]).toBe(current[k]);
      }
    }), RUNS);
  });

  it('undoing the newest save of two loaded states gives back the older one', () => {
    fc.assert(fc.property(storedLegacyBlob, storedLegacyBlob, (x, y) => {
      const before = loadAndSave(x);
      const after = loadAndSave(y);
      const r = revertChange(after, after, before, changedKeys(before, after));
      expect(r.conflicts).toBeUndefined();
      expect(deepEqual(r.blob, before)).toBe(true);
    }), RUNS);
  });

  it('undoing a legacy save on top of the migrated state never brings back the old copies or a NaN', () => {
    fc.assert(fc.property(storedLegacyBlob, storedLegacyBlob, (x, y) => {
      // y was saved on top of x by the old app; the app has since loaded y.
      const current = loadAndSave(y);
      const r = revertChange(current, y, x, changedKeys(x, y));
      if (r.conflicts) return;
      expect(hasLegacyCopies(r.blob)).toBe(false);
      const view = loadAndSave(r.blob);
      expect(Number.isFinite(houseDebtOf(view))).toBe(true);
      expect(Number.isFinite(shownBalance(view))).toBe(true);
    }), RUNS);
  });

  it('undoing an old-app balance edit on top of the migrated state restores the earlier balance', () => {
    // The old app moved all three copies together, so the revision is in sync.
    fc.assert(fc.property(inSyncLegacyBlob, fc.integer({ min: 1, max: 6_000_000 }), (x, edited) => {
      fc.pre(edited !== houseDebtOf(x) && edited !== 3_000_000);
      const y = structuredClone(x);
      (y.assets as Blob).houseDebt = edited;
      (y.homeowner as Blob).currentMortgageBalance = edited;
      (y.transition as Blob).currentMortgageBalance = edited;
      const current = loadAndSave(y);
      const r = revertChange(current, y, x, changedKeys(x, y));
      expect(r.conflicts).toBeUndefined();
      expect(hasLegacyCopies(r.blob!)).toBe(false);
      expect(shownBalance(loadAndSave(r.blob!))).toBe(shownBalance(loadAndSave(x)));
    }), RUNS);
  });

  it('undoing the migration save of an in-sync legacy blob keeps the balance shown', () => {
    fc.assert(fc.property(inSyncLegacyBlob, (legacy) => {
      const migrated = loadAndSave(legacy);
      const r = revertChange(migrated, migrated, legacy, changedKeys(legacy, migrated));
      expect(r.conflicts).toBeUndefined();
      expect(hasLegacyCopies(r.blob)).toBe(false);
      expect(shownBalance(loadAndSave(r.blob!))).toBe(shownBalance(migrated));
    }), RUNS);
  });

  // Known bug (server/revert.js): undoing the migration save of a drifted legacy
  // blob shows the stale assets.houseDebt instead of the balance the app showed.
  it.fails('undoing the migration save of any legacy blob keeps the balance shown', () => {
    fc.assert(fc.property(storedLegacyBlob, (legacy) => {
      const migrated = loadAndSave(legacy);
      const r = revertChange(migrated, migrated, legacy, changedKeys(legacy, migrated));
      expect(r.conflicts).toBeUndefined();
      expect(shownBalance(loadAndSave(r.blob!))).toBe(shownBalance(migrated));
    }), RUNS);
  });
});
