import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { useFinance, type AllocationDestinationKind, type Saving } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';
import { SavingsModeToggle } from './SavingsModeToggle';
import ConfirmModal from './ConfirmModal';
import { isCreatableRow, destinationKey, type AllocationRow } from '../lib/savingsAllocation';
import { savingsBase, isPercentSavings, isRestSavings, percentOfSavingsBase } from '../lib/savingsRate';
import { currentMonthKey } from '../lib/date';
import { allocationSyncPlan, buildActivation, sizeAllocation } from '../lib/allocationSync';

// Turns the savings target (residual × savingsTargetPercent) into a per-destination
// plan, and — on an explicit click — into the fixed expenses that make it real.
//
// The plan itself never moves money. Creating the expenses is what activates it,
// and from there the ordinary automation runner posts them monthly. That keeps a
// single path to any balance change, and keeps the amounts inside the budget
// where the savings-rate math can already see them.

const selectCls = 'appearance-none cursor-pointer bg-[var(--bg-raised)] border border-[var(--border)] rounded-[9px] pl-3 pr-8 py-2 text-[13px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] transition-colors';
const pctInputCls = 'w-[68px] bg-[var(--bg-raised)] border border-[var(--border)] rounded-[9px] px-2.5 py-2 text-[13px] font-mono tabular-nums text-right text-[var(--text-1)] outline-none focus:border-[var(--forest)] transition-colors';
// Stands in for the number input on a 'rest' row, which has no number to type.
// Same box so the columns still line up down the list.
const restSlotCls = 'min-w-[68px] bg-[var(--bg-raised)] border border-[var(--border)] rounded-[9px] px-2.5 py-2 text-[12px] text-center select-none';

interface PanelProps {
  /** Drop the Card chrome — set when the panel is rendered inside a modal, which
   *  brings its own panel surface and heading. */
  bare?: boolean;
}

