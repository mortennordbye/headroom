import { useFinance } from '../context/FinanceContext';

// A compact stacked bar showing how gross (asset) equity splits into your true
// net equity plus the debt layered on top — the "leverage" view. Net worth stays
// the honest headline; this makes the debt transparent and flags studielån (soft)
// distinctly from other debt (hard). Hidden when there's no non-mortgage debt.
//
// Defaults to the live context figures; the Assets time machine passes the
// viewed month's values so history doesn't mix past assets with today's debt.
interface EquityCompositionBarProps {
  netWorth?: number;
  totalDebt?: number;
  studentDebt?: number;
}

export function EquityCompositionBar(props: EquityCompositionBarProps = {}) {
  const { t, netWorth: liveNetWorth, totalDebt: liveTotalDebt, studentDebt: liveStudentDebt, formatCurrency } = useFinance();
  const netWorth = props.netWorth ?? liveNetWorth;
  const totalDebt = props.totalDebt ?? liveTotalDebt;
  const studentDebt = props.studentDebt ?? liveStudentDebt;
  const otherDebt = Math.max(0, totalDebt - studentDebt);
  const total = netWorth + totalDebt; // = asset equity (mortgage already netted in property)
  if (totalDebt <= 0 || total <= 0) return null;

  const pct = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const segments = [
    { key: 'eq', label: t.dashboardPage.compNetEquity, value: netWorth, color: 'var(--accent)' },
    ...(studentDebt > 0 ? [{ key: 'stud', label: t.dashboardPage.compStudentDebt, value: studentDebt, color: 'var(--text-3)' }] : []),
    ...(otherDebt > 0 ? [{ key: 'oth', label: t.dashboardPage.compOtherDebt, value: otherDebt, color: 'var(--negative)' }] : []),
  ];

  return (
    <div className="mt-3">
      <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-elev)' }}>
        {segments.map((s) => (
          <div key={s.key} style={{ width: pct(s.value), background: s.color }} title={`${s.label}: ${formatCurrency(s.value)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]" style={{ color: 'var(--text-2)' }}>
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            {s.label} <span className="tabular-nums font-medium" style={{ color: 'var(--text-1)' }}>{formatCurrency(s.value)}</span>
          </span>
        ))}
      </div>
      {studentDebt > 0 && (
        <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
          {t.dashboardPage.exStudentLoan} <span className="tabular-nums">{formatCurrency(netWorth + studentDebt)}</span>
        </div>
      )}
    </div>
  );
}
