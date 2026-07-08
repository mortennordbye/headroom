import { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, ArrowRight, Check, X, Sparkles, Compass, Plus,
  Wallet, Coins, PiggyBank, Home, TrendingUp, Bitcoin, Landmark, Briefcase,
  LayoutDashboard, LineChart, Target, CreditCard, Settings as SettingsIcon, Globe,
} from 'lucide-react';
import { useFinance, type Assets, type Pension, type Language, type Region, type ExpenseType, type DebtType } from '../../context/FinanceContext';
import { DEBT_TYPES } from '../../lib/debt';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ProgressBar } from '../ui/ProgressBar';
import { parseLocaleNumber } from '../../lib/validators';
import {
  ONBOARDING_TOPICS,
  topicsInGroup,
  type OnboardingField,
  type OnboardingTopic,
} from '../../lib/onboarding';

/** Icon per topic id (kept in the shell — the catalog stays data-only). */
const TOPIC_ICON: Record<string, typeof Wallet> = {
  prefs: Globe, income: Wallet, savingsTarget: Target, fixedExpenses: Coins,
  cash: PiggyBank, home: Home, stocks: TrendingUp, crypto: Bitcoin, pension: Briefcase,
  debt: CreditCard, growth: LineChart,
  dashboard: LayoutDashboard, salary: LineChart, forecast: TrendingUp, loan: Landmark, settings: SettingsIcon,
};

type Flow = 'essentials' | 'all';

