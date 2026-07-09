import { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, ArrowRight, Check, X, Sparkles, Plus, FileUp,
  Wallet, Coins, PiggyBank, Home, TrendingUp, Bitcoin, Landmark, Briefcase,
  LayoutDashboard, LineChart, Target, CreditCard, Settings as SettingsIcon, Globe,
} from 'lucide-react';
import { useFinance, type Assets, type Pension, type Language, type Region, type ExpenseType, type DebtType, type FixedExpense } from '../../context/FinanceContext';
import { DEBT_TYPES } from '../../lib/debt';
import PayslipImportModal from '../PayslipImportModal';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ProgressBar } from '../ui/ProgressBar';
import { parseLocaleNumber, isValidYearMonth } from '../../lib/validators';
import { CATEGORIES, isCategoryKey } from '../../lib/categories';
import {
  ONBOARDING_TOPICS,
  type OnboardingField,
  type OnboardingTopic,
} from '../../lib/onboarding';

/** Icon per topic id (kept in the shell — the catalog stays data-only). */
const TOPIC_ICON: Record<string, typeof Wallet> = {
  prefs: Globe, job: Briefcase, income: Wallet, savingsTarget: Target, fixedExpenses: Coins,
  cash: PiggyBank, home: Home, stocks: TrendingUp, crypto: Bitcoin, pension: Briefcase,
  debt: CreditCard, growth: LineChart,
  dashboard: LayoutDashboard, salary: LineChart, forecast: TrendingUp, loan: Landmark, settings: SettingsIcon,
};

