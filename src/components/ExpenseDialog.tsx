import { useMemo, useState } from 'react';
import { ChevronDown, Minus, PiggyBank, ArrowLeft, Info } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { SavingsModeToggle, type SavingsMode } from './SavingsModeToggle';
import { useFinance, type FixedExpense, type ExpenseType, type ExpenseDestinationKind } from '../context/FinanceContext';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber, isNonEmpty } from '../lib/validators';
import { CATEGORIES, isCategoryKey } from '../lib/categories';
import { CHART } from '../lib/chartColors';
import { resolveSavingsAmounts, savingsBase, percentOfSavingsBase } from '../lib/savingsRate';

// The add/edit dialog for a fixed expense. Replaces the flat EditModal form with
// a grouped layout: essentials up front, the automation destination reframed as
// the plain question "what happens to the money?", and the technical
// tracking/matching options tucked under a collapsed "Advanced" section.

type Flow = 'none' | 'save' | 'debt';
const TYPE_ORDER: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance', 'saving'];
const TYPE_COLOR: Record<ExpenseType, string> = {
  fixed: CHART.teal, variable: CHART.forest, subscription: CHART.slate, insurance: CHART.rust,
  saving: CHART.brass,
};

interface Props {
  expense?: FixedExpense;
  onSave: (payload: Omit<FixedExpense, 'id'>) => void;
  onClose: () => void;
}

const lblBare = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)]';
const lbl = `${lblBare} mb-2`;
const input = 'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[10px] px-3.5 py-3 text-[15px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--forest)_30%,transparent)] placeholder:text-[var(--text-3)] transition-colors';

// Stands in for a real id while adding, so the draft can be resolved alongside
// the live rows without being mistaken for one of them.
const DRAFT_ID = '__draft__';

