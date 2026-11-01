import { describe, it, expect } from 'vitest';
import type { BalanceSnapshot, CoOwner } from '../context/FinanceContext';
import {
  activeCoOwners, ownershipShares, myHouseValue, myHouseDebt, primaryHomeWealthValue,
  primaryHomeWealthValueOfShare, myPrimaryHomeWealthValue, validateCoOwners, snapshotCoOwners,
  rewriteSnapshotCoOwners, sanitizeCoOwners, sanitizeSnapshotCoOwners, mySaleProceeds, withOwnershipShare,
} from './ownership';
import { calcWealthTax, WEALTH_TAX_PARAMS } from './norwegianTax';
import { computeEquityBreakdown } from './equity';
import { addMonthsKey } from './date';

const co = (over: Partial<CoOwner> = {}): CoOwner => ({ id: 'coo-1', name: 'Medeier 1', ownershipPct: 50, ...over });
const valued = (v: number) => calcWealthTax({ primaryHomeValue: v, shares: 0, otherAssets: 0, debt: 0 }).valuedAssets;

describe('ownershipShares', () => {
  it('defaults to 100 % / 100 % with no co-owners', () => {
    expect(ownershipShares({})).toEqual({ own: 1, debt: 1 });
    expect(ownershipShares({ coOwners: [] })).toEqual({ own: 1, debt: 1 });
    expect(ownershipShares(null)).toEqual({ own: 1, debt: 1 });
  });

  it('50/50: debt follows ownership', () => {
    expect(ownershipShares({ coOwners: [co()] })).toEqual({ own: 0.5, debt: 0.5 });
  });

  it('60/40 ownership with a 50/50 loan', () => {
    expect(ownershipShares({ coOwners: [co({ ownershipPct: 40, debtSharePct: 50 })] })).toEqual({ own: 0.6, debt: 0.5 });
  });

  it('three owners', () => {
    const s = ownershipShares({ coOwners: [co({ ownershipPct: 25 }), co({ id: 'b', ownershipPct: 25, debtSharePct: 40 })] });
    expect(s.own).toBeCloseTo(0.5);
    expect(s.debt).toBeCloseTo(0.35);
  });

  it('user owns 0 % but carries half the loan (co-signs)', () => {
    expect(ownershipShares({ coOwners: [co({ ownershipPct: 100, debtSharePct: 50 })] })).toEqual({ own: 0, debt: 0.5 });
  });

  it('clamps when others sum past 100 %', () => {
    expect(ownershipShares({ coOwners: [co({ ownershipPct: 80 }), co({ id: 'b', ownershipPct: 70 })] })).toEqual({ own: 0, debt: 0 });
  });

  it('treats NaN / non-array / junk rows as nothing', () => {
    expect(ownershipShares({ coOwners: [co({ ownershipPct: NaN })] })).toEqual({ own: 1, debt: 1 });
    expect(ownershipShares({ coOwners: 'x' as unknown as CoOwner[] })).toEqual({ own: 1, debt: 1 });
    expect(ownershipShares({ coOwners: [null as unknown as CoOwner] })).toEqual({ own: 1, debt: 1 });
  });

  it('since/until window is inclusive at both ends', () => {
    const list = [co({ since: '2025-06', until: '2025-12' })];
    expect(activeCoOwners(list, '2025-05')).toHaveLength(0);
    expect(activeCoOwners(list, '2025-06')).toHaveLength(1);
    expect(activeCoOwners(list, '2025-12')).toHaveLength(1);
    expect(activeCoOwners(list, '2026-01')).toHaveLength(0);
    expect(ownershipShares({ coOwners: list }, '2025-09').own).toBe(0.5);
    expect(ownershipShares({ coOwners: list }, '2026-01').own).toBe(1);
  });

  it('scales value and debt by their own shares', () => {
    const a = { houseValue: 6_000_000, houseDebt: 4_000_000, coOwners: [co({ ownershipPct: 40, debtSharePct: 50 })] };
    expect(myHouseValue(a)).toBe(3_600_000);
    expect(myHouseDebt(a)).toBe(2_000_000);
  });
});

