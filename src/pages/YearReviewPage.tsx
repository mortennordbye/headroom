import React, { useMemo, useState } from 'react';
import { Printer, PieChart, CalendarRange } from 'lucide-react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { SummaryTile } from '../components/ui/SummaryTile';
import { yearReview, availableReportYears } from '../lib/yearReview';
import { isCategoryKey, categoryMeta } from '../lib/categories';
import { monthsBetween, yearOf, currentMonthKey } from '../lib/date';

const YearReviewPage: React.FC = () => {
  const {
    t, lang, formatCurrency,
    nonTransferTransactions, monthlyIncomes, derivedNetMonthlyFor,
    totalFixedExpenses, payslips, balanceSnapshots, netWorthHistory, netWorth,
  } = useFinance();
  const ty = t.yearReview;
  const dateLocale = lang === 'nb' ? nb : enUS;
  const nowMonthKey = currentMonthKey();

  const years = useMemo(
    () => availableReportYears({
      transactions: nonTransferTransactions, payslips,
      snapshots: balanceSnapshots, netWorthHistory, nowMonthKey,
    }),
    [nonTransferTransactions, payslips, balanceSnapshots, netWorthHistory, nowMonthKey],
  );

  const [picked, setPicked] = useState<number | null>(null);
  const year = picked != null && years.includes(picked) ? picked : (years[0] ?? yearOf(nowMonthKey));

  const review = useMemo(() => {
    const incomeByMonth: Record<string, number> = {};
    for (const m of monthsBetween(`${year}-01`, `${year}-12`)) {
      incomeByMonth[m] = monthlyIncomes[m] ?? derivedNetMonthlyFor(m);
    }
    return yearReview(year, {
      transactions: nonTransferTransactions, incomeByMonth, totalFixedExpenses,
      payslips, snapshots: balanceSnapshots, netWorthHistory,
      currentNetWorth: netWorth, nowMonthKey,
    });
  }, [year, nonTransferTransactions, monthlyIncomes, derivedNetMonthlyFor, totalFixedExpenses, payslips, balanceSnapshots, netWorthHistory, netWorth, nowMonthKey]);

  const hasData = review.months.length > 0 && (review.totalIncome > 0 || review.totalSpending > 0);
  const monthLabel = (m: string) => format(new Date(`${m}-01T00:00:00`), 'MMM', { locale: dateLocale });
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatCurrency(Math.abs(n))}`;
  const maxCat = review.topCategories[0]?.amount ?? 1;

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {ty.heroLabel}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {ty.title} <em className="font-serif italic" style={{ color: 'var(--brass)' }}>{ty.titleEmphasis}</em> {year}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {ty.subtitle}
        </p>
      </header>

      {/* Controls: year picker + print (hidden from the printed page) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2" role="group" aria-label={ty.year}>
          <CalendarRange size={15} strokeWidth={2} style={{ color: 'var(--text-3)' }} />
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setPicked(y)}
              aria-pressed={y === year}
              className="px-3 py-1.5 rounded-[6px] text-[13px] font-medium tabular-nums border transition-colors"
              style={y === year
                ? { background: 'var(--accent-bg)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                : { borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              {y}
            </button>
          ))}
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] text-[13px] font-medium border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          <Printer size={15} strokeWidth={2} />
          <span>{ty.print}</span>
        </button>
      </div>

      {!hasData ? (
        <Card padding="lg">
          <p className="text-[14px] py-6 text-center" style={{ color: 'var(--text-3)' }}>{ty.noData}</p>
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <SummaryTile label={ty.income} value={formatCurrency(review.totalIncome)} />
            <SummaryTile
              label={ty.taxPaid}
              value={review.taxMonths > 0 ? formatCurrency(review.taxPaid) : '—'}
              sub={review.taxMonths > 0 ? ty.fromPayslips.replace('{n}', String(review.taxMonths)) : ty.noPayslips}
              color="var(--warning)"
            />
            <SummaryTile
              label={ty.savingsRate}
              value={`${review.savingsRate}%`}
              color={review.savingsRate >= 0 ? 'var(--positive)' : 'var(--negative)'}
            />
            <SummaryTile
              label={ty.netWorthChange}
              value={review.netWorthChange != null ? signed(review.netWorthChange) : '—'}
              color={review.netWorthChange == null ? undefined : review.netWorthChange >= 0 ? 'var(--positive)' : 'var(--negative)'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Top spending categories */}
            <Card padding="lg">
              <div className="flex items-center gap-2 pb-4 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <PieChart size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
                <SectionLabel>{ty.topCategories}</SectionLabel>
              </div>
              {review.topCategories.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>{ty.noData}</p>
              ) : (
                <ul className="space-y-3">
                  {review.topCategories.map((c) => {
                    const label = isCategoryKey(c.category) ? t.categoryLabels[c.category] : c.category;
                    const color = categoryMeta(c.category)?.color ?? 'var(--text-dim)';
                    return (
                      <li key={c.category}>
                        <div className="flex items-baseline justify-between gap-3 mb-1">
                          <span className="text-[13px]" style={{ color: 'var(--text-1)' }}>{label}</span>
                          <span className="text-[13px] font-mono tabular-nums" style={{ color: 'var(--text-2)' }}>{formatCurrency(c.amount)}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-5)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.round((c.amount / maxCat) * 100)}%`, background: color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* Month by month */}
            <Card padding="lg">
              <div className="flex items-center gap-2 pb-4 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <CalendarRange size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
                <SectionLabel>{ty.monthlyTitle}</SectionLabel>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] tabular-nums">
                  <thead>
                    <tr style={{ color: 'var(--text-3)' }} className="text-left">
                      <th scope="col" className="font-medium pb-2">{ty.month}</th>
                      <th scope="col" className="font-medium pb-2 text-right">{ty.income}</th>
                      <th scope="col" className="font-medium pb-2 text-right">{ty.spending}</th>
                      <th scope="col" className="font-medium pb-2 text-right">{ty.net}</th>
                      <th scope="col" className="font-medium pb-2 text-right">{ty.rate}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.monthly.map((r) => (
                      <tr key={r.month} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-1.5" style={{ color: 'var(--text-2)' }}>{monthLabel(r.month)}</td>
                        <td className="py-1.5 text-right font-mono" style={{ color: 'var(--text-1)' }}>{formatCurrency(r.income)}</td>
                        <td className="py-1.5 text-right font-mono" style={{ color: 'var(--text-2)' }}>{formatCurrency(r.expenses)}</td>
                        <td className="py-1.5 text-right font-mono" style={{ color: r.net >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{signed(r.net)}</td>
                        <td className="py-1.5 text-right font-mono" style={{ color: 'var(--text-3)' }}>{r.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2" style={{ borderColor: 'var(--border-strong)' }}>
                      <td className="pt-2 font-semibold" style={{ color: 'var(--text-1)' }}>{ty.total}</td>
                      <td className="pt-2 text-right font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(review.totalIncome)}</td>
                      <td className="pt-2 text-right font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(review.totalSpending)}</td>
                      <td className="pt-2 text-right font-mono font-semibold" style={{ color: review.totalNet >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{signed(review.totalNet)}</td>
                      <td className="pt-2 text-right font-mono font-semibold" style={{ color: 'var(--text-2)' }}>{review.savingsRate}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ty.approxNote}</p>
        </>
      )}
    </div>
  );
};

export default YearReviewPage;