const inputCls = 'w-full rounded-[6px] px-3 py-2.5 text-[14px] border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]';
const inputStyle = { background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' } as const;
const microLabel = 'text-[11px] font-medium uppercase tracking-wide';

/**
 * Guided setup. A gentle welcome offers two paths — the essentials, or the full
 * guide — and each runs as a low-friction **linear stepper**: one topic per
 * screen with Back / Next, no list to go in and out of. Each step shows the real
 * screen with the relevant section highlighted (a viewport-wide dim drawn by the
 * section's own box-shadow — no rect math) and, for "fill" topics, optional
 * inputs that write live to state. Mounted in Layout so it has router + context
 * on every route.
 */
export default function OnboardingTour() {
  const { onboardingActive, onboardingNonce } = useFinance();
  if (!onboardingActive) return null;
  // Key by the nonce so each open/reset remounts a fresh flow at the welcome.
  return <OnboardingHub key={onboardingNonce} />;
}

function OnboardingHub() {
  const { t, demoMode, toggleDemoMode, completeOnboarding } = useFinance();
  const navigate = useNavigate();
  const location = useLocation();
  const [flow, setFlow] = useState<Flow | null>(null); // null = welcome (choose a path)
  const [index, setIndex] = useState(0);
  const highlightedEl = useRef<Element | null>(null);

  const sequence: OnboardingTopic[] = flow === 'essentials' ? topicsInGroup('essentials') : ONBOARDING_TOPICS;
  const topic = flow ? sequence[index] ?? null : null;

  const clearHighlight = useCallback(() => {
    if (highlightedEl.current) {
      highlightedEl.current.classList.remove('tour-highlight');
      highlightedEl.current = null;
    }
  }, []);

  // Navigate to + highlight the current step's section (pages are lazy, so poll).
  useEffect(() => {
    clearHighlight();
    if (!topic) return;
    if (topic.route !== location.pathname) navigate(topic.route);
    if (!topic.target) return;
    let raf = 0;
    let tries = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tryHighlight = () => {
      const el = document.querySelector(`[data-tour="${topic.target}"]`);
      if (el) {
        el.classList.add('tour-highlight');
        highlightedEl.current = el;
        el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      } else if (tries++ < 90) {
        raf = requestAnimationFrame(tryHighlight);
      }
    };
    tryHighlight();
    return () => { cancelAnimationFrame(raf); clearHighlight(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, index, location.pathname, clearHighlight]);

  const panelRef = useFocusTrap<HTMLDivElement>(completeOnboarding, undefined, true);

  const handleSample = () => { if (!demoMode) toggleDemoMode(); completeOnboarding(); };
  const start = (f: Flow) => { setFlow(f); setIndex(0); };
  const isFirst = index === 0;
  const isLast = index >= sequence.length - 1;
  const onBack = () => { if (isFirst) { setFlow(null); } else { setIndex(i => i - 1); } };
  const onNext = () => { if (isLast) { completeOnboarding(); } else { setIndex(i => i + 1); } };

  const topicCopy = t.onboarding.topics;

  const panelBase = 'fixed z-[60] left-0 right-0 bottom-0 sm:left-1/2 sm:right-auto sm:bottom-6 sm:-translate-x-1/2 sm:w-[560px] sm:max-w-[calc(100vw-2rem)] animate-sheet-rise rounded-t-[16px] sm:rounded-[12px] border max-h-[82vh] overflow-y-auto';
  const panelStyle = { background: 'var(--bg-card)', borderColor: 'var(--border)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' } as const;

  const overlay = (
    <>
      {/* Scrim: opaque dim on the welcome (nothing highlighted); transparent
          during a step (the highlighted section's box-shadow draws the dim). */}
      <div className="fixed inset-0 z-[58]" aria-hidden style={{ background: topic ? 'transparent' : 'rgba(0,0,0,0.66)' }} />

      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t.onboarding.title} className={panelBase} style={panelStyle}>
        {topic ? (
          <StepView
            topic={topic}
            copy={topicCopy[topic.id as keyof typeof topicCopy]}
            step={index + 1}
            total={sequence.length}
            isLast={isLast}
            onBack={onBack}
            onNext={onNext}
            onClose={completeOnboarding}
          />
        ) : (
          <div className="p-5 sm:p-6">
            <div className="flex justify-end mb-1">
              <button onClick={completeOnboarding} aria-label={t.onboarding.close} className="grid place-items-center w-8 h-8 rounded-[6px]" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} style={{ color: 'var(--brass)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{t.onboarding.guide}</span>
            </div>
            <h2 className="font-serif text-[28px] font-medium leading-tight mb-2" style={{ color: 'var(--text-1)' }}>{t.onboarding.welcomeTitle}</h2>
            <p className="text-[14px] leading-[1.55] mb-5" style={{ color: 'var(--text-2)' }}>{t.onboarding.welcomeBody}</p>

            {/* Two paths: quick essentials, or the full guided tour. */}
            <div className="flex flex-col gap-2.5 mb-5">
              <button
                onClick={() => start('essentials')}
                className="flex items-center gap-3 text-left px-4 py-3.5 rounded-[8px] border transition-colors"
                style={{ background: 'var(--warning-bg)', borderColor: 'var(--brass-dim)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brass)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--brass-dim)'; }}
              >
                <span className="grid place-items-center w-9 h-9 rounded-[7px] shrink-0" style={{ background: 'var(--bg-3)', color: 'var(--brass)' }}>
                  <Sparkles size={17} strokeWidth={1.9} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{t.onboarding.essentialsChoice}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--text-3)' }}>{t.onboarding.essentialsChoiceSub}</span>
                </span>
                <ArrowRight size={16} className="shrink-0" style={{ color: 'var(--brass)' }} />
              </button>

              <button
                onClick={() => start('all')}
                className="flex items-center gap-3 text-left px-4 py-3.5 rounded-[8px] border transition-colors"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brass-dim)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
              >
                <span className="grid place-items-center w-9 h-9 rounded-[7px] shrink-0" style={{ background: 'var(--bg-raised)', color: 'var(--text-2)' }}>
                  <Compass size={17} strokeWidth={1.9} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{t.onboarding.fullGuideChoice}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--text-3)' }}>{t.onboarding.fullGuideChoiceSub}</span>
                </span>
                <ArrowRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={handleSample} className="px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--text-2)' }}>{t.onboarding.sampleData}</button>
              <div className="flex-1" />
              <button onClick={completeOnboarding} className="px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{t.onboarding.skip}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

function StepView({ topic, copy, step, total, isLast, onBack, onNext, onClose }: {
  topic: OnboardingTopic;
  copy: { title: string; hint: string; body: string };
  step: number;
  total: number;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useFinance();
  const Icon = TOPIC_ICON[topic.id] ?? Wallet;

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
          {t.onboarding.stepOf.replace('{n}', String(step)).replace('{total}', String(total))}
        </span>
        <button onClick={onClose} aria-label={t.onboarding.close} className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Progress bar */}
      <ProgressBar pct={(step / total) * 100} heightClass="h-1" trackColor="var(--bg-raised)" color="var(--brass)" className="mb-4" />

      <div className="flex items-center gap-2.5 mb-2">
        <span className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0" style={{ background: 'var(--warning-bg)', color: 'var(--brass)' }}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <h2 className="font-serif text-[24px] sm:text-[26px] font-medium leading-tight" style={{ color: 'var(--text-1)' }}>{copy.title}</h2>
      </div>
      <p className="text-[14px] leading-[1.55] mb-4" style={{ color: 'var(--text-2)' }}>{copy.body}</p>

      {topic.fields.length > 0 && <FieldsForm key={topic.id} fields={topic.fields} />}
      {topic.id === 'fixedExpenses' && <FixedExpenseAdder />}
      {topic.id === 'debt' && <DebtAdder />}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--text-2)' }}>
          <ArrowLeft size={15} /> {t.onboarding.back}
        </button>
        <div className="flex-1" />
        <button onClick={onNext} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] text-[13px] font-semibold" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
          {isLast ? (<><Check size={15} /> {t.onboarding.finish}</>) : (<>{t.onboarding.next} <ArrowRight size={15} /></>)}
        </button>
      </div>
    </div>
  );
}

/**
 * Optional inputs for one step. Remounted per topic (keyed by the parent), so its
 * `values` state seeds once from live state via the lazy initializer — no syncing
 * effect. Each edit writes straight through to real state; leaving them untouched
 * and pressing Next is fine.
 */
function FieldsForm({ fields }: { fields: OnboardingField[] }) {
  const {
    t, lang, setLang, region, setRegion,
    currentMonth, effectiveIncome, setMonthlyIncomeForMonth,
    savingsTargetPercent, setSavingsTargetPercent,
    assets, updateAsset, pension, updatePension,
    addSavingsAccount, updateSavingsAccount,
  } = useFinance();

  const monthKey = format(currentMonth, 'yyyy-MM');

  const readValue = (f: OnboardingField): string => {
    switch (f.writer) {
      case 'lang': return lang;
      case 'region': return region;
      case 'income': return String(Math.round(effectiveIncome));
      case 'savingsTarget': return String(savingsTargetPercent);
      case 'asset': return String(assets[f.key as keyof Assets] ?? 0);
      case 'savingsAccount': return String(assets.savingsAccounts?.[0]?.balance ?? 0);
      case 'pension': return String(pension[f.key as keyof Pension] ?? 0);
      default: return '';
    }
  };

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = readValue(f);
    return seed;
  });

  const writeField = (f: OnboardingField, raw: string) => {
    setValues(prev => ({ ...prev, [f.key]: raw }));
    if (f.writer === 'lang') { setLang(raw as Language); return; }
    if (f.writer === 'region') { setRegion(raw as Region); return; }
    const n = parseLocaleNumber(raw);
    if (isNaN(n) || n < 0) return; // keep the draft, don't push an invalid value
    if (f.writer === 'income') setMonthlyIncomeForMonth(monthKey, n);
    else if (f.writer === 'savingsTarget') setSavingsTargetPercent(Math.min(100, n));
    else if (f.writer === 'asset') updateAsset(f.key as keyof Assets, n);
    else if (f.writer === 'savingsAccount') {
      // Upsert the first savings account — the legacy `savings` scalar is dead
      // whenever the (always-present) array exists, so it must not be written.
      const first = assets.savingsAccounts?.[0];
      if (first) updateSavingsAccount(first.id, { balance: n });
      else addSavingsAccount(t.onboarding.fields.savings, n);
    }
    else if (f.writer === 'pension') updatePension(f.key as keyof Pension, n);
  };

  const fieldLabels = t.onboarding.fields;
  const optionLabels = t.onboarding.options;

  return (
    <div className="space-y-3 mb-5">
      {fields.map(f => {
        const labelText = fieldLabels[f.labelKey as keyof typeof fieldLabels];
        const id = `onb-${f.key}`;
        return (
          <div key={f.key} className="space-y-1.5">
            <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
              {labelText}
            </label>
            {f.kind === 'select' ? (
              <select
                id={id}
                value={values[f.key] ?? ''}
                onChange={e => writeField(f, e.target.value)}
                className="w-full rounded-[6px] px-4 py-3 text-[14px] border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]"
                style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              >
                {(f.options ?? []).map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {optionLabels[opt.labelKey as keyof typeof optionLabels]}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={e => writeField(f, e.target.value)}
                className="w-full rounded-[6px] px-4 py-3 text-[14px] font-mono border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]"
                style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline "add a fixed expense" for that step — appends to real state; the
 *  highlighted card behind updates live. */
function FixedExpenseAdder() {
  const { t, fixedExpenses, setFixedExpenses, formatCurrency } = useFinance();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<ExpenseType>('fixed');
  const n = parseLocaleNumber(amount);
  const canAdd = name.trim() !== '' && !isNaN(n) && n > 0;
  const add = () => {
    if (!canAdd) return;
    setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: name.trim(), amount: n, type }]);
    setName(''); setAmount('');
  };
  const types: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];
  return (
    <div className="mb-5 space-y-3">
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.onboarding.itemName}</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t.onboarding.expensePlaceholder} className={inputCls} style={inputStyle} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.onboarding.monthlyAmount}</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
        <div className="w-[42%] space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.expenseTypeLabel}</label>
          <select value={type} onChange={e => setType(e.target.value as ExpenseType)} className={inputCls} style={inputStyle}>
            {types.map(v => <option key={v} value={v}>{t.expenseType[v]}</option>)}
          </select>
        </div>
      </div>
      <button onClick={add} disabled={!canAdd} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-semibold disabled:opacity-40" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
        <Plus size={15} /> {t.onboarding.add}
      </button>
      {fixedExpenses.length > 0 && (
        <div className="space-y-1 max-h-[150px] overflow-y-auto pt-1">
          {fixedExpenses.map(e => (
            <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-[6px] text-[13px]" style={{ background: 'var(--bg-2)' }}>
              <span className="truncate" style={{ color: 'var(--text-1)' }}>{e.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-mono tabular-nums" style={{ color: 'var(--text-2)' }}>{formatCurrency(e.amount)}</span>
                <button onClick={() => setFixedExpenses(fixedExpenses.filter(x => x.id !== e.id))} aria-label={t.onboarding.remove} className="text-[var(--text-3)] hover:text-[var(--negative)]"><X size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline "add a debt" for that step. */
function DebtAdder() {
  const { t, debts, setDebts, formatCurrency } = useFinance();
  const d = t.debt;
  const [name, setName] = useState('');
  const [type, setType] = useState<DebtType>('student');
  const [balance, setBalance] = useState('');
  const [rate, setRate] = useState('');
  const [minPayment, setMinPayment] = useState('');
  const [revolving, setRevolving] = useState(false);
  const pn = (s: string) => { const x = parseLocaleNumber(s); return isNaN(x) || x < 0 ? null : x; };
  const b = pn(balance), r = pn(rate), mp = pn(minPayment);
  // A revolving card is paid in full → only a name + balance are needed.
  const canAdd = name.trim() !== '' && b !== null && (revolving || (r !== null && mp !== null));
  const add = () => {
    if (name.trim() === '' || b === null || (!revolving && (r === null || mp === null))) return;
    setDebts([...debts, {
      id: crypto.randomUUID(), name: name.trim(), type, balance: b,
      rate: revolving ? 0 : r!, minPayment: revolving ? 0 : mp!, revolving: revolving || undefined,
    }]);
    setName(''); setBalance(''); setRate(''); setMinPayment(''); setRevolving(false);
  };
  return (
    <div className="mb-5 space-y-3">
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.name}</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t.onboarding.debtPlaceholder} className={inputCls} style={inputStyle} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.balance}</label>
          <input value={balance} onChange={e => setBalance(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
        <div className="w-[42%] space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.typeLabel}</label>
          <select value={type} onChange={e => setType(e.target.value as DebtType)} className={inputCls} style={inputStyle}>
            {DEBT_TYPES.map(v => <option key={v} value={v}>{d.types[v]}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.revolvingLabel}</label>
        <select value={revolving ? 'yes' : 'no'} onChange={e => setRevolving(e.target.value === 'yes')} className={inputCls} style={inputStyle}>
          <option value="no">{d.revolvingNo}</option>
          <option value="yes">{d.revolvingYes}</option>
        </select>
      </div>
      {!revolving && (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.rate}</label>
            <input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
          </div>
          <div className="flex-1 space-y-1.5">
            <label className={microLabel} style={{ color: 'var(--text-2)' }}>{d.minPayment}</label>
            <input value={minPayment} onChange={e => setMinPayment(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
          </div>
        </div>
      )}
      <button onClick={add} disabled={!canAdd} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-semibold disabled:opacity-40" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
        <Plus size={15} /> {t.onboarding.add}
      </button>
      {debts.length > 0 && (
        <div className="space-y-1 max-h-[150px] overflow-y-auto pt-1">
          {debts.map(x => (
            <div key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-[6px] text-[13px]" style={{ background: 'var(--bg-2)' }}>
              <span className="truncate" style={{ color: 'var(--text-1)' }}>{x.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-mono tabular-nums" style={{ color: 'var(--text-2)' }}>{formatCurrency(x.balance)}</span>
                <button onClick={() => setDebts(debts.filter(y => y.id !== x.id))} aria-label={t.onboarding.remove} className="text-[var(--text-3)] hover:text-[var(--negative)]"><X size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