describe('primaryHomeWealthValue (70 % threshold on the whole home)', () => {
  it('is the identity at 100 %', () => {
    expect(primaryHomeWealthValue(16_000_000, 1)).toBe(16_000_000);
  });

  // Skatte-ABC B-11-2.7.1 worked example: 16 MNOK, 50 % → 3 350 000.
  it.each([4_000_000, 10_000_000, 16_000_000])('values a 50 %% share of %i at half the whole home', (v) => {
    const mine = primaryHomeWealthValue(v, 0.5);
    expect(valued(mine)).toBeCloseTo(valued(v) * 0.5, 4);
  });

  it('matches the Skatteetaten example (Skatte-ABC B-11-2.7.1, 10 MNOK threshold in 2025)', () => {
    const valued2025 = (v: number) => calcWealthTax({ primaryHomeValue: v, shares: 0, otherAssets: 0, debt: 0 }, 2025).valuedAssets;
    expect(WEALTH_TAX_PARAMS[2025].primaryHomeHighThreshold).toBe(10_000_000);
    expect(valued2025(primaryHomeWealthValue(16_000_000, 0.5, 2025))).toBeCloseTo(3_350_000, 4);
    // Valuing the 8 M share alone would under-state it at 2 000 000.
    expect(valued2025(8_000_000)).toBe(2_000_000);
  });

  it('below the threshold it is just the share of the value', () => {
    expect(primaryHomeWealthValue(4_000_000, 0.5)).toBeCloseTo(2_000_000, 6);
  });

  it('0 % share → 0', () => {
    expect(primaryHomeWealthValue(16_000_000, 0)).toBe(0);
    expect(primaryHomeWealthValueOfShare(0, 0)).toBe(0);
  });

  it('the share-input form agrees with the full-value form', () => {
    expect(primaryHomeWealthValueOfShare(8_000_000, 0.5)).toBeCloseTo(primaryHomeWealthValue(16_000_000, 0.5), 6);
    expect(myPrimaryHomeWealthValue({ houseValue: 16_000_000, coOwners: [co()] }))
      .toBeCloseTo(primaryHomeWealthValue(16_000_000, 0.5), 6);
  });
});

describe('mySaleProceeds', () => {
  // 6 M sale, 200 k costs, 3 M loan → 2.8 M net for the whole property.
  it('is the whole net with no co-owners', () => {
    expect(mySaleProceeds(2_800_000, 3_000_000, { own: 1, debt: 1 })).toBe(2_800_000);
  });
  it('splits proceeds by ownership and the loan by debt share', () => {
    expect(mySaleProceeds(2_800_000, 3_000_000, { own: 0.5, debt: 0.5 })).toBe(1_400_000);
    // 60 % of 5.8 M − 50 % of 3 M
    expect(mySaleProceeds(2_800_000, 3_000_000, { own: 0.6, debt: 0.5 })).toBeCloseTo(1_980_000, 6);
  });
});

describe('validateCoOwners', () => {
  it('accepts a valid list', () => {
    expect(validateCoOwners([co(), co({ id: 'b', ownershipPct: 30, debtSharePct: 20, since: '2024-01' })])).toEqual({ ok: true });
  });
  it('rejects out-of-range percents', () => {
    expect(validateCoOwners([co({ ownershipPct: 120 })])).toEqual({ ok: false, error: 'range' });
    expect(validateCoOwners([co({ debtSharePct: -1 })])).toEqual({ ok: false, error: 'range' });
  });
  it('rejects ownership over 100 % at any one month', () => {
    expect(validateCoOwners([co({ ownershipPct: 60 }), co({ id: 'b', ownershipPct: 50 })])).toEqual({ ok: false, error: 'sumOwnership' });
  });
  it('allows owners that never overlap to add past 100 %', () => {
    expect(validateCoOwners([
      co({ ownershipPct: 60, until: '2024-12' }),
      co({ id: 'b', ownershipPct: 60, since: '2025-01' }),
    ])).toEqual({ ok: true });
  });
  it('rejects loan share over 100 %', () => {
    expect(validateCoOwners([co({ debtSharePct: 70 }), co({ id: 'b', ownershipPct: 10, debtSharePct: 40 })]))
      .toEqual({ ok: false, error: 'sumDebt' });
  });
  it('rejects since after until and malformed months', () => {
    expect(validateCoOwners([co({ since: '2025-06', until: '2025-01' })])).toEqual({ ok: false, error: 'dates' });
    expect(validateCoOwners([co({ since: '2025-13' })])).toEqual({ ok: false, error: 'dates' });
  });
});

