import { describe, it, expect } from 'vitest';
import { fillMonthGaps } from './monthGrid';

type Row = { m: string; v: number | null };
const gap = (m: string): Row => ({ m, v: null });

describe('fillMonthGaps', () => {
  it('inserts null-valued rows for skipped months between first and last', () => {
    const recorded: Row[] = [{ m: '2026-01', v: 10 }, { m: '2026-04', v: 40 }];
    const out = fillMonthGaps(recorded, r => r.m, gap);
    expect(out.map(r => r.m)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(out.map(r => r.v)).toEqual([10, null, null, 40]); // gaps → null → line breaks
  });

  it('leaves a contiguous run untouched', () => {
    const recorded: Row[] = [{ m: '2026-01', v: 1 }, { m: '2026-02', v: 2 }];
    expect(fillMonthGaps(recorded, r => r.m, gap)).toEqual(recorded);
  });

  it('crosses a year boundary', () => {
    const out = fillMonthGaps([{ m: '2025-11', v: 1 }, { m: '2026-02', v: 2 }], r => r.m, gap);
    expect(out.map(r => r.m)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('is empty for no rows', () => {
    expect(fillMonthGaps([], (r: Row) => r.m, gap)).toEqual([]);
  });
});
