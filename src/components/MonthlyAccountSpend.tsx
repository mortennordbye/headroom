import { useMemo } from 'react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import { lastNMonthKeys } from '../lib/date';
import { accountMonthlyTotals, monthlyColumnTotals } from '../lib/monthlySpend';
import { accountToken } from '../lib/accountColor';

const MONTHS = 6;

// Spending per connected account per month (last 6), from the real transaction
// data (internal transfers netted out). Hidden when no account-tagged spend.
export function MonthlyAccountSpend() {
  const { t, lang, currentMonth, nonTransferTransactions, accountLabels, formatCurrency } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const { months, rows, colTotals } = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, MONTHS);
    const rows = accountMonthlyTotals(nonTransferTransactions, accountLabels, months);
    return { months, rows, colTotals: monthlyColumnTotals(rows, MONTHS) };
  }, [currentMonth, nonTransferTransactions, accountLabels]);

  if (rows.length === 0) return null;
  const cell = 'text-right py-1.5 px-2 font-mono whitespace-nowrap';

  return (
    <div className="bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)] mb-3">
        {t.budgetPage.perAccountMonthly}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-[var(--text-2)]">
              <th scope="col" className="text-left font-medium py-1.5 pr-3">{t.budgetPage.accountFilterLabel}</th>
              {months.map((m) => (
                <th scope="col" key={m} className="text-right font-medium py-1.5 px-2 whitespace-nowrap capitalize">
                  {format(new Date(`${m}-01T00:00:00`), 'MMM', { locale: dateLocale })}
                </th>
              ))}
              <th scope="col" className="text-right font-semibold py-1.5 pl-2">{t.budgetPage.total}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `var(${accountToken(r.key)})` }} />
                    {r.label}
                  </span>
                </td>
                {r.totals.map((v, i) => (
                  <td key={i} className={`${cell} text-[var(--text-2)]`}>{v ? formatCurrency(v) : '–'}</td>
                ))}
                <td className={`${cell} font-semibold text-[var(--text-1)]`}>{formatCurrency(r.sum)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)] font-semibold text-[var(--text-1)]">
              <td className="py-1.5 pr-3">{t.budgetPage.total}</td>
              {colTotals.map((v, i) => (
                <td key={i} className={cell}>{v ? formatCurrency(v) : '–'}</td>
              ))}
              <td className={cell}>{formatCurrency(colTotals.reduce((a, b) => a + b, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