const inputCls = 'w-full rounded-[6px] px-3 py-2.5 text-[14px] border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]';
const inputStyle = { background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' } as const;
const microLabel = 'text-[11px] font-medium uppercase tracking-wide';

/**
 * Guided setup: one merged flow (welcome → every topic in order). It runs as a
 * low-friction **linear stepper** — one topic per screen with Back / Next. The
 * core inputs (language, job + salary, income, savings target) are required and
 * block Next until filled; every other step is skippable. Each step shows the
 * real screen with the relevant section highlighted (a viewport-wide dim drawn
 * by the section's own box-shadow — no rect math) and, for "fill" topics, inputs
 * that write live to state. Leaving early (X / Escape / backdrop) asks for
 * confirmation. Mounted in Layout so it has router + context on every route.
 */
export default function OnboardingTour() {
  const { onboardingActive, onboardingNonce } = useFinance();
  if (!onboardingActive) return null;
  // Key by the nonce so each open/reset remounts a fresh flow at the welcome.
  return <OnboardingHub key={onboardingNonce} />;
}

function OnboardingHub() {
  const { t, demoMode, toggleDemoMode, completeOnboarding, jobs, salaries, effectiveIncome } = useFinance();
  const navigate = useNavigate();
  const location = useLocation();
  const [started, setStarted] = useState(false); // false = welcome
  const [index, setIndex] = useState(0);
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const highlightedEl = useRef<Element | null>(null);

  const sequence = ONBOARDING_TOPICS;
  const topic = started ? sequence[index] ?? null : null;

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
  }, [started, index, location.pathname, clearHighlight]);

  // Leaving early asks for confirmation; the focus trap routes Escape here too.
  const requestClose = useCallback(() => setConfirmClose(true), []);
  const panelRef = useFocusTrap<HTMLDivElement>(requestClose, undefined, true);

  const handleSample = () => { if (!demoMode) toggleDemoMode(); completeOnboarding(); };
  const isFirst = index === 0;
  const isLast = index >= sequence.length - 1;
  // Required steps block Next until satisfied. Only job (a current job with a
  // salary) and income (a non-zero figure) can actually be incomplete; language
  // and savings target always carry a value, so their gate is a no-op.
  const canProceed = !topic?.required
    || (topic.id === 'job'
        ? jobs.some(j => j.endDate === null && salaries.some(s => s.jobId === j.id))
        : topic.id === 'income'
          ? effectiveIncome > 0
          : true);
  const canSkip = !!topic && !topic.required && !isLast;
  const onBack = () => { if (isFirst) { setStarted(false); } else { setIndex(i => i - 1); } };
  const advance = () => { if (isLast) { completeOnboarding(); } else { setIndex(i => i + 1); } };
  const onNext = () => { if (canProceed) advance(); };

  const topicCopy = t.onboarding.topics;

  const panelBase = 'fixed z-[60] left-0 right-0 bottom-0 sm:left-1/2 sm:right-auto sm:bottom-6 sm:-translate-x-1/2 sm:w-[560px] sm:max-w-[calc(100vw-2rem)] animate-sheet-rise rounded-t-[16px] sm:rounded-[12px] border max-h-[82vh] overflow-y-auto';
  const panelStyle = { background: 'var(--bg-card)', borderColor: 'var(--border)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' } as const;

  const overlay = (
    <>
      {/* Scrim: opaque dim on the welcome (nothing highlighted); transparent
          during a step (the highlighted section's box-shadow draws the dim).
          A click outside the sheet asks to leave, same as the X. */}
      <div className="fixed inset-0 z-[58]" aria-hidden onClick={requestClose} style={{ background: topic ? 'transparent' : 'rgba(0,0,0,0.66)' }} />

      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t.onboarding.title} className={panelBase} style={panelStyle}>
        {topic ? (
          <StepView
            topic={topic}
            copy={topicCopy[topic.id as keyof typeof topicCopy]}
            step={index + 1}
            total={sequence.length}
            isLast={isLast}
            canProceed={canProceed}
            canSkip={canSkip}
            onBack={onBack}
            onNext={onNext}
            onSkip={advance}
            onClose={requestClose}
            onImportPayslip={() => setPayslipOpen(true)}
          />
        ) : (
          <div className="p-5 sm:p-6">
            <div className="flex justify-end mb-1">
              <button onClick={requestClose} aria-label={t.onboarding.close} className="grid place-items-center w-8 h-8 rounded-[6px]" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} style={{ color: 'var(--brass)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{t.onboarding.guide}</span>
            </div>
            <h2 className="font-serif text-[28px] font-medium leading-tight mb-2" style={{ color: 'var(--text-1)' }}>{t.onboarding.welcomeTitle}</h2>
            <p className="text-[14px] leading-[1.55] mb-5" style={{ color: 'var(--text-2)' }}>{t.onboarding.welcomeBody}</p>

            <button
              onClick={() => { setStarted(true); setIndex(0); }}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-[8px] text-[14px] font-semibold mb-2.5"
              style={{ background: 'var(--forest)', color: 'var(--text)' }}
            >
              {t.onboarding.startSetup} <ArrowRight size={16} />
            </button>
            <button onClick={handleSample} className="w-full px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--text-2)' }}>{t.onboarding.sampleData}</button>
          </div>
        )}
      </div>

      {/* Leave-confirmation. Own layer above the sheet (z-70) so it reads as a
          decision on top of setup rather than replacing it. */}
      {confirmClose && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) setConfirmClose(false); }}>
          <div role="alertdialog" aria-modal="true" aria-label={t.onboarding.leaveTitle} className="w-full sm:w-[380px] sm:max-w-full rounded-t-[14px] sm:rounded-[12px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <h3 className="font-serif text-[20px] font-medium leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>{t.onboarding.leaveTitle}</h3>
            <p className="text-[13px] leading-[1.5] mb-4" style={{ color: 'var(--text-2)' }}>{t.onboarding.leaveBody}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => { setConfirmClose(false); completeOnboarding(); }} className="px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{t.onboarding.leaveAnyway}</button>
              <div className="flex-1" />
              <button onClick={() => setConfirmClose(false)} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] text-[13px] font-semibold" style={{ background: 'var(--forest)', color: 'var(--text)' }}>{t.onboarding.continueSetup}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // While importing a payslip, hand the screen to that modal (its own portal,
  // z-50) and hide the onboarding sheet (z-60) so it doesn't sit on top. The hub
  // stays mounted, so closing the import returns to the same step — and StepView
  // remounts, re-seeding the income field from the value the import just wrote.
  if (payslipOpen) return <PayslipImportModal onClose={() => setPayslipOpen(false)} />;

  return ReactDOM.createPortal(overlay, document.body);
}

