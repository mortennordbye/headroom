import { describe, it, expect } from 'vitest';
import { bsuStatus, BSU_ANNUAL_CAP, BSU_LIFETIME_CAP } from './bsu';

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
