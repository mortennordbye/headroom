import { describe, it, expect } from 'vitest';
import { bsuStatus, bsuDepositedAfterPosting, calcBsuTaxCredit, BSU_ANNUAL_CAP, BSU_LIFETIME_CAP } from './bsu';

const snap = (bsu: number) => ({ assets: { bsu } });

describe('bsuStatus', () => {
  it('derives contributed-this-year from the prior-year-end baseline', () => {
    const snapshots = { '2025-12': snap(50000), '2026-03': snap(60000) };
    const s = bsuStatus(70000, snapshots, 2026);
    // 70k now − 50k entering the year = 20k contributed.
    expect(s.contributedThisYear).toBe(20000);
    expect(s.annualRoomLeft).toBe(BSU_ANNUAL_CAP - 20000); // 7 500
    expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP - 70000);
    expect(s.atAnnualCap).toBe(false);
  });

  it('falls back to the earliest in-year snapshot when nothing precedes the year', () => {
    const snapshots = { '2026-02': snap(80000), '2026-05': snap(90000) };
    const s = bsuStatus(95000, snapshots, 2026);
    expect(s.contributedThisYear).toBe(15000); // 95k − 80k
  });

  it('assumes no contribution when there are no snapshots to anchor on', () => {
    const s = bsuStatus(40000, {}, 2026);
    expect(s.contributedThisYear).toBe(0);
    expect(s.annualRoomLeft).toBe(BSU_ANNUAL_CAP);
  });

  it('flags the annual cap once the year contribution meets it', () => {
    const snapshots = { '2025-12': snap(0) };
    const s = bsuStatus(30000, snapshots, 2026);
    expect(s.contributedThisYear).toBe(30000);
    expect(s.annualRoomLeft).toBe(0);
    expect(s.atAnnualCap).toBe(true);
  });

  it('flags the lifetime cap and never returns negative room', () => {
    const snapshots = { '2025-12': snap(295000) };
    const s = bsuStatus(300000, snapshots, 2026);
    expect(s.lifetimeRoomLeft).toBe(0);
    expect(s.atLifetimeCap).toBe(true);
    // Contributed 5k this year → annual room stays positive, never negative.
    expect(s.annualRoomLeft).toBe(BSU_ANNUAL_CAP - 5000);
  });

  it('guards a NaN balance to zero', () => {
    const s = bsuStatus(NaN, {}, 2026);
    expect(s.balance).toBe(0);
    expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP);
  });
});

describe('bsuStatus lifetime room basis', () => {
  it('falls back to the balance when total deposited is absent', () => {
    const s = bsuStatus(120000, {}, 2026);
    expect(s.lifetimeBasis).toBe('balance');
    expect(s.lifetimeCounted).toBe(120000);
    expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP - 120000);
  });

  it('measures the lifetime room against total deposited when given (interest excluded)', () => {
    // 120k balance, of which 110k deposits and 10k interest.
    const s = bsuStatus(120000, {}, 2026, 110000);
    expect(s.lifetimeBasis).toBe('deposits');
    expect(s.lifetimeCounted).toBe(110000);
    expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP - 110000);
    expect(s.atLifetimeCap).toBe(false);
  });

  it('never returns negative room and flags the cap when deposits reach 300 000', () => {
    const s = bsuStatus(330000, {}, 2026, 300000);
    expect(s.lifetimeRoomLeft).toBe(0);
    expect(s.atLifetimeCap).toBe(true);
    const over = bsuStatus(330000, {}, 2026, 310000);
    expect(over.lifetimeRoomLeft).toBe(0);
  });

  it('a balance over 300 000 from interest alone still leaves room on the deposits basis', () => {
    const s = bsuStatus(305000, {}, 2026, 280000);
    expect(s.lifetimeRoomLeft).toBe(20000);
    expect(s.atLifetimeCap).toBe(false);
  });

  it('accepts zero deposited as a real value', () => {
    const s = bsuStatus(0, {}, 2026, 0);
    expect(s.lifetimeBasis).toBe('deposits');
    expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP);
  });

  it('ignores a non-finite or negative total deposited and falls back to the balance', () => {
    for (const bad of [NaN, Infinity, -5000]) {
      const s = bsuStatus(50000, {}, 2026, bad);
      expect(s.lifetimeBasis).toBe('balance');
      expect(s.lifetimeRoomLeft).toBe(BSU_LIFETIME_CAP - 50000);
    }
  });
});

describe('bsuDepositedAfterPosting', () => {
  it('adds an automated deposit to a tracked total', () => {
    expect(bsuDepositedAfterPosting(100000, 110000, 112500)).toBe(102500);
  });
  it('leaves an untracked total untracked', () => {
    expect(bsuDepositedAfterPosting(undefined, 110000, 112500)).toBeUndefined();
  });
  it('never lowers the total on a withdrawal or no-op', () => {
    expect(bsuDepositedAfterPosting(100000, 110000, 105000)).toBe(100000);
    expect(bsuDepositedAfterPosting(100000, 110000, 110000)).toBe(100000);
  });
  it('treats a non-finite balance as 0', () => {
    expect(bsuDepositedAfterPosting(100000, NaN, 2500)).toBe(102500);
  });
});

describe('calcBsuTaxCredit', () => {
  it('gives 10% of the contribution for an eligible young non-homeowner', () => {
    expect(calcBsuTaxCredit(20_000, { age: 25, ownsHome: false })).toBe(2_000);
  });
  it('caps the creditable contribution at the annual cap (max 2 750)', () => {
    expect(calcBsuTaxCredit(40_000, { age: 30, ownsHome: false })).toBe(2_750);
  });
  it('is zero for a homeowner', () => {
    expect(calcBsuTaxCredit(27_500, { age: 25, ownsHome: true })).toBe(0);
  });
  it('is zero past the age limit (through the year you turn 33)', () => {
    expect(calcBsuTaxCredit(27_500, { age: 33, ownsHome: false })).toBe(2_750);
    expect(calcBsuTaxCredit(27_500, { age: 34, ownsHome: false })).toBe(0);
  });
  it('is zero for an unset age (birth year missing → age -1)', () => {
    expect(calcBsuTaxCredit(27_500, { age: -1, ownsHome: false })).toBe(0);
  });
});
