import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { computeEquityBreakdown } from '../src/lib/equity';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

describe('seed.js', () => {
  it('seeds a homeowner whose mortgage balance is stored once', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'headroom-seed-'));
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
      const db = new Database(path.join(dir, 'database.sqlite'), { readonly: true });
      const blob = JSON.parse(db.prepare('SELECT content FROM finance_data WHERE id = ?').get('headroom').content);
      db.close();
      expect(blob.housingMode).toBe('homeowner');
      expect(blob.assets.houseDebt).toBe(3_200_000);
      expect(blob.homeowner).not.toHaveProperty('currentMortgageBalance');
      expect(blob.transition).not.toHaveProperty('currentMortgageBalance');
      expect(blob.transition.currentHouseValue).toBe(blob.assets.houseValue);
      expect(blob.homeowner.currentMortgageBalanceAsOf).toMatch(/^\d{4}-\d{2}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ends the net-worth history at the app's computed net worth, with no jump", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'headroom-seed-'));
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
      const db = new Database(path.join(dir, 'database.sqlite'), { readonly: true });
      const blob = JSON.parse(db.prepare('SELECT content FROM finance_data WHERE id = ?').get('headroom').content);
      db.close();
      const debt = (blob.debts ?? []).reduce((s, d) => s + Math.max(0, d.balance), 0);
      const computed = Math.round(computeEquityBreakdown(blob.assets).totalEquity - debt);
      const months = Object.keys(blob.netWorthHistory).sort();
      const values = months.map((m) => blob.netWorthHistory[m]);
      expect(values[values.length - 1]).toBe(computed);
      for (let i = 1; i < values.length; i++) {
        expect(Math.abs(values[i] / values[i - 1] - 1)).toBeLessThan(0.03);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
