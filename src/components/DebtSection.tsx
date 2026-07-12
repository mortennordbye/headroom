import { useState } from 'react';
import { PlusCircle, Trash2, Landmark } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useFinance, type Debt, type DebtType } from '../context/FinanceContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import EditModal, { type ModalField } from './EditModal';
import ConfirmModal from './ConfirmModal';
import ChartTooltip from './ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import { amortize, planPayoff, formatMonths, DEBT_TYPES, type PayoffStrategy } from '../lib/debt';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber, isValidYearMonth } from '../lib/validators';
import DebtPaydownVsPlanChart from './charts/DebtPaydownVsPlanChart';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

// Debt-type role colours (CHART token mirrors — reused for swatches and the chart).
const DEBT_TYPE_COLOR: Record<DebtType, string> = {
  student: CHART.teal,
  consumer: CHART.slate,
  credit_card: CHART.rust, // typically the priciest
  other: CHART.textDim,
};

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
}

export default function DebtSection() {
  const { t, lang, debts, setDebts, totalDebt, formatCurrency } = useFinance();
  const reduced = useReducedMotion();
  // Deferment is a real-world timeline, so measure it from the actual current
  // month, not the header picker's month.
  const nowKey = currentMonthKey();
  // A student loan is deferred (interest-free, no payment) while its
  // interest-free month is still in the future — Lånekassen "while studying".
  const isDeferred = (dbt: Debt) => dbt.interestFreeUntil != null && dbt.interestFreeUntil > nowKey;
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Debt | null>(null);
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
  const [extra, setExtra] = useState(0);

  const d = t.debt;
  const typeOptions = DEBT_TYPES.map(v => ({ value: v, label: d.types[v] }));
  const parseNum = (s: string) => { const n = parseLocaleNumber(s); return isNaN(n) || n < 0 ? null : n; };

  const revolvingOptions = [
    { value: 'no', label: d.revolvingNo },
    { value: 'yes', label: d.revolvingYes },
  ];
  const debtFields = (val: Partial<Debt>): ModalField[] => [
    { key: 'name', label: d.name, type: 'text', value: val.name ?? '' },
    { key: 'type', label: d.typeLabel, type: 'select', value: val.type ?? 'student', options: typeOptions },
    { key: 'balance', label: d.balance, type: 'number', value: val.balance != null ? String(val.balance) : '' },
    { key: 'revolving', label: d.revolvingLabel, type: 'select', value: val.revolving ? 'yes' : 'no', options: revolvingOptions },
    { key: 'rate', label: d.rate, type: 'number', value: val.rate != null ? String(val.rate) : '' },
    { key: 'minPayment', label: d.minPayment, type: 'number', value: val.minPayment != null ? String(val.minPayment) : '' },
    // Lånekassen interest-free/deferred month — only meaningful for student loans.
    {
      key: 'interestFreeUntil', label: d.interestFreeLabel, type: 'monthpicker', pickerMode: 'month',
      value: val.interestFreeUntil ?? '', hint: d.interestFreeHint,
      showWhen: (v) => v.type === 'student',
    },
  ];

  const validate = (v: Record<string, string>) => {
    const revolving = v.revolving === 'yes';
    const balance = parseNum(v.balance);
    if (!v.name.trim() || balance === null) return null;
    // A revolving card is paid in full → rate/minPayment are irrelevant (default 0
    // and never used in the payoff plan). Otherwise both are required.
    const rate = parseNum(v.rate), minPayment = parseNum(v.minPayment);
    if (!revolving && (rate === null || minPayment === null)) return null;
    return {
      name: v.name.trim(),
      type: v.type as DebtType,
      balance,
      rate: revolving ? 0 : rate!,
      minPayment: revolving ? 0 : minPayment!,
      revolving,
      // Persist an interest-free month only for a (non-revolving) student loan.
      interestFreeUntil: v.type === 'student' && !revolving && isValidYearMonth(v.interestFreeUntil)
        ? v.interestFreeUntil : undefined,
    };
  };
  const err = () => setModal(p => p && { ...p, error: t.validation.fillAllFields });

  const openAdd = () => setModal({
    title: d.add, fields: debtFields({}),
    onSave: v => { const parsed = validate(v); if (!parsed) return err(); setDebts([...debts, { id: crypto.randomUUID(), ...parsed }]); setModal(null); },
  });
  const openEdit = (debt: Debt) => setModal({
    title: debt.name, fields: debtFields(debt),
    onSave: v => { const parsed = validate(v); if (!parsed) return err(); setDebts(debts.map(x => x.id === debt.id ? { ...x, ...parsed } : x)); setModal(null); },
  });

  const plan = planPayoff(debts, extra, strategy, nowKey);
  const baseline = planPayoff(debts, 0, strategy, nowKey);
  const interestSaved = isFinite(baseline.totalInterest) && isFinite(plan.totalInterest)
    ? Math.max(0, baseline.totalInterest - plan.totalInterest) : 0;
  const fmtAxis = (v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));

  return (
    <div data-tour="debt" className={`${card} p-5 md:p-7 space-y-5`}>
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Landmark size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h2 className={sectionLabel}>{d.title}</h2>
        </div>
        <button onClick={openAdd} className="text-[var(--accent)] hover:opacity-70 transition-opacity" aria-label={d.add}>
          <PlusCircle size={18} strokeWidth={2} />
        </button>
      </div>

      {debts.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>{d.none}</p>
      ) : (
        <>
          {/* Ledger */}
          <div className="space-y-0">
            {debts.map(debt => {
              const deferred = isDeferred(debt);
              const a = debt.revolving || deferred ? null : amortize(debt.balance, debt.rate, debt.minPayment);
              return (
                <div key={debt.id} className="flex items-center justify-between group py-3 border-b border-[var(--border)] last:border-0 gap-3">
                  <button type="button" aria-label={`${t.edit} — ${debt.name}`} className="min-w-0 cursor-pointer text-left" onClick={() => openEdit(debt)}>
                    <div className="flex items-center gap-2">
                      <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: DEBT_TYPE_COLOR[debt.type] }} />
                      <span className="text-[13px] font-medium text-[var(--text-1)] truncate">{debt.name}</span>
                      <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: 'var(--text-3)' }}>{d.types[debt.type]}</span>
                    </div>
                    <div className="text-[11px] mt-0.5 ml-[15px]" style={{ color: 'var(--text-3)' }}>
                      {debt.revolving ? (
                        d.revolvingBadge
                      ) : deferred ? (
                        d.interestFreeTag.replace('{date}', debt.interestFreeUntil ?? '')
                      ) : !a ? (
                        d.revolvingBadge
                      ) : (
                        <>
                          {debt.rate.toFixed(1)}% · {formatCurrency(debt.minPayment)}/{t.common.moAbbr}
                          {' · '}
                          {a.feasible
                            ? `${d.payoffIn} ${formatMonths(a.months, lang)} · ${formatCurrency(Math.round(a.totalInterest))} ${d.interestLabel}`
                            : d.never}
                        </>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" aria-label={`${t.edit} — ${debt.name}`} className="text-[13px] font-mono font-medium text-[var(--text-1)] cursor-pointer" onClick={() => openEdit(debt)}>
                      {formatCurrency(debt.balance)}
                    </button>
                    <button onClick={() => setPendingDelete(debt)} className="text-[var(--text-2)] hover:text-[var(--negative)] sm:opacity-0 sm:group-hover:opacity-100 transition-all" aria-label={`${t.delete} — ${debt.name}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="pt-4 flex justify-between items-baseline">
              <span className={sectionLabel}>{d.sum}</span>
              <span className="text-xl font-bold font-mono" style={{ color: 'var(--negative)' }}>−{formatCurrency(totalDebt)}</span>
            </div>
          </div>

          {/* Payoff planner */}
          <div className="pt-5 border-t border-[var(--border)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className={sectionLabel}>{d.planner}</h3>
              <div className="inline-flex p-1 rounded-[8px] border" style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)' }}>
                {(['avalanche', 'snowball'] as PayoffStrategy[]).map(s => (
                  <button key={s} onClick={() => setStrategy(s)}
                    className="px-3 h-7 rounded-[6px] text-[12px] font-medium transition-colors"
                    style={{ background: strategy === s ? 'var(--bg-3)' : 'transparent', color: strategy === s ? 'var(--brass)' : 'var(--text-2)' }}>
                    {s === 'avalanche' ? d.avalanche : d.snowball}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{d.extra}</span>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} step={500} value={extra || ''} onChange={e => setExtra(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 h-9 px-3 rounded-[6px] text-[14px] font-mono outline-none border bg-[var(--bg-raised)] border-[var(--border)] text-[var(--text-1)]" placeholder="0" />
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>kr/{t.common.moAbbr}</span>
                </div>
              </label>
              <Stat label={d.debtFree} value={formatMonths(plan.months, lang)} accent={plan.feasible ? 'var(--forest-light)' : 'var(--negative)'} />
              <Stat label={d.totalInterest} value={plan.feasible ? formatCurrency(Math.round(plan.totalInterest)) : '—'} accent="var(--text-1)" />
              {extra > 0 && interestSaved > 0 && (
                <Stat label={d.interestSaved} value={formatCurrency(Math.round(interestSaved))} sub={d.vsMinimum} accent="var(--forest-light)" />
              )}
            </div>

            {plan.feasible && plan.balanceSeries.length > 2 && (
              <div className="h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={plan.balanceSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.rust} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={CHART.rust} stopOpacity={0.18} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="month" tickFormatter={(m: number) => `${Math.round(m / 12)}${t.common.yrAbbr}`} {...AXIS_PROPS} />
                    <YAxis tickFormatter={fmtAxis} {...AXIS_PROPS_Y} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area isAnimationActive={!reduced} type="monotone" dataKey="total" name={d.sum} stroke={CHART.rust} fill="url(#debtGrad)" strokeWidth={1.8} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Plan-vs-actual against recorded snapshots (renders only when ≥2 months) */}
            <DebtPaydownVsPlanChart />
          </div>
        </>
      )}

      {modal && <EditModal {...modal} onCancel={() => setModal(null)} />}
      {pendingDelete && (
        <ConfirmModal
          title={t.confirmDelete}
          message={`${t.delete}: ${pendingDelete.name}?`}
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          danger
          onConfirm={() => { setDebts(debts.filter(x => x.id !== pendingDelete.id)); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-[18px] font-semibold font-mono tabular-nums leading-tight mt-0.5" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}