function StepView({ topic, copy, step, total, isLast, canProceed, canSkip, onBack, onNext, onSkip, onClose, onImportPayslip }: {
  topic: OnboardingTopic;
  copy: { title: string; hint: string; body: string };
  step: number;
  total: number;
  isLast: boolean;
  canProceed: boolean;
  canSkip: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
  onImportPayslip: () => void;
}) {
  const { t } = useFinance();
  const Icon = TOPIC_ICON[topic.id] ?? Wallet;

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
          {t.onboarding.stepOf.replace('{n}', String(step)).replace('{total}', String(total))}
          {!topic.required && <span style={{ color: 'var(--brass)' }}> · {t.onboarding.optional}</span>}
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
      {topic.id === 'job' && <JobSalaryAdder />}
      {topic.id === 'savingsTarget' && <SavingsTargetControl />}
      {topic.id === 'income' && (
        <button
          onClick={onImportPayslip}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[6px] text-[13px] font-semibold border mb-5"
          style={{ background: 'var(--accent-bg)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
        >
          <FileUp size={15} /> {t.onboarding.orImportPayslip}
        </button>
      )}
      {topic.id === 'fixedExpenses' && <FixedExpenseAdder />}
      {topic.id === 'debt' && <DebtAdder />}

      {!canProceed && (
        <p className="text-[12px] mb-3 -mt-2" style={{ color: 'var(--brass)' }}>
          {topic.id === 'job' ? t.onboarding.jobRequired : t.onboarding.stepRequired}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--text-2)' }}>
          <ArrowLeft size={15} /> {t.onboarding.back}
        </button>
        <div className="flex-1" />
        {canSkip && (
          <button onClick={onSkip} className="px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>
            {t.onboarding.skip}
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--forest)', color: 'var(--text)' }}
        >
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

/** Required "current job + yearly salary" for that step. Writes a JobEntry and
 *  its initial SalaryEntry together so the income step can derive net pay; the
 *  Next button stays disabled (see OnboardingHub.canProceed) until one exists. */
function JobSalaryAdder() {
  const { t, jobs, salaries, addJob, addSalary, removeJob, currentMonth, formatCurrency } = useFinance();
  const o = t.onboarding;
  const monthKey = format(currentMonth, 'yyyy-MM');
  const [employer, setEmployer] = useState('');
  const [role, setRole] = useState('');
  const [salary, setSalary] = useState('');
  const [start, setStart] = useState(monthKey);
  const [end, setEnd] = useState('');
  const [hours, setHours] = useState('37.5');
  const [onCall, setOnCall] = useState('');
  const salaryNum = parseLocaleNumber(salary);
  const canAdd = employer.trim() !== '' && !isNaN(salaryNum) && salaryNum > 0
    && isValidYearMonth(start) && (end.trim() === '' || isValidYearMonth(end));
  const add = () => {
    if (!canAdd) return;
    const hoursNum = parseLocaleNumber(hours);
    const onCallNum = onCall.trim() === '' ? null : parseLocaleNumber(onCall);
    const id = addJob({
      startDate: start,
      endDate: isValidYearMonth(end) ? end : null,
      employer: employer.trim(),
      role: role.trim(),
      contractedHoursPerWeek: isNaN(hoursNum) || hoursNum < 0 ? 37.5 : hoursNum,
      onCallAnnual: onCallNum != null && !isNaN(onCallNum) && onCallNum >= 0 ? onCallNum : null,
    });
    addSalary({ jobId: id, effectiveDate: start, grossAnnual: salaryNum, changeType: 'initial' });
    setEmployer(''); setRole(''); setSalary(''); setEnd(''); setHours('37.5'); setOnCall('');
  };
  // One initial salary per job in this flow; take the latest if more exist.
  const salaryFor = (jobId: string) => {
    const entries = salaries.filter(s => s.jobId === jobId);
    return entries.length ? entries[entries.length - 1].grossAnnual : 0;
  };
  const currentJobs = jobs.filter(j => j.endDate === null);
  return (
    <div className="mb-5 space-y-3">
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{o.fields.employer}</label>
        <input value={employer} onChange={e => setEmployer(e.target.value)} placeholder={o.employerPlaceholder} className={inputCls} style={inputStyle} />
      </div>
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{o.fields.role}</label>
        <input value={role} onChange={e => setRole(e.target.value)} placeholder={o.rolePlaceholder} className={inputCls} style={inputStyle} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{o.fields.startMonth}</label>
          <input value={start} onChange={e => setStart(e.target.value)} placeholder="2026-07" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.salary.endDate}</label>
          <input value={end} onChange={e => setEnd(e.target.value)} placeholder="2028-06" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{o.fields.grossAnnual}</label>
        <input value={salary} onChange={e => setSalary(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.salary.contractedHours}</label>
          <input value={hours} onChange={e => setHours(e.target.value)} inputMode="decimal" placeholder="37.5" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
        <div className="flex-1 space-y-1.5">
          <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.salary.onCallAnnual}</label>
          <input value={onCall} onChange={e => setOnCall(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} style={inputStyle} />
        </div>
      </div>
      <button onClick={add} disabled={!canAdd} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-semibold disabled:opacity-40" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
        <Plus size={15} /> {o.add}
      </button>
      {currentJobs.length > 0 && (
        <div className="space-y-1 max-h-[150px] overflow-y-auto pt-1">
          {currentJobs.map(j => (
            <div key={j.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-[6px] text-[13px]" style={{ background: 'var(--bg-2)' }}>
              <span className="truncate" style={{ color: 'var(--text-1)' }}>{j.employer}{j.role ? ` · ${j.role}` : ''}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-mono tabular-nums" style={{ color: 'var(--text-2)' }}>{formatCurrency(salaryFor(j.id))}</span>
                <button onClick={() => removeJob(j.id)} aria-label={o.remove} className="text-[var(--text-3)] hover:text-[var(--negative)]"><X size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Savings target as a percentage OR a monthly kr amount. The model stores only a
 *  percentage (of income after fixed expenses), so kr is converted against that
 *  same residual on entry — the kr you type equals the recommended monthly
 *  investment. Rounded to whole percent (matching display everywhere), which also
 *  normalises any stored fractional value on mount. */
function SavingsTargetControl() {
  const { t, savingsTargetPercent, setSavingsTargetPercent, effectiveIncome, fixedExpenses, formatCurrency } = useFinance();
  const o = t.onboarding;
  const totalFixed = fixedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const residual = Math.max(0, effectiveIncome - totalFixed);
  const pctVal = Math.round(savingsTargetPercent);
  const amountVal = Math.round((residual * pctVal) / 100);
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [draft, setDraft] = useState(String(pctVal));

  // Clean up a stored fractional percent (e.g. 53.4587…) once on mount.
  useEffect(() => {
    if (savingsTargetPercent !== pctVal) setSavingsTargetPercent(pctVal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (m: 'percent' | 'amount') => {
    setMode(m);
    setDraft(m === 'percent' ? String(pctVal) : String(amountVal));
  };
  const onChange = (raw: string) => {
    setDraft(raw);
    const n = parseLocaleNumber(raw);
    if (isNaN(n) || n < 0) return;
    if (mode === 'percent') setSavingsTargetPercent(Math.min(100, Math.round(n)));
    else if (residual > 0) setSavingsTargetPercent(Math.min(100, Math.max(0, Math.round((n / residual) * 100))));
  };

  return (
    <div className="mb-5 space-y-3">
      <div className="flex gap-1.5 p-1 rounded-[8px]" style={{ background: 'var(--bg-2)' }}>
        {(['percent', 'amount'] as const).map(m => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className="flex-1 px-3 py-2 rounded-[6px] text-[12px] font-semibold uppercase tracking-wide transition-colors"
            style={mode === m ? { background: 'var(--forest)', color: 'var(--text)' } : { color: 'var(--text-3)' }}
          >
            {m === 'percent' ? o.savingsPercentMode : o.savingsAmountMode}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>
          {mode === 'percent' ? o.fields.savingsTarget : o.savingsAmountLabel}
        </label>
        <input value={draft} onChange={e => onChange(e.target.value)} inputMode="decimal" className={`${inputCls} font-mono`} style={inputStyle} />
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
        {o.savingsEquivalent.replace('{pct}', String(pctVal)).replace('{amount}', formatCurrency(amountVal))}
      </p>
    </div>
  );
}

/** Inline "add a fixed expense" for that step — appends to real state; the
 *  highlighted card behind updates live. */
function FixedExpenseAdder() {
  const { t, fixedExpenses, setFixedExpenses } = useFinance();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<ExpenseType>('fixed');
  const [category, setCategory] = useState('');
  // Per-row amount drafts so the (numeric) auto-created rows can be typed freely.
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const n = parseLocaleNumber(amount);
  const canAdd = name.trim() !== '' && !isNaN(n) && n > 0;
  const catOf = (v: string) => (isCategoryKey(v) ? v : undefined);
  const add = () => {
    if (!canAdd) return;
    setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: name.trim(), amount: n, type, category: catOf(category) }]);
    setName(''); setAmount(''); setType('fixed'); setCategory('');
  };
  const patch = (id: string, p: Partial<FixedExpense>) =>
    setFixedExpenses(fixedExpenses.map(x => (x.id === id ? { ...x, ...p } : x)));
  const editAmount = (id: string, raw: string) => {
    setAmountDrafts(d => ({ ...d, [id]: raw }));
    const v = parseLocaleNumber(raw);
    if (!isNaN(v) && v >= 0) patch(id, { amount: v });
  };
  const remove = (id: string) => setFixedExpenses(fixedExpenses.filter(x => x.id !== id));
  const types: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];
  // Optional envelope link, mirroring the Budget page's fixed-expense form.
  const catOptions = CATEGORIES.filter(c => c.key !== 'income');
  const selectCls = 'w-full rounded-[5px] px-2 py-1.5 text-[13px] border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]';
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
      <div className="space-y-1.5">
        <label className={microLabel} style={{ color: 'var(--text-2)' }}>{t.trackCategoryLabel}</label>
        <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls} style={inputStyle}>
          <option value="">{t.trackCategoryNone}</option>
          {catOptions.map(c => <option key={c.key} value={c.key}>{t.categoryLabels[c.key]}</option>)}
        </select>
      </div>
      <button onClick={add} disabled={!canAdd} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[6px] text-[13px] font-semibold disabled:opacity-40" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
        <Plus size={15} /> {t.onboarding.add}
      </button>
      {fixedExpenses.length > 0 && (
        <div className="space-y-2 max-h-[230px] overflow-y-auto pt-1">
          {fixedExpenses.map(e => (
            <div key={e.id} className="space-y-1.5 px-2.5 py-2 rounded-[6px]" style={{ background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5">
                <input
                  value={e.name}
                  onChange={ev => patch(e.id, { name: ev.target.value })}
                  aria-label={t.onboarding.itemName}
                  className="flex-1 min-w-0 rounded-[5px] px-2 py-1.5 text-[13px] border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]"
                  style={inputStyle}
                />
                <input
                  value={amountDrafts[e.id] ?? String(e.amount)}
                  onChange={ev => editAmount(e.id, ev.target.value)}
                  inputMode="decimal"
                  aria-label={t.onboarding.monthlyAmount}
                  className="w-[92px] rounded-[5px] px-2 py-1.5 text-[13px] font-mono tabular-nums border focus:outline-none focus:ring-2 focus:ring-[var(--forest-light)]"
                  style={inputStyle}
                />
                <button onClick={() => remove(e.id)} aria-label={t.onboarding.remove} className="shrink-0 p-1 text-[var(--text-3)] hover:text-[var(--negative)]"><X size={14} /></button>
              </div>
              <div className="flex gap-1.5">
                <select value={e.type ?? 'fixed'} onChange={ev => patch(e.id, { type: ev.target.value as ExpenseType })} aria-label={t.expenseTypeLabel} className={selectCls} style={inputStyle}>
                  {types.map(v => <option key={v} value={v}>{t.expenseType[v]}</option>)}
                </select>
                <select value={e.category ?? ''} onChange={ev => patch(e.id, { category: catOf(ev.target.value) })} aria-label={t.trackCategoryLabel} className={selectCls} style={inputStyle}>
                  <option value="">{t.trackCategoryNone}</option>
                  {catOptions.map(c => <option key={c.key} value={c.key}>{t.categoryLabels[c.key]}</option>)}
                </select>
              </div>
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