describe('snapshot co-owners ("owned since")', () => {
  const START = '2024-01';
  const months = Array.from({ length: 24 }, (_, i) => addMonthsKey(START, i));
  const snaps: Record<string, BalanceSnapshot> = Object.fromEntries(months.map(m => [m, {
    assets: { houseValue: 4_000_000, houseDebt: 2_000_000 },
  } as unknown as BalanceSnapshot]));
  const equity = (s: Record<string, BalanceSnapshot>, m: string) => computeEquityBreakdown(s[m].assets).houseEquity;

  it('strips since/until and keeps only rows active that month', () => {
    const list = [co({ since: '2024-06', until: '2025-06' })];
    expect(snapshotCoOwners(list, '2024-05')).toEqual([]);
    expect(snapshotCoOwners(list, '2024-06')).toEqual([{ id: 'coo-1', name: 'Medeier 1', ownershipPct: 50 }]);
  });

  it('halves house equity from month 6 on, earlier months unchanged', () => {
    const out = rewriteSnapshotCoOwners(snaps, [co({ since: months[5] })]);
    expect(equity(out, months[4])).toBe(2_000_000);
    expect(equity(out, months[5])).toBe(1_000_000);
    expect(equity(out, months[23])).toBe(1_000_000);
    // Untouched months keep their identity (no rewrite of history that never had a co-owner).
    expect(out[months[4]]).toBe(snaps[months[4]]);
  });

  it('a co-owner who sold in month 18 leaves months ≥ 19 at 100 %', () => {
    const out = rewriteSnapshotCoOwners(snaps, [co({ since: months[5], until: months[18] })]);
    expect(equity(out, months[18])).toBe(1_000_000);
    expect(equity(out, months[19])).toBe(2_000_000);
  });

  it('deleting the co-owner restores every month', () => {
    const withCo = rewriteSnapshotCoOwners(snaps, [co({ since: months[5] })]);
    const back = rewriteSnapshotCoOwners(withCo, []);
    for (const m of months) expect(equity(back, m)).toBe(2_000_000);
  });
});

describe('sanitizeCoOwners', () => {
  it('non-array → []', () => {
    expect(sanitizeCoOwners(undefined)).toEqual([]);
    expect(sanitizeCoOwners({})).toEqual([]);
  });
  it('gives an id-less row the same id on every load, never a taken one', () => {
    const raw = [{ id: 'coo-2', name: 'B', ownershipPct: 10 }, { name: 'A', ownershipPct: 10 }];
    expect(sanitizeCoOwners(raw)[1].id).toBe(sanitizeCoOwners(raw)[1].id);
    expect(sanitizeCoOwners(raw)[1].id).not.toBe('coo-2');
  });
  it('treats a null loan share as following ownership', () => {
    expect(sanitizeCoOwners([{ id: 'a', name: 'A', ownershipPct: 40, debtSharePct: null }])[0].debtSharePct).toBeUndefined();
  });
  it('coerces numerics, drops bad months, keeps a row without id', () => {
    const [row] = sanitizeCoOwners([{ name: 'A', ownershipPct: '50', debtSharePct: 'x', since: 202401, until: '2025-02' }]);
    expect(row.id).toMatch(/^coo-/);
    expect(row).toMatchObject({ name: 'A', ownershipPct: 50, debtSharePct: 0, until: '2025-02' });
    expect(row.since).toBeUndefined();
  });
  it('leaves snapshots without the key untouched', () => {
    const snaps = { '2025-01': { assets: { houseValue: 1 } } } as unknown as Record<string, BalanceSnapshot>;
    expect(sanitizeSnapshotCoOwners(snaps)).toBe(snaps);
    const withKey = { '2025-01': { assets: { houseValue: 1, coOwners: 'bad' } } } as unknown as Record<string, BalanceSnapshot>;
    expect(sanitizeSnapshotCoOwners(withKey)['2025-01'].assets.coOwners).toEqual([]);
  });
});

