import { describe, it, expect } from 'vitest';
import { feriepengerMonthlyNet, type FeriepengerConfig } from './feriepenger';

const cfg = (over: Partial<FeriepengerConfig> = {}): FeriepengerConfig => ({
  grossAnnual: 600000,
  feriepengesatsPct: 12,
  ...over,
});

describe('feriepengerMonthlyNet', () => {
  const flatNet = 40000; // implied taxAnnual = 600000 - 480000 = 120000

  it('spikes June by the feriepenger lump (no tax that month)', () => {
    const june = feriepengerMonthlyNet('2026-06', flatNet, cfg());
    // feriepenger = 12% of 600000 = 72000
    expect(june).toBeCloseTo(40000 + 72000, 4);
    expect(june).toBeGreaterThan(flatNet);
  });

  it('spikes December by the half-trekk keep-back', () => {
    const dec = feriepengerMonthlyNet('2026-12', flatNet, cfg());
    // decBoost = 120000/24 = 5000
    expect(dec).toBeCloseTo(40000 + 5000, 4);
    expect(dec).toBeGreaterThan(flatNet);
  });

  it('dips ordinary months below the flat net (both boosts recovered)', () => {
    const march = feriepengerMonthlyNet('2026-03', flatNet, cfg());
    // 40000 - 72000/10 - 5000/10 = 40000 - 7700 = 32300
    expect(march).toBeCloseTo(32300, 4);
    expect(march).toBeLessThan(flatNet);
  });

  it('is net-neutral across a calendar year', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
    const total = months.reduce((s, m) => s + feriepengerMonthlyNet(m, flatNet, cfg()), 0);
    expect(total).toBeCloseTo(flatNet * 12, 4);
  });

  it('returns the flat net unchanged when there is no gross salary', () => {
    expect(feriepengerMonthlyNet('2026-06', flatNet, cfg({ grossAnnual: 0 }))).toBe(flatNet);
  });

  it('guards a non-finite flat net', () => {
    expect(feriepengerMonthlyNet('2026-06', NaN, cfg())).toBeNaN();
  });

  it('guards a malformed month key', () => {
    expect(feriepengerMonthlyNet('not-a-month', flatNet, cfg())).toBe(flatNet);
  });

  it('applies no June lump when sats is 0', () => {
    const june = feriepengerMonthlyNet('2026-06', flatNet, cfg({ feriepengesatsPct: 0 }));
    expect(june).toBe(flatNet);
    // December still spikes on the half-trekk alone
    expect(feriepengerMonthlyNet('2026-12', flatNet, cfg({ feriepengesatsPct: 0 }))).toBeCloseTo(45000, 4);
  });
});
