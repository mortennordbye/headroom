import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTableNumber, calcTabelltrekk, TREKK_PARAMS, type PayPeriod } from './forskuddstrekk';

// Checks the port against a whole year of Skatteetaten's "trekktabeller i
// tekstformat" file (fixed width: table 4, period 1, type 1, grunnlag 6,
// trekk 6). Skipped in the normal suite; the yearly table-update workflow
// (.github/workflows/trekk-tables.yml) runs it with the downloaded file:
//
//   TREKK_FILE=alleTabellene.txt TREKK_YEAR=2027 npx vitest run src/lib/forskuddstrekk.file.test.ts
const FILE = process.env.TREKK_FILE;
const YEAR = Number(process.env.TREKK_YEAR);
const PERIODS: Record<string, PayPeriod> = { '1': 'month', '2': '14d', '3': 'week' };

describe.skipIf(!FILE)('trekk tables file', () => {
  it('has constants for the year', () => {
    expect(TREKK_PARAMS[YEAR]).toBeDefined();
  });

  it('matches every monthly, 14-day and weekly lønn row', () => {
    const lines = readFileSync(FILE!, 'latin1').split(/\r?\n/);
    const unknown = new Set<string>();
    const mismatches: string[] = [];
    let checked = 0;
    for (const l of lines) {
      const period = PERIODS[l[4]];
      if (l.length < 18 || !period || l[5] !== '0') continue;
      const t = parseTableNumber(l.slice(0, 4));
      if (!t) { unknown.add(l.slice(0, 4)); continue; }
      checked++;
      const grunnlag = Number(l.slice(6, 12));
      const trekk = Number(l.slice(12, 18));
      const got = calcTabelltrekk(t, grunnlag, YEAR, period);
      if (got !== trekk && mismatches.length < 20) mismatches.push(`${l.slice(0, 4)} ${period} ${grunnlag}: file ${trekk}, got ${got}`);
    }
    expect([...unknown], 'table numbers the catalogue does not know').toEqual([]);
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
  });
});
