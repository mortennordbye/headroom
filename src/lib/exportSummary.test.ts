import { describe, it, expect } from 'vitest';
import { summarizeExport, totalRecords } from './exportSummary';
import type { ExportPayload } from '../context/FinanceContext';

const item = (sections: ReturnType<typeof summarizeExport>, key: string) =>
  sections.flatMap((s) => s.items).find((i) => i.key === key);

describe('summarizeExport', () => {
  it('reports zero for an empty payload without throwing', () => {
    const s = summarizeExport({});
    expect(item(s, 'jobs')?.count).toBe(0);
    expect(item(s, 'transactions')?.count).toBe(0);
    expect(item(s, 'assets')?.present).toBe(false);
    expect(totalRecords({})).toBe(0);
  });

  it('counts array collections by length and record maps by key count', () => {
    const p: Partial<ExportPayload> = {
      dailyTransactions: [
        { id: '1', date: '2026-01-01', description: 'a', amount: 10 },
        { id: '2', date: '2026-01-02', description: 'b', amount: 20 },
      ],
      jobs: [{ id: 'j', startDate: '2025-01', endDate: null, employer: 'X', role: 'r', contractedHoursPerWeek: 37.5 }],
      monthlyIncomes: { '2026-01': 50000, '2026-02': 51000 },
      categoryBudgets: { groceries: 5000 },
    };
    const s = summarizeExport(p);
    expect(item(s, 'transactions')?.count).toBe(2);
    expect(item(s, 'jobs')?.count).toBe(1);
    expect(item(s, 'incomeOverrides')?.count).toBe(2);
    expect(item(s, 'categoryBudgets')?.count).toBe(1);
  });

  it('flags singleton config objects as present when supplied', () => {
    const s = summarizeExport({
      assets: {
        portfolio: 0, unrealizedGain: 0, taxRate: 0, bsu: 0, savings: 0,
        houseValue: 0, houseDebt: 0, crypto: 0, cryptoUnrealizedGain: 0,
        cryptoTaxRate: 0, bufferAccount: 0,
      },
      lang: 'nb',
    });
    expect(item(s, 'assets')?.present).toBe(true);
    expect(item(s, 'preferences')?.present).toBe(true);
    expect(item(s, 'pension')?.present).toBe(false);
  });

  it('sums every collection into totalRecords', () => {
    const p: Partial<ExportPayload> = {
      fixedExpenses: [{ id: '1', name: 'x', amount: 1 }],
      goals: [{ id: 'g', name: 'g', target: 1, source: 'manual' }],
      netWorthHistory: { '2026-01': 1, '2026-02': 2 },
    };
    expect(totalRecords(p)).toBe(4);
  });
});
