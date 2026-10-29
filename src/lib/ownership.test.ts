import { describe, it, expect } from 'vitest';
import type { BalanceSnapshot, CoOwner } from '../context/FinanceContext';
import {
  activeCoOwners, ownershipShares, myHouseValue, myHouseDebt, primaryHomeWealthValue,
  primaryHomeWealthValueOfShare, myPrimaryHomeWealthValue, validateCoOwners, snapshotCoOwners,
  rewriteSnapshotCoOwners, sanitizeCoOwners, sanitizeSnapshotCoOwners, mySaleProceeds,
} from './ownership';
import { calcWealthTax, WEALTH_TAX_PARAMS, TAX_YEAR } from './norwegianTax';
import { computeEquityBreakdown } from './equity';
import { addMonthsKey } from './date';

const co = (over: Partial<CoOwner> = {}): CoOwner => ({ id: 'coo-1', name: 'Medeier 1', ownershipPct: 50, ...over });
const P = WEALTH_TAX_PARAMS[TAX_YEAR];
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

  it('matches the Skatteetaten example when the threshold is 10 MNOK', () => {
    if (P.primaryHomeHighThreshold !== 10_000_000) return;
    expect(valued(primaryHomeWealthValue(16_000_000, 0.5))).toBeCloseTo(3_350_000, 4);
    // Valuing the 8 M share alone would under-state it at 2 000 000.
    expect(valued(8_000_000)).toBe(2_000_000);
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
