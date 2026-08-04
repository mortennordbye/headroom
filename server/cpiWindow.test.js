import { describe, it, expect } from 'vitest';
import {
  SSB_PUBLICATION_LAG_MONTHS, shiftMonth, monthCount, publishedThrough, isWindowComplete,
} from './cpiWindow.js';

/** Every month from `from` to `to` inclusive — a fully populated cache. */
const range = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m = shiftMonth(m, -1)) out.push(m);
  return out;
};

describe('shiftMonth', () => {
  it('moves back across a year boundary', () => {
    expect(shiftMonth('2026-01', 1)).toBe('2025-12');
    expect(shiftMonth('2026-02', 14)).toBe('2024-12');
  });
  it('moves forward on a negative shift', () => {
    expect(shiftMonth('2025-12', -1)).toBe('2026-01');
  });
  it('zero-pads so keys stay string-comparable', () => {
    expect(shiftMonth('2026-11', 2)).toBe('2026-09');
    expect('2026-09' < '2026-11').toBe(true);
  });
});

describe('monthCount', () => {
  it('counts an inclusive range', () => {
    expect(monthCount('2026-01', '2026-01')).toBe(1);
    expect(monthCount('2025-12', '2026-02')).toBe(3);
  });
  it('is 0 rather than negative for an inverted range', () => {
    expect(monthCount('2026-05', '2026-01')).toBe(0);
  });
});

describe('publishedThrough', () => {
  it('sits the default lag behind the current month', () => {
    expect(publishedThrough('2026-08')).toBe(shiftMonth('2026-08', SSB_PUBLICATION_LAG_MONTHS));
    expect(publishedThrough('2026-08', 2)).toBe('2026-06');
  });
});

describe('isWindowComplete', () => {
  // The regression this exists for: the client asks through the CURRENT month,
  // but SSB's newest published month is ~2 back. Before the fix this window
  // could never be complete, so `stale` was pinned on and the UI showed
  // "could not reach SSB" permanently, even right after a successful fetch.
  it('is complete when the cache holds everything SSB has published', () => {
    const cached = range('2013-08', '2026-06'); // SSB has nothing newer
    expect(isWindowComplete(cached, '2013-08', '2026-08', '2026-08', 2)).toBe(true);
  });

  it('is incomplete when a month inside the published horizon is missing', () => {
    const cached = range('2013-08', '2026-06').filter(m => m !== '2020-03');
    expect(isWindowComplete(cached, '2013-08', '2026-08', '2026-08', 2)).toBe(false);
  });

  it('is incomplete when the cache stops short of the horizon', () => {
    const cached = range('2013-08', '2026-04'); // two published months behind
    expect(isWindowComplete(cached, '2013-08', '2026-08', '2026-08', 2)).toBe(false);
  });

  it('goes incomplete again once SSB publishes a new month', () => {
    const cached = range('2013-08', '2026-06');
    // Same cache, a month later: the horizon advances to 2026-07, which is missing.
    expect(isWindowComplete(cached, '2013-08', '2026-09', '2026-09', 2)).toBe(false);
  });

  it('does not require months past the horizon even when the cache has them', () => {
    const cached = range('2013-08', '2026-06');
    expect(isWindowComplete(cached, '2013-08', '2026-06', '2026-08', 2)).toBe(true);
  });

  it('treats a window entirely in the unpublished tail as complete', () => {
    // Nothing to fetch and nothing to warn about — nobody has these months.
    expect(isWindowComplete([], '2026-07', '2026-08', '2026-08', 2)).toBe(true);
  });

  it('ignores cached months outside the requested window', () => {
    const cached = [...range('2010-01', '2012-12'), ...range('2025-01', '2026-06')];
    expect(isWindowComplete(cached, '2025-01', '2026-08', '2026-08', 2)).toBe(true);
  });

  it('is not fooled by duplicate rows', () => {
    const cached = [...range('2025-01', '2026-05'), ...range('2025-01', '2026-05')];
    // 2026-06 is still genuinely missing; duplicates must not pad the count.
    expect(isWindowComplete(cached, '2025-01', '2026-08', '2026-08', 2)).toBe(false);
  });
});
