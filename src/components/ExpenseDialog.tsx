import { useState } from 'react';
import { ChevronDown, Minus, PiggyBank, ArrowLeft, Info } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { useFinance, type FixedExpense, type ExpenseType, type ExpenseDestinationKind } from '../context/FinanceContext';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber, isNonEmpty } from '../lib/validators';
import { CATEGORIES, isCategoryKey } from '../lib/categories';
import { CHART } from '../lib/chartColors';

// The add/edit dialog for a fixed expense. Replaces the flat EditModal form with
// a grouped layout: essentials up front, the automation destination reframed as
// the plain question "what happens to the money?", and the technical
// tracking/matching options tucked under a collapsed "Advanced" section.

type Flow = 'none' | 'save' | 'debt';
const TYPE_ORDER: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];
const TYPE_COLOR: Record<ExpenseType, string> = {
  fixed: CHART.teal, variable: CHART.forest, subscription: CHART.slate, insurance: CHART.rust,
};

interface Props {
  expense?: FixedExpense;
  onSave: (payload: Omit<FixedExpense, 'id'>) => void;
  onClose: () => void;
}

const lbl = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)] mb-2';
const input = 'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[10px] px-3.5 py-3 text-[15px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--forest)_30%,transparent)] placeholder:text-[var(--text-3)] transition-colors';

export default function ExpenseDialog({ expense, onSave, onClose }: Props) {
  const { t, assets, debts, housingMode, formatCurrency } = useFinance();
  const savings = assets.savingsAccounts ?? [];
  // Save targets: the emergency-fund buffer (always available, a single scalar)
  // plus every named savings account. BUFFER_ID is a sentinel — real savings ids
  // never collide with it.
  const BUFFER_ID = '__buffer__';
  const saveOptions = [
    { v: BUFFER_ID, l: t.expenseDestination.buffer },
    ...savings.map(s => ({ v: s.id, l: `${t.expenseDestination.savings}: ${s.name}` })),
  ];

  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [type, setType] = useState<ExpenseType>(expense?.type ?? 'fixed');
  const [flow, setFlow] = useState<Flow>(
    expense?.destinationKind === 'savingsAccount' || expense?.destinationKind === 'bufferAccount' ? 'save'
      : expense?.destinationKind === 'mortgage' || expense?.destinationKind === 'debt' ? 'debt'
        : 'none',
  );
  const [savingsId, setSavingsId] = useState(
    expense?.destinationKind === 'bufferAccount' ? BUFFER_ID : expense?.savingsAccountId ?? saveOptions[0].v,
  );
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

  const targetName =
    flow === 'save' ? (savingsId === BUFFER_ID ? t.expenseDestination.buffer : savings.find(s => s.id === savingsId)?.name ?? '')
      : debtTarget === 'mortgage' ? t.expenseDestination.mortgage
        : debts.find(d => `debt:${d.id}` === debtTarget)?.name ?? '';

  const submit = () => {
    if (!isNonEmpty(name)) { setError(t.newExpenseName + t.validation.requiredSuffix); return; }
    const amt = parseLocaleNumber(amount);
    if (!(amt > 0)) { setError(t.newAmount + t.validation.positiveAmountSuffix); return; }

    let destinationKind: ExpenseDestinationKind | undefined;
    let savingsAccountId: string | undefined;
    let debtId: string | undefined;
    if (flow === 'save' && savingsId === BUFFER_ID) destinationKind = 'bufferAccount';
    else if (flow === 'save' && savingsId) { destinationKind = 'savingsAccount'; savingsAccountId = savingsId; }
    else if (flow === 'debt' && debtTarget === 'mortgage') destinationKind = 'mortgage';
    else if (flow === 'debt' && debtTarget.startsWith('debt:')) { destinationKind = 'debt'; debtId = debtTarget.slice(5); }

    // Stamp lastPostedMonth to now when a destination is newly assigned (so the
    // first move happens next month); keep it when the destination is unchanged.
    const sameDest = expense?.destinationKind === destinationKind
      && expense?.savingsAccountId === savingsAccountId && expense?.debtId === debtId;
    const lastPostedMonth = !destinationKind ? undefined : sameDest ? expense?.lastPostedMonth : currentMonthKey();

    onSave({
      name: name.trim(),
      amount: amt,
      type,
      category: isCategoryKey(category) ? category : undefined,
      match: match.trim() || undefined,
      destinationKind,
      savingsAccountId,
      debtId,
      lastPostedMonth,
    });
  };

  const flowCard = (key: Flow, Icon: typeof Minus, title: string, desc: string) => {
    const on = flow === key;
    return (
      <button
        type="button"
        onClick={() => setFlow(key)}
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
          <button onClick={submit} className="flex-1 py-3 rounded-[10px] text-[14px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors">{t.expenseDialog.save}</button>
        </div>
      }
    >
      <p className="text-[12px] text-[var(--text-3)] mt-1 mb-1">{t.expenseDialog.subtitle}</p>
      <div className="space-y-4 max-h-[64vh] overflow-y-auto -mx-1 px-1 pt-3">
        {/* essentials */}
        <div>
          <label className={lbl}>{t.newExpenseName.replace(':', '')}</label>
          <input className={input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={t.budgetPage.expenseNamePlaceholder} />
        </div>
        <div>
          <label className={lbl}>{t.expenseDialog.amountLabel}</label>
          <div className="relative">
            <input className={`${input} font-mono tabular-nums text-[17px] font-semibold pr-[72px]`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-3)] pointer-events-none">{t.expenseDialog.perMonth}</span>
          </div>
        </div>
        <div>
          <label className={lbl}>{t.expenseTypeLabel.replace(':', '')}</label>
          <div className="grid grid-cols-4 gap-1.5">
            {TYPE_ORDER.map(ty => (
              <button
                key={ty}
                type="button"
                onClick={() => setType(ty)}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-1 rounded-[9px] border text-[12px] font-medium transition-colors ${type === ty
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
                .replace('{amount}', formatCurrency(parseLocaleNumber(amount) || 0))
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
