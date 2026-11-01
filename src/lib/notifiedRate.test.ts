import { describe, it, expect } from 'vitest';
import { withNotifiedRate } from './notifiedRate';

const H = { originalLoanAmount: 1, rente: 5, nedbetalingstid: 20, termingebyr: 50, notifiedRate: 5.7, notifiedRateFrom: '2026-08' };

describe('withNotifiedRate', () => {
  it('keeps the current rate before the notified month', () => {
    expect(withNotifiedRate(H, '2026-07')).toBe(H);
  });

  it('applies the notified rate from its month on and drops the notice', () => {
    for (const month of ['2026-08', '2026-09', '2027-01']) {
      const r = withNotifiedRate(H, month);
      expect(r.rente).toBe(5.7);
      expect(r).not.toHaveProperty('notifiedRate');
      expect(r).not.toHaveProperty('notifiedRateFrom');
      expect(r).toMatchObject({ originalLoanAmount: 1, nedbetalingstid: 20, termingebyr: 50 });
    }
  });

  it('does not mutate the input', () => {
    withNotifiedRate(H, '2026-09');
    expect(H.rente).toBe(5);
    expect(H.notifiedRate).toBe(5.7);
  });

  it('never applies a notice without a valid month or a usable rate', () => {
    const cases = [
      { ...H, notifiedRateFrom: undefined },
      { ...H, notifiedRateFrom: '' },
      { ...H, notifiedRateFrom: 'soon' },
      { ...H, notifiedRate: undefined },
      { ...H, notifiedRate: NaN },
      { ...H, notifiedRate: 0 },
      { ...H, notifiedRate: -1 },
    ];
    for (const h of cases) expect(withNotifiedRate(h, '2030-01')).toBe(h);
  });

  it('passes a missing slice through', () => {
    expect(withNotifiedRate(undefined, '2026-09')).toBeUndefined();
    expect(withNotifiedRate(null, '2026-09')).toBeNull();
  });
});