export default function ExpenseDialog({ expense, onSave, onClose }: Props) {
  const {
    t, assets, debts, housingMode, formatCurrency,
    fixedExpenses, effectiveIncome, savingsTargetPercent,
  } = useFinance();
  const savings = assets.savingsAccounts ?? [];
  // Save targets: the single-scalar balances (emergency buffer, investment
  // portfolio, BSU) plus every named savings account. The `__…__` ids are
  // sentinels — real savings ids never collide with them.
  const BUFFER_ID = '__buffer__';
  const PORTFOLIO_ID = '__portfolio__';
  const BSU_ID = '__bsu__';
  const SCALAR_SAVE_IDS: Record<string, ExpenseDestinationKind> = {
    [BUFFER_ID]: 'bufferAccount', [PORTFOLIO_ID]: 'portfolio', [BSU_ID]: 'bsu',
  };
  const saveOptions = [
    { v: BUFFER_ID, l: t.expenseDestination.buffer },
    { v: PORTFOLIO_ID, l: t.expenseDestination.portfolio },
    { v: BSU_ID, l: t.expenseDestination.bsu },
    ...savings.map(s => ({ v: s.id, l: `${t.expenseDestination.savings}: ${s.name}` })),
  ];
  // The sentinel matching this expense's stored scalar destination, if any.
  const storedScalarId = Object.keys(SCALAR_SAVE_IDS)
    .find(id => SCALAR_SAVE_IDS[id] === expense?.destinationKind);

  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  // How a saving is sized. 'percent' and 'rest' are derived every month, so the
  // kroner box is replaced by the share (or by nothing at all) and the amount is
  // computed below rather than typed.
  const [mode, setMode] = useState<SavingsMode>(
    expense?.amountRest ? 'rest' : expense?.amountPercent ? 'percent' : 'amount',
  );
  const [percent, setPercent] = useState(expense?.amountPercent ? String(expense.amountPercent) : '');
  const [type, setType] = useState<ExpenseType>(expense?.type ?? 'fixed');
  const [flow, setFlow] = useState<Flow>(
    expense?.destinationKind === 'savingsAccount' || storedScalarId ? 'save'
      : expense?.destinationKind === 'mortgage' || expense?.destinationKind === 'debt' ? 'debt'
        : 'none',
  );
  const [savingsId, setSavingsId] = useState(
    storedScalarId ?? expense?.savingsAccountId ?? saveOptions[0].v,
  );
  const [paused, setPaused] = useState(!!expense?.automationPaused);

  // Type and destination are two views of one decision: "Sparing" means the money
  // is retained, which only means something if it has somewhere to go, and a
  // savings destination makes the row a saving. Keep them in step so the two
  // controls can never contradict each other.
  const chooseType = (next: ExpenseType) => {
    setType(next);
    if (next === 'saving' && flow !== 'save') setFlow('save');
    if (next !== 'saving' && flow === 'save') setFlow('none');
  };
  const chooseFlow = (next: Flow) => {
    setFlow(next);
    if (next === 'save') setType('saving');
    else if (type === 'saving') setType('fixed');
  };
  const debtOptions = [
    ...(housingMode !== 'first_buyer' ? [{ v: 'mortgage', l: t.expenseDestination.mortgage }] : []),
    ...debts.map(d => ({ v: `debt:${d.id}`, l: `${t.expenseDestination.debt}: ${d.name}` })),
  ];
  const [debtTarget, setDebtTarget] = useState(
    expense?.destinationKind === 'mortgage' ? 'mortgage'
      : expense?.destinationKind === 'debt' && expense.debtId ? `debt:${expense.debtId}`
        : debtOptions[0]?.v ?? '',
  );
  const [category, setCategory] = useState<string>(expense?.category ?? '');
  const [match, setMatch] = useState(expense?.match ?? '');
  const [advOpen, setAdvOpen] = useState(!!(expense?.category || expense?.match));
  const [error, setError] = useState('');

  const catOptions = [
    { value: '', label: t.trackCategoryNone },
    ...CATEGORIES.filter(c => c.key !== 'income').map(c => ({ value: c.key, label: t.categoryLabels[c.key] })),
  ];

  // The dialog names itself after what it is currently building, so switching the
  // type chip to Sparing rewords the whole form rather than leaving "utgift" on a
  // saving. Editing keeps the row's own name as the title.
  const isSaving = type === 'saving';
  // Only a saving can be derived — a bill does not get cheaper because a month
  // was lean. Deriving the mode rather than resetting it on every type change
  // keeps the two controls from drifting apart.
  const effMode: SavingsMode = isSaving ? mode : 'amount';
  const typedAmount = parseLocaleNumber(amount);
  const typedPercent = parseLocaleNumber(percent);

  // The live rows with this dialog's draft standing in for the row being edited
  // (or appended, when adding). Both the amount below and the kr → % conversion
  // are derived from THIS list rather than the stored one: a row on its way to
  // becoming a saving leaves consumption, which moves the savings base it is
  // about to be a share of. Reading the two off different lists made switching
  // unit change the amount — the one thing it must never do.
  const draftId = expense?.id ?? DRAFT_ID;
  const draftRows = useMemo(() => {
    const draft: FixedExpense = {
      ...(expense ?? { name, destinationKind: 'portfolio' }),
      id: draftId,
      amount: typedAmount || 0,
      type: 'saving',
      amountPercent: effMode === 'percent' && typedPercent > 0 ? typedPercent : undefined,
      amountRest: effMode === 'rest' ? true : undefined,
    };
    return expense
      ? fixedExpenses.map(e => (e.id === draftId ? draft : e))
      : [...fixedExpenses, draft];
  }, [expense, draftId, name, typedAmount, typedPercent, effMode, fixedExpenses]);

  // What this row actually moves this month. For a derived saving that is not
  // the typed number, so it is resolved by the same function the budget uses.
  // A 'rest' row in particular can only be sized against its siblings.
  const resolvedAmount = useMemo(() => {
    if (effMode === 'amount') return typedAmount || 0;
    // A blank or garbage share moves nothing — say 0 rather than falling back on
    // the kroner stored underneath, which is only what the row last resolved to.
    if (effMode === 'percent' && !(typedPercent > 0)) return 0;
    return resolveSavingsAmounts(draftRows, effectiveIncome, savingsTargetPercent)
      .find(e => e.id === draftId)?.amount ?? 0;
  }, [effMode, typedAmount, typedPercent, draftRows, draftId, effectiveIncome, savingsTargetPercent]);

  // Carry the current figure across when the unit changes: leaving kr for % takes
  // the share that keeps the same kroner moving, and coming back pins whatever
  // the derived row resolves to now. Switching a unit must never change what is
  // saved. Only fills a blank share, so a typed one is never rounded on a
  // re-click of the mode already selected.
  const chooseMode = (m: SavingsMode) => {
    if (m === 'percent' && !(typedPercent > 0)) {
      const share = percentOfSavingsBase(resolvedAmount, savingsBase(effectiveIncome, draftRows));
      if (share !== undefined) setPercent(String(share));
    }
    if (m === 'amount') setAmount(String(resolvedAmount));
    setMode(m);
  };

  const targetName =
    flow === 'save'
      ? (savingsId in SCALAR_SAVE_IDS
        ? saveOptions.find(o => o.v === savingsId)!.l
        : savings.find(s => s.id === savingsId)?.name ?? '')
      : debtTarget === 'mortgage' ? t.expenseDestination.mortgage
        : debts.find(d => `debt:${d.id}` === debtTarget)?.name ?? '';

  const submit = () => {
    if (!isNonEmpty(name)) { setError(t.newExpenseName + t.validation.requiredSuffix); return; }
    if (effMode === 'amount' && !(typedAmount > 0)) { setError(t.newAmount + t.validation.positiveAmountSuffix); return; }
    if (effMode === 'percent' && !(typedPercent > 0)) { setError(t.savingsAllocation.percentLabel + t.validation.positiveAmountSuffix); return; }
    // A derived row stores this month's kroner too: every reader that hasn't
    // been through the resolver (an export, a snapshot) still sees a real
    // figure. It is recomputed from the share on the next render. A 'rest' row
    // legitimately resolves to 0 when the target is already spoken for, so it
    // is not held to the positive-amount rule.
    const amt = effMode === 'amount' ? typedAmount : resolvedAmount;

    let destinationKind: ExpenseDestinationKind | undefined;
    let savingsAccountId: string | undefined;
    let debtId: string | undefined;
    if (flow === 'save' && savingsId in SCALAR_SAVE_IDS) destinationKind = SCALAR_SAVE_IDS[savingsId];
    else if (flow === 'save' && savingsId) { destinationKind = 'savingsAccount'; savingsAccountId = savingsId; }
    else if (flow === 'debt' && debtTarget === 'mortgage') destinationKind = 'mortgage';
    else if (flow === 'debt' && debtTarget.startsWith('debt:')) { destinationKind = 'debt'; debtId = debtTarget.slice(5); }

    // Stamp lastPostedMonth to now when a destination is newly assigned (so the
    // first move happens next month); keep it when the destination is unchanged.
    // Resuming from a pause restamps too, so the paused months are never
    // back-posted — the money genuinely didn't move while it was paused.
    const sameDest = expense?.destinationKind === destinationKind
      && expense?.savingsAccountId === savingsAccountId && expense?.debtId === debtId;
    const resumed = !!expense?.automationPaused && !paused;
    const lastPostedMonth = !destinationKind ? undefined
      : sameDest && !resumed ? expense?.lastPostedMonth : currentMonthKey();

    onSave({
      name: name.trim(),
      amount: amt,
      amountPercent: effMode === 'percent' ? typedPercent : undefined,
      amountRest: effMode === 'rest' ? true : undefined,
      type,
      category: isCategoryKey(category) ? category : undefined,
      match: match.trim() || undefined,
      destinationKind,
      savingsAccountId,
      debtId,
      automationPaused: destinationKind && paused ? true : undefined,
      lastPostedMonth,
    });
  };

  const flowCard = (key: Flow, Icon: typeof Minus, title: string, desc: string) => {
    const on = flow === key;
    return (
      <button
        type="button"
        onClick={() => chooseFlow(key)}
        className={`text-left p-3 rounded-[11px] border transition-colors ${on
          ? 'border-[var(--forest)] bg-[var(--positive-bg)]'
          : 'border-[var(--border)] bg-[var(--bg-raised)] hover:border-[var(--border-strong)]'}`}
      >
        <span className={`w-[30px] h-[30px] rounded-[8px] grid place-items-center mb-2 ${on ? 'text-[var(--forest)]' : 'text-[var(--text-2)]'}`}
          style={{ background: on ? 'color-mix(in srgb, var(--forest) 22%, transparent)' : 'rgba(255,255,255,.05)' }}>
          <Icon size={16} />
        </span>
        <span className="block text-[12.5px] font-semibold text-[var(--text-1)]">{title}</span>
        <span className={`block text-[10.5px] mt-0.5 leading-snug ${on ? 'text-[color-mix(in_srgb,var(--forest)_70%,white)]' : 'text-[var(--text-3)]'}`}>{desc}</span>
      </button>
    );
  };

  const selectCls = `${input} appearance-none cursor-pointer pr-9`;
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
      title={expense ? expense.name : t.expenseDialog.addTitle}
      onClose={onClose}
      closeLabel={t.cancel}
      preventBackdropClose
      panelClassName="sm:min-w-[420px] sm:max-w-[460px] w-full"
      footer={
        <div className="flex gap-2.5 pt-4 mt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-[10px] text-[14px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors">{t.cancel}</button>
          <button onClick={submit} className="flex-1 py-3 rounded-[10px] text-[14px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors">{isSaving ? t.expenseDialog.saveSaving : t.expenseDialog.save}</button>
        </div>
      }
    >
      <p className="text-[12px] text-[var(--text-3)] mt-1 mb-1">{isSaving ? t.expenseDialog.savingSubtitle : t.expenseDialog.subtitle}</p>
      <div className="space-y-4 max-h-[64vh] overflow-y-auto -mx-1 px-1 pt-3">
        {/* essentials */}
        <div>
          <label className={lbl}>{isSaving ? t.expenseDialog.savingNameLabel : t.newExpenseName.replace(':', '')}</label>
          <input className={input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={t.budgetPage.expenseNamePlaceholder} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className={lblBare}>{t.expenseDialog.amountLabel}</label>
            {/* Fixed kroner, a share of the savings base, or the rest of the
                target. Only a saving can be derived, so the switch appears with
                the type rather than sitting inert on a bill. */}
            {isSaving && (
              <SavingsModeToggle
                mode={effMode}
                modes={['amount', 'percent', 'rest']}
                labels={modeLabels}
                size="md"
                onChange={chooseMode}
              />
            )}
          </div>
          {effMode === 'rest' ? (
            <div className={`${input} font-mono tabular-nums text-[17px] font-semibold flex items-baseline justify-between`}>
              <span>{formatCurrency(resolvedAmount)}</span>
              <span className="text-[13px] font-sans text-[var(--text-3)]">{t.expenseDialog.perMonth}</span>
            </div>
          ) : (
            <div className="relative">
              <input
                className={`${input} font-mono tabular-nums text-[17px] font-semibold pr-[72px]`}
                inputMode="decimal"
                value={effMode === 'percent' ? percent : amount}
                aria-label={effMode === 'percent' ? sa.percentLabel : t.expenseDialog.amountLabel}
                onChange={e => (effMode === 'percent' ? setPercent : setAmount)(e.target.value)}
                placeholder="0"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-3)] pointer-events-none">
                {effMode === 'percent' ? '%' : t.expenseDialog.perMonth}
              </span>
            </div>
          )}
          {/* A derived amount changes on its own every month, so show what it
              comes to now — otherwise next month's different figure looks like
              the app moved the money on its own. */}
          {effMode !== 'amount' && (
            <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--brass)' }}>
              {(effMode === 'percent' ? t.expenseDialog.percentModeHint : t.expenseDialog.restModeHint)
                .replace('{amount}', formatCurrency(resolvedAmount))}
            </p>
          )}
        </div>
        <div>
          <label className={lbl}>{t.expenseTypeLabel.replace(':', '')}</label>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_ORDER.map(ty => (
              <button
                key={ty}
                type="button"
                onClick={() => chooseType(ty)}
                className={`flex items-center gap-1.5 py-2.5 px-3 rounded-[9px] border text-[12px] font-medium transition-colors ${type === ty
                  ? 'border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text-1)_8%,transparent)] text-[var(--text-1)]'
                  : 'border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
              >
                <i className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: TYPE_COLOR[ty] }} />
                {t.expenseType[ty]}
              </button>
            ))}
          </div>
        </div>

        {/* money flow */}
        <div>
          <label className={lbl}>{t.expenseDialog.moneyFlow}</label>
          <div className="grid grid-cols-3 gap-2">
            {flowCard('none', Minus, t.expenseDialog.flowNone, t.expenseDialog.flowNoneDesc)}
            {flowCard('save', PiggyBank, t.expenseDialog.flowSave, t.expenseDialog.flowSaveDesc)}
            {flowCard('debt', ArrowLeft, t.expenseDialog.flowDebt, t.expenseDialog.flowDebtDesc)}
          </div>

          {flow === 'save' && (
            <div className="mt-3">
              <div className="relative">
                <select className={selectCls} value={savingsId} onChange={e => setSavingsId(e.target.value)}>
                  {saveOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
              </div>
              <Explainer text={t.expenseDialog.explainSave
                .replace('{amount}', formatCurrency(resolvedAmount))
                .replace('{target}', targetName)} />
            </div>
          )}

          {flow === 'debt' && (
            <div className="mt-3">
              {debtOptions.length === 0 ? (
                <p className="text-[12px] text-[var(--warning)]">{t.expenseDialog.noDebt}</p>
              ) : (
                <>
                  <div className="relative">
                    <select className={selectCls} value={debtTarget} onChange={e => setDebtTarget(e.target.value)}>
                      {debtOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                    <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
                  </div>
                  <Explainer text={t.expenseDialog.explainDebt} />
                </>
              )}
            </div>
          )}

          {flow !== 'none' && (
            <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={paused}
                onChange={e => setPaused(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--forest)] cursor-pointer"
              />
              <span>
                <span className="block text-[12.5px] font-medium text-[var(--text-1)]">{t.expenseDestination.pauseLabel}</span>
                <span className="block text-[11px] text-[var(--text-3)] mt-0.5 leading-snug">{t.expenseDestination.pauseHint}</span>
              </span>
            </label>
          )}
        </div>

        {/* advanced */}
        <div className="border-t border-[var(--border)] pt-1">
          <button
            type="button"
            onClick={() => setAdvOpen(o => !o)}
            className="w-full flex items-center justify-between py-3 text-[12.5px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
          >
            {t.expenseDialog.advanced}
            <ChevronDown size={16} className={`transition-transform ${advOpen ? 'rotate-180' : ''}`} />
          </button>
          {advOpen && (
            <div className="space-y-4 pb-1">
              <div>
                <label className={lbl}>{t.trackCategoryLabel.replace(':', '')}</label>
                <div className="relative">
                  <select className={selectCls} value={category} onChange={e => setCategory(e.target.value)}>
                    {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
                </div>
                <p className="text-[11px] text-[var(--text-3)] mt-1.5 leading-snug">{t.trackCategoryHint}</p>
              </div>
              <div>
                <label className={lbl}>{t.budgetPage.matchPatternLabel}</label>
                <input className={input} value={match} onChange={e => setMatch(e.target.value)} placeholder={t.budgetPage.matchPatternPlaceholder} />
                <p className="text-[11px] text-[var(--text-3)] mt-1.5 leading-snug">{t.budgetPage.matchPatternHint}</p>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>}
      </div>
    </ModalShell>
  );
}

function Explainer({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 mt-2.5 px-3 py-2.5 rounded-[10px] text-[12px] leading-relaxed"
      style={{ background: 'color-mix(in srgb, var(--forest) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--forest) 22%, transparent)', color: 'color-mix(in srgb, var(--forest) 60%, white)' }}>
      <Info size={15} className="shrink-0 mt-0.5 text-[var(--forest)]" />
      <span>{text}</span>
    </div>
  );
}