export const SavingsAllocationPanel: React.FC<PanelProps> = ({ bare = false }) => {
  const {
    t, assets, debts, housingMode, formatCurrency, currentMonth,
    savingsAllocations, addSavingsAllocation, updateSavingsAllocation, removeSavingsAllocation,
    fixedExpenses, setFixedExpenses, savings, setSavings, viewSavings, viewFixedExpenses,
    automationEnabled, effectiveIncome, monthlyIncomes, derivedNetMonthlyFor, savingsTargetPercent,
  } = useFinance();
  const sa = t.savingsAllocation;
  const [created, setCreated] = useState(0);
  const [confirmSync, setConfirmSync] = useState(false);
  const modeLabels = {
    group: sa.toggleMode,
    percent: '%',
    amount: 'kr',
    rest: sa.modeRestShort,
    percentHint: sa.modePercentHint,
    amountHint: sa.modeAmountHint,
    restHint: sa.modeRestHint,
  };

  // Memoized because the `?? []` fallback is a fresh array each render, which
  // would otherwise invalidate the options memo below on every render.
  const savingsAccounts = useMemo(() => assets.savingsAccounts ?? [], [assets.savingsAccounts]);

  // One flat option list; the value encodes both kind and target id, matching the
  // `debt:<id>` / `savingsAccount:<id>` convention in destinationKey().
  const options = useMemo(() => [
    { v: 'bufferAccount', l: t.expenseDestination.buffer },
    { v: 'portfolio', l: t.expenseDestination.portfolio },
    { v: 'bsu', l: t.expenseDestination.bsu },
    ...savingsAccounts.map(s => ({ v: `savingsAccount:${s.id}`, l: `${t.expenseDestination.savings}: ${s.name}` })),
    ...(housingMode !== 'first_buyer' ? [{ v: 'mortgage', l: t.expenseDestination.mortgage }] : []),
    // A revolving balance is cleared every month: paying it is spending, not
    // principal, so it is no place to send savings (see planPaydownRow).
    ...debts.filter(d => !d.revolving).map(d => ({ v: `debt:${d.id}`, l: `${t.expenseDestination.debt}: ${d.name}` })),
  ], [t, savingsAccounts, debts, housingMode]);

  // The pot is the WHOLE savings target, not the slice still uncommitted.
  // `recommendedInvestment` is the target minus what is already automated, so
  // dividing that made an activated plan appear to empty itself: every row read
  // 0 kr and a valid 100 % split was flagged as over-allocated.
  //
  // One sizing for the rows shown, for activating them and for syncing them
  // (see sizeAllocation), so the three can't disagree. It is the CURRENT
  // month's, whatever month is being viewed: what it sizes is written to live
  // transfers, and a one-month adjustment must not reshape the standing plan.
  const nowKey = currentMonthKey();
  const nowIncome = monthlyIncomes[nowKey] ?? derivedNetMonthlyFor(nowKey);
  const sizing = useMemo(
    () => sizeAllocation(savingsAllocations, nowIncome, fixedExpenses, savingsTargetPercent, undefined, debts),
    [savingsAllocations, nowIncome, fixedExpenses, savingsTargetPercent, debts],
  );
  const plan = sizing.plan;

  const savingsIds = savingsAccounts.map(s => s.id);
  const debtIds = debts.filter(d => !d.revolving).map(d => d.id);
  // What each destination ALREADY moves every month, from the live expenses.
  // Two jobs: it stops a second click duplicating a transfer, and it lets each
  // row show what is actually running rather than only what is planned.
  //
  // The header's second line reports the same total, so "of the target above,
  // this much is already running" is answerable without adding the chips up.
  const committedByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const sv of viewSavings) {
      if (sv.paused) continue;
      const k = destinationKey({ destinationKind: sv.destinationKind, savingsAccountId: sv.savingsAccountId });
      m.set(k, (m.get(k) ?? 0) + sv.amount);
    }
    // A plan row may also point at the mortgage or a debt; those activate as
    // fixed expenses, so they are committed there rather than in `savings`.
    for (const e of viewFixedExpenses) {
      if (!e.destinationKind || e.automationPaused) continue;
      const k = destinationKey({ destinationKind: e.destinationKind, debtId: e.debtId });
      m.set(k, (m.get(k) ?? 0) + e.amount);
    }
    return m;
  }, [viewSavings, viewFixedExpenses]);
  const committedTotal = [...committedByKey.values()].reduce((s, n) => s + n, 0);

  const creatable = plan.rows.filter(
    r => isCreatableRow(r, savingsIds, debtIds) && !committedByKey.has(destinationKey(r)),
  );

  // Live savings rows that no plan row covers. Without these the panel is only
  // half the picture — it would show what you intend and hide what is already
  // running, which is precisely the split that made saving need two entry points.
  const plannedKeys = new Set(savingsAllocations.map(destinationKey));
  const liveOnly = viewSavings.filter(
    sv => !plannedKeys.has(destinationKey({
      destinationKind: sv.destinationKind, savingsAccountId: sv.savingsAccountId,
    })),
  );
  const isEmpty = savingsAllocations.length === 0 && liveOnly.length === 0;

  const patchSaving = (id: string, patch: Partial<Saving>) =>
    setSavings(savings.map(sv => (sv.id === id ? { ...sv, ...patch } : sv)));

  const labelFor = (row: AllocationRow) =>
    options.find(o => o.v === destinationKey(row))?.l ?? sa.targetMissing;

  /**
   * The percentage that keeps `row` at the kroner it is moving right now, for
   * the moment it switches to '%'. A fixed row's own kroner are outside
   * `shareTarget` (they were taken off the top), so they rejoin the pool it is
   * about to become a share of.
   */
  const percentFor = (row: AllocationRow): number | undefined => {
    const pool = plan.shareTarget + (row.mode === 'amount' ? row.amount : 0);
    return pool > 0 ? Math.round((row.amount / pool) * 1000) / 10 : undefined;
  };

  const setTarget = (id: string, value: string) => {
    const patch: Partial<AllocationRow> = {
      destinationKind: value.split(':')[0] as AllocationDestinationKind,
      savingsAccountId: undefined,
      debtId: undefined,
    };
    if (value.startsWith('savingsAccount:')) patch.savingsAccountId = value.slice(15);
    else if (value.startsWith('debt:')) patch.debtId = value.slice(5);
    updateSavingsAllocation(id, patch);
  };

  // A percentage row is activated as a percentage: it stores its share of the
  // savings BASE, so the transfer follows income instead of freezing at whatever
  // this month happened to be. Share of the base rather than of the target, so
  // later editing the target percent doesn't silently re-scale live transfers.
  // A zero base (income below consumption) has no share to take, so the row
  // falls back to the resolved amount.
  const base = savingsBase(effectiveIncome, viewFixedExpenses);
  const percentOfBase = (amount: number) => percentOfSavingsBase(amount, base);

  // Activating a plan writes to whichever array the destination belongs to: a
  // savings vehicle becomes a `Saving`, the mortgage or a debt becomes a
  // `FixedExpense`. This is the only place both are written, and it is why the
  // split can't be inferred from a `type` field any more — the destination
  // decides, at the one moment it is chosen.
  const createExpenses = () => {
    // A '%' saving is a share of the base left after the paydowns this same
    // click creates, the base sync reads too.
    const creating = new Set(creatable.map(r => r.id));
    const made = buildActivation(
      creatable,
      sizeAllocation(savingsAllocations, nowIncome, fixedExpenses, savingsTargetPercent, creating, debts),
      // Same convention as assigning a destination by hand: the first move
      // happens NEXT month, never retroactively.
      currentMonthKey(),
      labelFor,
      () => crypto.randomUUID(),
      fixedExpenses,
    );
    if (made.savings.length) setSavings([...savings, ...made.savings]);
    if (made.expenses.length) setFixedExpenses([...fixedExpenses, ...made.expenses]);
    setCreated(creatable.length);
  };

  // The allocation is authoritative over the transfers it created (and only
  // those: the match is on `allocationId`). Edited rows leave those transfers
  // behind until the user syncs them here.
  // Offered only while viewing the current month, since it rewrites live
  // transfers from the current month's sizing.
  const viewingNow = format(currentMonth, 'yyyy-MM') === nowKey;
  const syncChanges = viewingNow ? allocationSyncPlan(sizing, savings, fixedExpenses) : [];
  const nameOf = (id: string) =>
    savings.find(sv => sv.id === id)?.name ?? fixedExpenses.find(e => e.id === id)?.name ?? '';
  const syncPreview = syncChanges.map(c => {
    const fmt = (n: number) => (c.field === 'percent' ? `${n} %` : formatCurrency(n));
    return `${nameOf(c.id)}: ${fmt(c.from)} → ${fmt(c.to)}`;
  }).join(' · ');
  const syncAmounts = () => {
    const patch = new Map(syncChanges.map(c => [c.id, { [c.field]: c.to }]));
    if (syncChanges.some(c => c.kind === 'saving')) {
      setSavings(savings.map(sv => (patch.has(sv.id) ? { ...sv, ...patch.get(sv.id) } : sv)));
    }
    if (syncChanges.some(c => c.kind === 'expense')) {
      setFixedExpenses(fixedExpenses.map(e => (patch.has(e.id) ? { ...e, ...patch.get(e.id) } : e)));
    }
    setConfirmSync(false);
  };

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3 flex-wrap pb-4 border-b border-[var(--border)]">
        {!bare && <SectionLabel>{sa.title}</SectionLabel>}
        <span className="text-[12px] font-mono tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
          <span className="block">{formatCurrency(sizing.target)} {sa.perMonth}</span>
          {committedTotal > 0 && (
            <span className="block mt-0.5" style={{ color: 'var(--text-3)' }}>
              {sa.alreadyAutomated.replace('{amount}', formatCurrency(committedTotal))}
            </span>
          )}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{sa.intro}</p>
      {/* Says out loud what the per-row switch does. The difference between the
          two modes is the whole feature, and a two-letter toggle can't carry it. */}
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        <span className="font-semibold" style={{ color: 'var(--brass)' }}>%</span> {sa.modeExplainPercent}
        {' · '}
        <span className="font-semibold" style={{ color: 'var(--text-1)' }}>kr</span> {sa.modeExplainAmount}
        {' · '}
        <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{sa.modeRestShort}</span> {sa.modeExplainRest}
      </p>

      {isEmpty ? (
        <p className="mt-5 text-[13px]" style={{ color: 'var(--text-3)' }}>{sa.empty}</p>
      ) : (
        <div className="mt-5 space-y-2.5">
          {/* Already running. Editable in place so this view is the single place
              saving is set up; the destination is fixed because changing it would
              silently redirect a transfer that has already posted. */}
          {liveOnly.map(sv => (
            <div key={sv.id} className="flex items-center gap-2.5 flex-wrap">
              <span
                className="truncate max-w-[190px] px-3 py-2 rounded-[9px] border border-[var(--border)] text-[13px]"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-1)' }}
                title={sv.name}
              >
                {sv.name}
              </span>
              {isRestSavings(sv) ? (
                <span className={restSlotCls} style={{ color: 'var(--text-3)' }} title={sa.modeRestHint}>
                  {sa.modeRestShort}
                </span>
              ) : isPercentSavings(sv) ? (
                <input
                  className={pctInputCls}
                  inputMode="decimal"
                  value={sv.percent}
                  aria-label={sa.percentLabel}
                  onChange={ev => patchSaving(sv.id, { percent: Number(ev.target.value) || 0 })}
                />
              ) : (
                <input
                  className={pctInputCls}
                  inputMode="decimal"
                  value={sv.amount}
                  aria-label={sa.amountLabel}
                  onChange={ev => patchSaving(sv.id, { amount: Number(ev.target.value) || 0 })}
                />
              )}
              <SavingsModeToggle
                mode={sv.mode ?? 'amount'}
                modes={['percent', 'amount', 'rest']}
                labels={modeLabels}
                // `sv` is a resolved row, so `sv.amount` is this month's kroner —
                // pin those on the way to 'kr'. The stored amount underneath a
                // derived row is only the figure it was created with, and
                // falling back to it would move the money on a unit change.
                onChange={m => patchSaving(sv.id, {
                  mode: m,
                  amount: sv.amount,
                  percent: m === 'percent' ? percentOfBase(sv.amount) : undefined,
                })}
              />
              <span
                className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
                title={sa.activeHint}
              >
                {sa.activeShort}
              </span>
              <span className="ml-auto text-[13px] font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>
                {formatCurrency(sv.amount)}
              </span>
              <button
                type="button"
                onClick={() => setSavings(savings.filter(x => x.id !== sv.id))}
                aria-label={`${sa.removeRow} — ${sv.name}`}
                className="p-1.5 rounded-[7px] hover:bg-[var(--bg-raised)] transition-colors"
                style={{ color: 'var(--text-3)' }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {plan.rows.map(row => (
            <div key={row.id} className="flex items-center gap-2.5 flex-wrap">
              <div className="relative">
                <select
                  className={selectCls}
                  value={destinationKey(row)}
                  onChange={e => setTarget(row.id, e.target.value)}
                  aria-label={sa.targetLabel}
                >
                  {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
              </div>
              {row.mode === 'rest' ? (
                <span className={restSlotCls} style={{ color: 'var(--text-3)' }} title={sa.modeRestHint}>
                  {sa.modeRestShort}
                </span>
              ) : row.mode === 'amount' ? (
                <input
                  className={pctInputCls}
                  inputMode="decimal"
                  value={row.amount ?? 0}
                  aria-label={sa.amountLabel}
                  onChange={e => updateSavingsAllocation(row.id, { amount: Number(e.target.value) || 0 })}
                />
              ) : (
                <input
                  className={pctInputCls}
                  inputMode="decimal"
                  value={row.percent}
                  aria-label={sa.percentLabel}
                  onChange={e => updateSavingsAllocation(row.id, { percent: Number(e.target.value) || 0 })}
                />
              )}
              {/* Percent tracks income once activated; kr stays put; rest absorbs
                  what the others leave. The toggle is the whole "auto increase"
                  decision, so it sits on the row. */}
              <SavingsModeToggle
                mode={row.mode ?? 'percent'}
                modes={['percent', 'amount', 'rest']}
                labels={modeLabels}
                onChange={m => {
                  // Carry the current figure across in BOTH directions, so
                  // switching unit never changes what is saved. Leaving kr or
                  // rest for % used to fall back on the row's stored percent,
                  // which is 0 on a row that has never been a percentage — the
                  // amount dropped to nothing on a click that promised not to
                  // change it. Only on a real change, so re-clicking the mode
                  // you are already in cannot round the share you typed.
                  const changed = m !== (row.mode ?? 'percent');
                  const percent = changed && m === 'percent' ? percentFor(row) : undefined;
                  updateSavingsAllocation(row.id, {
                    mode: m,
                    amount: m === 'amount' ? row.amount : undefined,
                    ...(percent !== undefined ? { percent } : {}),
                  });
                }}
              />
              {committedByKey.has(destinationKey(row)) && (
                <span
                  className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
                  title={sa.activeHint}
                >
                  {sa.active.replace('{amount}', formatCurrency(committedByKey.get(destinationKey(row))!))}
                </span>
              )}
              <span className="ml-auto text-[13px] font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>
                {formatCurrency(row.amount)}
              </span>
              <button
                type="button"
                onClick={() => removeSavingsAllocation(row.id)}
                aria-label={sa.removeRow}
                className="p-1.5 rounded-[7px] hover:bg-[var(--bg-raised)] transition-colors"
                style={{ color: 'var(--text-3)' }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[var(--border)] text-[12.5px]">
            <span style={{ color: plan.overAllocated ? 'var(--negative)' : 'var(--text-2)' }}>
              {/* Only the percentage rows are summarised as a percentage. A plan
                  made of kr and rest rows has no meaningful total here, and
                  printing "0 %" over a full split read as a failure. */}
              {plan.totalPercent > 0 && `${plan.totalPercent.toFixed(plan.totalPercent % 1 === 0 ? 0 : 1)} %`}
              {plan.remainder > 0 && !plan.overAllocated && (
                <span style={{ color: 'var(--text-3)' }}>
                  {plan.totalPercent > 0 ? ' · ' : ''}
                  {sa.unallocated.replace('{amount}', formatCurrency(plan.remainder))}
                </span>
              )}
              {plan.overReason === 'percent' && <span>{` · ${sa.overPercent}`}</span>}
              {plan.overReason === 'fixed' && (
                <span>{` · ${sa.overFixed.replace('{amount}', formatCurrency(-plan.remainder))}`}</span>
              )}
            </span>
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>{formatCurrency(plan.totalAmount)}</span>
          </div>
        </div>
      )}

      <div className="mt-5 pt-1 flex items-center gap-2.5 flex-wrap">
        <Button
          variant="secondary"
          leadingIcon={<Plus size={14} />}
          onClick={() => addSavingsAllocation({ percent: 0, destinationKind: 'portfolio' })}
        >
          {sa.addRow}
        </Button>
        {creatable.length > 0 && !plan.overAllocated && (
          <Button variant="primary" leadingIcon={<Wand2 size={14} />} onClick={createExpenses}>
            {sa.create.replace('{count}', String(creatable.length))}
          </Button>
        )}
        {syncChanges.length > 0 && !plan.overAllocated && (
          <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} onClick={() => setConfirmSync(true)}>
            {sa.syncAmounts.replace('{count}', String(syncChanges.length))}
          </Button>
        )}
      </div>

      {created > 0 && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--positive)' }}>
          {sa.created.replace('{count}', String(created))}
        </p>
      )}
      {savingsAllocations.length > 0 && creatable.length === 0 && !plan.overAllocated && created === 0 && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--text-3)' }}>{sa.allCovered}</p>
      )}
      {!automationEnabled && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--warning)' }}>{t.pensionAutomation.masterOff}</p>
      )}
      {confirmSync && (
        <ConfirmModal
          title={sa.syncTitle}
          message={`${sa.syncConfirm.replace('{count}', String(syncChanges.length))} ${syncPreview}`}
          confirmLabel={sa.syncConfirmLabel}
          cancelLabel={t.cancel}
          danger={false}
          onConfirm={syncAmounts}
          onCancel={() => setConfirmSync(false)}
        />
      )}
    </>
  );

  // In a modal the surrounding ModalShell already supplies the panel and title,
  // so the Card chrome would double up.
  return bare
    ? <div className="flex flex-col">{body}</div>
    : <Card padding="none" className="p-5 md:p-7 flex flex-col">{body}</Card>;
};
