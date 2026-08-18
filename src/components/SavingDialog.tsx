import { useMemo, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { SavingsModeToggle, type SavingsMode } from './SavingsModeToggle';
import { useFinance, type Saving, type SavingDestinationKind } from '../context/FinanceContext';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber, isNonEmpty } from '../lib/validators';
import { resolveSavingsAmounts, savingsBase, percentOfSavingsBase } from '../lib/savingsRate';

// The add/edit dialog for a saving. Deliberately NOT the fixed-expense dialog:
// a saving has no expense type to pick, no "what happens to the money?" (the
// answer is the reason this dialog exists), and no envelope tracking — matching
// a transfer to your own account against "spending" was never meaningful. What
// is left is the four things a saving actually is: a name, how much, where to,
// and whether it is running.

interface Props {
  saving?: Saving;
  onSave: (payload: Omit<Saving, 'id'>) => void;
  onClose: () => void;
}

const lblBare = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)]';
const lbl = `${lblBare} mb-2`;
const input = 'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[10px] px-3.5 py-3 text-[15px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--forest)_30%,transparent)] placeholder:text-[var(--text-3)] transition-colors';

// Stands in for a real id while adding, so the draft can be resolved alongside
// the live savings without being mistaken for one of them.
const DRAFT_ID = '__draft__';

// The destination select's value encodes both kind and target id, matching the
// `savingsAccount:<id>` convention in `destinationKey`.
const parseTarget = (v: string): Pick<Saving, 'destinationKind' | 'savingsAccountId'> =>
  v.startsWith('savingsAccount:')
    ? { destinationKind: 'savingsAccount', savingsAccountId: v.slice(15) }
    : { destinationKind: v as SavingDestinationKind };

