import { describe, it, expect } from 'vitest';
import { feriepengerMonthlyNet, feriepengerSurplus, type FeriepengerConfig } from './feriepenger';
import { calcNorwegianTax } from './norwegianTax';
import { parseTableNumber, withholdingByMonth } from './forskuddstrekk';

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

describe('feriepengerSurplus', () => {
  const flat = (gross: number) => () => gross;

  it('is holiday pay minus the fratrekk for the holiday weeks', () => {
    // 12% × 600 000 − 600 000 × 5/52
    expect(feriepengerSurplus(2026, flat(600000), 12)).toBeCloseTo(72000 - (600000 * 5) / 52, 6);
    // 10.2% × 600 000 − 600 000 × (25/6)/52
    expect(feriepengerSurplus(2026, flat(600000), 10.2)).toBeCloseTo(61200 - (600000 * 25) / 6 / 52, 6);
    expect(feriepengerSurplus(2026, flat(600000), 14.3)).toBeCloseTo(85800 - (600000 * 6) / 52, 6);
  });

  it('bases the holiday pay on last year and the fratrekk on this June', () => {
    const grossFor = (k: string) => (k.startsWith('2025-') ? 500000 : 600000);
    expect(feriepengerSurplus(2026, grossFor, 12)).toBeCloseTo(60000 - (600000 * 5) / 52, 6);
  });

  it('assumes last year equals this June when no history is entered', () => {
    const grossFor = (k: string) => (k.startsWith('2026-') ? 600000 : 0);
    expect(feriepengerSurplus(2026, grossFor, 12)).toBeCloseTo(feriepengerSurplus(2026, flat(600000), 12), 6);
  });

  it('closes most of the gap between table withholding and modelled tax', () => {
    // Table 8000 is the plain card; its trekk assumes the surplus is income.
    const card = { kind: 'table' as const, table: '8000', year: 2026 };
    const trekk = withholdingByMonth(card, () => 50000, undefined, 2026).reduce((s, v) => s + v, 0);
    const without = calcNorwegianTax(600000, 0, 2026).totalTax;
    const withSurplus = calcNorwegianTax(600000 + feriepengerSurplus(2026, flat(600000), 12), 0, 2026).totalTax;
    expect(parseTableNumber('8000')).not.toBeNull();
    expect(Math.abs(trekk - withSurplus)).toBeLessThan(Math.abs(trekk - without) / 10);
  });

  it('is 0 without a usable sats and never NaN', () => {
    expect(feriepengerSurplus(2026, flat(600000), 0)).toBe(0);
    expect(feriepengerSurplus(2026, flat(600000), NaN)).toBe(0);
    expect(feriepengerSurplus(2026, () => NaN, 12)).toBe(0);
  });
});