describe('withOwnershipShare (the onboarding question)', () => {
  const M = '2026-11';
  const fresh = { id: 'coo-new', name: 'Medeier 1' };

  it('100 % with no co-owner leaves the list as it is', () => {
    const list: CoOwner[] = [];
    expect(withOwnershipShare(list, 100, M, fresh)).toBe(list);
  });

  it('below 100 % adds one co-owner holding the rest, from this month without a move-in', () => {
    const next = withOwnershipShare([], 60, M, fresh)!;
    expect(next).toEqual([{ ...fresh, ownershipPct: 40, since: M }]);
    expect(ownershipShares({ coOwners: next }, M)).toEqual({ own: 0.6, debt: 0.6 });
  });

  it("a new co-owner owns since the current home's move-in month, like the Bolig page", () => {
    expect(withOwnershipShare([], 60, M, fresh, '2021-08')).toEqual([{ ...fresh, ownershipPct: 40, since: '2021-08' }]);
    // A move-in still ahead (or unreadable) falls back to this month, so the answer holds now.
    expect(withOwnershipShare([], 60, M, fresh, '2027-02')).toEqual([{ ...fresh, ownershipPct: 40, since: M }]);
    expect(withOwnershipShare([], 60, M, fresh, 'soon')).toEqual([{ ...fresh, ownershipPct: 40, since: M }]);
  });

  it('keeps a co-owner who has left and adds the new one beside them', () => {
    const left = co({ id: 'old', since: '2020-01', until: '2024-12' });
    expect(withOwnershipShare([left], 70, M, fresh)).toEqual([left, { ...fresh, ownershipPct: 30, since: M }]);
  });

  it('a co-owner added this month is edited in place, keeping a separate loan share', () => {
    const c = co({ since: M, debtSharePct: 30 });
    expect(withOwnershipShare([c], 75, M, fresh)).toEqual([{ ...c, ownershipPct: 25 }]);
  });

  it('never edits an earlier co-owner in place: their row ends last month and a new one starts now', () => {
    const c = co({ since: '2023-04', debtSharePct: 30 });
    const next = withOwnershipShare([c], 75, M, fresh)!;
    expect(next).toEqual([
      { ...c, until: '2026-10' },
      { ...c, id: fresh.id, ownershipPct: 25, since: M },
    ]);
    // History before this month keeps the 50/50 split.
    expect(ownershipShares({ coOwners: next }, '2024-06').own).toBe(0.5);
    expect(ownershipShares({ coOwners: next }, M).own).toBe(0.75);
    // An undated co-owner the same way.
    expect(withOwnershipShare([co()], 90, M, fresh)).toEqual([
      co({ until: '2026-10' }), co({ id: fresh.id, ownershipPct: 10, since: M }),
    ]);
  });

  it('the same share changes nothing', () => {
    const list = [co({ since: '2023-04' })];
    expect(withOwnershipShare(list, 50, M, fresh)).toBe(list);
  });

  it('back to 100 %: a co-owner added this month is removed, an older one ends last month', () => {
    expect(withOwnershipShare([co({ since: M })], 100, M, fresh)).toEqual([]);
    expect(withOwnershipShare([co({ since: '2023-04' })], 100, M, fresh))
      .toEqual([co({ since: '2023-04', until: '2026-10' })]);
    expect(withOwnershipShare([co()], 100, M, fresh)).toEqual([co({ until: '2026-10' })]);
  });

  it('leaves richer setups to the Bolig page (null)', () => {
    expect(withOwnershipShare([co({ id: 'a', ownershipPct: 20 }), co({ id: 'b', ownershipPct: 20 })], 50, M, fresh)).toBeNull();
    expect(withOwnershipShare([co({ until: '2027-06' })], 50, M, fresh)).toBeNull();
  });

  it('clamps the share and never returns an invalid list', () => {
    expect(withOwnershipShare([], 150, M, fresh)).toEqual([]);
    expect(withOwnershipShare([], -5, M, fresh)).toEqual([{ ...fresh, ownershipPct: 100, since: M }]);
    expect(withOwnershipShare([], NaN, M, fresh)).toBeNull();
    // A co-owner joining at 60 % next year would overlap a new 50 % one: null, not an invalid list.
    expect(withOwnershipShare([co({ id: 'later', ownershipPct: 60, since: '2027-06' })], 50, M, fresh)).toBeNull();
  });
});