export default function SavingDialog({ saving, onSave, onClose }: Props) {
  const {
    t, assets, formatCurrency, savings, viewFixedExpenses, effectiveIncome, savingsTargetPercent,
  } = useFinance();
  const accounts = assets.savingsAccounts ?? [];
  const targetOptions = [
    { v: 'bufferAccount', l: t.expenseDestination.buffer },
    { v: 'portfolio', l: t.expenseDestination.portfolio },
    { v: 'bsu', l: t.expenseDestination.bsu },
    ...accounts.map(a => ({ v: `savingsAccount:${a.id}`, l: `${t.expenseDestination.savings}: ${a.name}` })),
  ];

  const [name, setName] = useState(saving?.name ?? '');
  const [amount, setAmount] = useState(saving ? String(saving.amount) : '');
  // 'percent' and 'rest' are derived every month, so the kroner box is replaced
  // by the share (or by nothing at all) and the amount is computed below rather
  // than typed.
  const [mode, setMode] = useState<SavingsMode>(saving?.mode ?? 'amount');
  const [percent, setPercent] = useState(saving?.percent ? String(saving.percent) : '');
  const [target, setTarget] = useState(
    saving
      ? (saving.destinationKind === 'savingsAccount'
        ? `savingsAccount:${saving.savingsAccountId ?? ''}`
        : saving.destinationKind)
      : targetOptions[0].v,
  );
  const [paused, setPaused] = useState(!!saving?.paused);
  const [error, setError] = useState('');

  const typedAmount = parseLocaleNumber(amount);
  const typedPercent = parseLocaleNumber(percent);

  // The pool a percentage is a share of, and the pool the target is measured
  // against. Income minus the fixed expenses — savings are not in that list, so
  // unlike before the split this does not shift as the draft is edited.
  const base = savingsBase(effectiveIncome, viewFixedExpenses);

  // The live savings with this dialog's draft standing in for the one being
  // edited (or appended, when adding). A 'rest' row can only be sized against
  // its siblings, so the resolver needs the whole list, not just the draft.
  const draftId = saving?.id ?? DRAFT_ID;
  const draftRows = useMemo(() => {
    const draft: Saving = {
      ...(saving ?? { name, destinationKind: 'portfolio' as const }),
      id: draftId,
      amount: typedAmount || 0,
      mode,
      percent: mode === 'percent' && typedPercent > 0 ? typedPercent : undefined,
    };
    return saving
      ? savings.map(s => (s.id === draftId ? draft : s))
      : [...savings, draft];
  }, [saving, savings, draftId, name, typedAmount, typedPercent, mode]);

  // What this saving actually moves this month. For a derived one that is not
  // the typed number, so it is resolved by the same function the budget uses.
  const resolvedAmount = useMemo(() => {
    if (mode === 'amount') return typedAmount || 0;
    // A blank or garbage share moves nothing — say 0 rather than falling back on
    // the kroner stored underneath, which is only what it last resolved to.
    if (mode === 'percent' && !(typedPercent > 0)) return 0;
    return resolveSavingsAmounts(draftRows, base, savingsTargetPercent)
      .find(s => s.id === draftId)?.amount ?? 0;
  }, [mode, typedAmount, typedPercent, draftRows, draftId, base, savingsTargetPercent]);

  // Carry the current figure across when the unit changes: leaving kr for % takes
  // the share that keeps the same kroner moving, and coming back pins whatever
  // the derived row resolves to now. Switching a unit must never change what is
  // saved. Only fills a blank share, so a typed one is never rounded on a
  // re-click of the mode already selected.
  const chooseMode = (m: SavingsMode) => {
    if (m === 'percent' && !(typedPercent > 0)) {
      const share = percentOfSavingsBase(resolvedAmount, base);
      if (share !== undefined) setPercent(String(share));
    }
    if (m === 'amount') setAmount(String(resolvedAmount));
    setMode(m);
  };

  const targetName = targetOptions.find(o => o.v === target)?.l ?? '';

  const submit = () => {
    if (!isNonEmpty(name)) { setError(t.savingDialog.nameLabel + t.validation.requiredSuffix); return; }
    if (mode === 'amount' && !(typedAmount > 0)) { setError(t.expenseDialog.amountLabel + t.validation.positiveAmountSuffix); return; }
    if (mode === 'percent' && !(typedPercent > 0)) { setError(t.savingsAllocation.percentLabel + t.validation.positiveAmountSuffix); return; }
    // A derived saving stores this month's kroner too: every reader that hasn't
    // been through the resolver (an export, a snapshot) still sees a real
    // figure. It is recomputed from the share on the next render. A 'rest' row
    // legitimately resolves to 0 when the target is already spoken for, so it is
    // not held to the positive-amount rule.
    const dest = parseTarget(target);

    // Stamp lastPostedMonth to now when the destination changes (so the first
    // move happens next month); keep it when unchanged. Resuming from a pause
    // restamps too, so the paused months are never back-posted — the money
    // genuinely didn't move while it was paused.
    const sameDest = saving?.destinationKind === dest.destinationKind
      && saving?.savingsAccountId === dest.savingsAccountId;
    const resumed = !!saving?.paused && !paused;

    onSave({
      name: name.trim(),
      amount: mode === 'amount' ? typedAmount : resolvedAmount,
      mode,
      percent: mode === 'percent' ? typedPercent : undefined,
      ...dest,
      paused: paused || undefined,
      lastPostedMonth: sameDest && !resumed ? saving?.lastPostedMonth : currentMonthKey(),
      bufferTargetAmount: saving?.bufferTargetAmount,
    });
  };

  const sa = t.savingsAllocation;
  const modeLabels = {
    group: sa.toggleMode,
    percent: '%',
    amount: 'kr',
    rest: sa.modeRestShort,
    percentHint: sa.modePercentHint,
    amountHint: sa.modeAmountHint,
    restHint: sa.modeRestHint,
  };

  return (
    <ModalShell
      title={saving ? saving.name : t.savingDialog.addTitle}
      onClose={onClose}
      closeLabel={t.cancel}
      preventBackdropClose
      panelClassName="sm:min-w-[420px] sm:max-w-[460px] w-full"
      footer={
        <div className="flex gap-2.5 pt-4 mt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-[10px] text-[14px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors">{t.cancel}</button>
          <button onClick={submit} className="flex-1 py-3 rounded-[10px] text-[14px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors">{t.savingDialog.save}</button>
        </div>
      }
    >
      <p className="text-[12px] text-[var(--text-3)] mt-1 mb-1">{t.savingDialog.subtitle}</p>
      <div className="space-y-4 max-h-[64vh] overflow-y-auto -mx-1 px-1 pt-3">
        <div>
          <label className={lbl}>{t.savingDialog.nameLabel}</label>
          <input className={input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={t.savingDialog.namePlaceholder} />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className={lblBare}>{t.expenseDialog.amountLabel}</label>
            {/* Fixed kroner, a share of the savings base, or the rest of the
                target. The choice that makes a transfer follow income, so it
                sits right on the amount it governs. */}
            <SavingsModeToggle
              mode={mode}
              modes={['amount', 'percent', 'rest']}
              labels={modeLabels}
              size="md"
              onChange={chooseMode}
            />
          </div>
          {mode === 'rest' ? (
            <div className={`${input} font-mono tabular-nums text-[17px] font-semibold flex items-baseline justify-between`}>
              <span>{formatCurrency(resolvedAmount)}</span>
              <span className="text-[13px] font-sans text-[var(--text-3)]">{t.expenseDialog.perMonth}</span>
            </div>
          ) : (
            <div className="relative">
              <input
                className={`${input} font-mono tabular-nums text-[17px] font-semibold pr-[72px]`}
                inputMode="decimal"
                value={mode === 'percent' ? percent : amount}
                aria-label={mode === 'percent' ? sa.percentLabel : t.expenseDialog.amountLabel}
                onChange={e => (mode === 'percent' ? setPercent : setAmount)(e.target.value)}
                placeholder="0"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-3)] pointer-events-none">
                {mode === 'percent' ? '%' : t.expenseDialog.perMonth}
              </span>
            </div>
          )}
          {/* A derived amount changes on its own every month, so show what it
              comes to now — otherwise next month's different figure looks like
              the app moved the money on its own. */}
          {mode !== 'amount' && (
            <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--brass)' }}>
              {(mode === 'percent' ? t.savingDialog.percentModeHint : t.savingDialog.restModeHint)
                .replace('{amount}', formatCurrency(resolvedAmount))}
            </p>
          )}
        </div>

        <div>
          <label className={lbl}>{t.savingDialog.destinationLabel}</label>
          <div className="relative">
            <select
              className={`${input} appearance-none cursor-pointer pr-9`}
              value={target}
              onChange={e => setTarget(e.target.value)}
            >
              {targetOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
          </div>
          <div className="flex gap-2.5 mt-2.5 px-3 py-2.5 rounded-[10px] text-[12px] leading-relaxed"
            style={{ background: 'color-mix(in srgb, var(--forest) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--forest) 22%, transparent)', color: 'color-mix(in srgb, var(--forest) 60%, white)' }}>
            <Info size={15} className="shrink-0 mt-0.5 text-[var(--forest)]" />
            <span>{t.savingDialog.explain
              .replace('{amount}', formatCurrency(resolvedAmount))
              .replace('{target}', targetName)}</span>
          </div>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={paused}
            onChange={e => setPaused(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--forest)] cursor-pointer"
          />
          <span>
            <span className="block text-[12.5px] font-medium text-[var(--text-1)]">{t.expenseDestination.pauseLabel}</span>
            <span className="block text-[11px] text-[var(--text-3)] mt-0.5 leading-snug">{t.savingDialog.pauseHint}</span>
          </span>
        </label>

        {error && <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>}
      </div>
    </ModalShell>
  );
}
