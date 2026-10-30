import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

describe('seed.js', () => {
  it('seeds a homeowner whose three mortgage slices agree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'headroom-seed-'));
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
      const db = new Database(path.join(dir, 'database.sqlite'), { readonly: true });
      const blob = JSON.parse(db.prepare('SELECT content FROM finance_data WHERE id = ?').get('headroom').content);
      db.close();
      expect(blob.housingMode).toBe('homeowner');
      expect(blob.assets.houseDebt).toBe(blob.homeowner.currentMortgageBalance);
      expect(blob.transition.currentMortgageBalance).toBe(blob.homeowner.currentMortgageBalance);
      expect(blob.transition.currentHouseValue).toBe(blob.assets.houseValue);
      expect(blob.homeowner.currentMortgageBalanceAsOf).toMatch(/^\d{4}-\d{2}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
