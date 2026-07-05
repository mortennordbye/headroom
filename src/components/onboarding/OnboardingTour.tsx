import { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, Check, X, Sparkles, ChevronRight,
  Wallet, Coins, PiggyBank, Home, TrendingUp, Bitcoin, Landmark, Briefcase,
  LayoutDashboard, LineChart, Target, CreditCard, Settings as SettingsIcon, Globe,
} from 'lucide-react';
import { useFinance, type Assets, type Pension, type Language, type Region } from '../../context/FinanceContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { parseLocaleNumber } from '../../lib/validators';
import {
  ONBOARDING_GROUPS,
  ONBOARDING_TOPICS,
  ONBOARDING_TOPIC_COUNT,
  topicsInGroup,
  topicById,
  type OnboardingField,
  type OnboardingTopic,
  type OnboardingGroup,
} from '../../lib/onboarding';

/** Icon per topic id (kept in the shell — the catalog stays data-only). */
const TOPIC_ICON: Record<string, typeof Wallet> = {
  prefs: Globe, income: Wallet, savingsTarget: Target, fixedExpenses: Coins,
  cash: PiggyBank, home: Home, stocks: TrendingUp, crypto: Bitcoin, pension: Briefcase,
  debt: CreditCard, growth: LineChart,
  dashboard: LayoutDashboard, salary: LineChart, forecast: TrendingUp, loan: Landmark, settings: SettingsIcon,
};

/**
 * Guided setup as a *hub*, not a linear wizard: the user opens the guide and
 * picks any topic in any order. Each topic shows the real screen with the
 * relevant section highlighted (a viewport-wide dim drawn by the section's own
 * box-shadow — no rect math) and a coach panel that explains it and, for "fill"
 * topics, hosts inputs that write straight to real state. Mounted in Layout so
 * it has router + context on every route.
 */
export default function OnboardingTour() {
  const { onboardingActive } = useFinance();
  if (!onboardingActive) return null;
  return <OnboardingHub />;
}

function OnboardingHub() {
  const {
    t, demoMode, toggleDemoMode, completeOnboarding,
    effectiveIncome, savingsTargetPercent, assets, pension,
  } = useFinance();
  const navigate = useNavigate();
  const location = useLocation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const highlightedEl = useRef<Element | null>(null);

  const topic = openId ? topicById(openId) ?? null : null;

  const clearHighlight = useCallback(() => {
    if (highlightedEl.current) {
      highlightedEl.current.classList.remove('tour-highlight');
      highlightedEl.current = null;
    }
  }, []);

  // Drive route + highlight from the open topic. In the hub (no open topic) the
  // scrim dims the whole screen, so nothing is highlighted.
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
  }, [openId, location.pathname, clearHighlight]);

  const panelRef = useFocusTrap<HTMLDivElement>(completeOnboarding, undefined, true);

  // A fill topic counts as "done" once any of its numeric fields holds a value,
  // or once the user has opened it (learn topics rely on the visited flag).
  const hasData = (tp: OnboardingTopic): boolean => tp.fields.some(f => {
    switch (f.writer) {
      case 'income': return effectiveIncome > 0;
      case 'savingsTarget': return savingsTargetPercent > 0;
      case 'asset': return (assets[f.key as keyof Assets] ?? 0) > 0;
      case 'pension': return (pension[f.key as keyof Pension] ?? 0) > 0;
      case 'lang': case 'region': return true;
      default: return false;
    }
  });
  const isDone = (tp: OnboardingTopic): boolean => visited.has(tp.id) || (tp.kind === 'fill' && hasData(tp));
  const doneCount = ONBOARDING_TOPICS.filter(isDone).length;

  const openTopic = (id: string) => { setVisited(s => new Set(s).add(id)); setOpenId(id); };
  const backToHub = () => setOpenId(null);
  const handleSample = () => { if (!demoMode) toggleDemoMode(); completeOnboarding(); };

  const groupCopy = t.onboarding.groups;
  const topicCopy = t.onboarding.topics;

  const panelBase = 'fixed z-[60] left-0 right-0 bottom-0 sm:left-1/2 sm:right-auto sm:bottom-6 sm:-translate-x-1/2 sm:w-[560px] sm:max-w-[calc(100vw-2rem)] animate-sheet-rise rounded-t-[16px] sm:rounded-[12px] border max-h-[82vh] overflow-y-auto';
  const panelStyle = { background: 'var(--bg-card)', borderColor: 'var(--border)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' } as const;

  const overlay = (
    <>
      {/* Scrim: opaque dim in the hub (nothing highlighted); transparent while a
          topic is open (the highlighted section's box-shadow draws the dim). */}
      <div className="fixed inset-0 z-[58]" aria-hidden style={{ background: topic ? 'transparent' : 'rgba(0,0,0,0.66)' }} />

      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t.onboarding.title} className={panelBase} style={panelStyle}>
        {topic ? (
          <TopicView
            topic={topic}
            copy={topicCopy[topic.id as keyof typeof topicCopy]}
            onBack={backToHub}
            onClose={completeOnboarding}
          />
        ) : (
          <div className="p-5 sm:p-6">
            {/* Hub header */}
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles size={16} className="shrink-0" style={{ color: 'var(--brass)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                  {t.onboarding.progress.replace('{done}', String(doneCount)).replace('{total}', String(ONBOARDING_TOPIC_COUNT))}
                </span>
              </div>
              <button onClick={completeOnboarding} aria-label={t.onboarding.close} className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <h2 className="font-serif text-[26px] font-medium leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>
              {t.onboarding.title}
            </h2>
            <p className="text-[14px] leading-[1.55] mb-5" style={{ color: 'var(--text-2)' }}>
              {t.onboarding.hubIntro}
            </p>

            {ONBOARDING_GROUPS.map((group: OnboardingGroup) => (
              <div key={group} className="mb-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-3)' }}>
                  {groupCopy[group]}
                </div>
                <div className="flex flex-col gap-2">
                  {topicsInGroup(group).map(tp => {
                    const Icon = TOPIC_ICON[tp.id] ?? Wallet;
                    const done = isDone(tp);
                    return (
                      <button
                        key={tp.id}
                        onClick={() => openTopic(tp.id)}
                        className="group flex items-center gap-3 text-left px-3.5 py-3 rounded-[8px] border transition-colors"
                        style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brass-dim)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
                      >
                        <span
                          className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0"
                          style={{ background: done ? 'var(--positive-bg)' : 'var(--bg-raised)', color: done ? 'var(--positive)' : 'var(--text-2)' }}
                        >
                          {done ? <Check size={16} strokeWidth={2.5} /> : <Icon size={16} strokeWidth={1.9} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] font-medium truncate" style={{ color: 'var(--text-1)' }}>
                            {topicCopy[tp.id as keyof typeof topicCopy].title}
                          </span>
                          <span className="block text-[12px] truncate" style={{ color: 'var(--text-3)' }}>
                            {topicCopy[tp.id as keyof typeof topicCopy].hint}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Hub footer */}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleSample} className="px-4 py-2.5 rounded-[6px] text-[13px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--text-2)' }}>
                {t.onboarding.sampleData}
              </button>
              <div className="flex-1" />
              <button onClick={completeOnboarding} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] text-[13px] font-semibold" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
                <Check size={15} /> {t.onboarding.finish}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

function TopicView({ topic, copy, onBack, onClose }: {
  topic: OnboardingTopic;
  copy: { title: string; hint: string; body: string };
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useFinance();
  const Icon = TOPIC_ICON[topic.id] ?? Wallet;

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
          <ArrowLeft size={15} /> {t.onboarding.backToGuide}
        </button>
        <button onClick={onClose} aria-label={t.onboarding.close} className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="flex items-center gap-2.5 mb-2">
        <span className="grid place-items-center w-8 h-8 rounded-[6px] shrink-0" style={{ background: 'var(--warning-bg)', color: 'var(--brass)' }}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <h2 className="font-serif text-[24px] sm:text-[26px] font-medium leading-tight" style={{ color: 'var(--text-1)' }}>
          {copy.title}
        </h2>
      </div>
      <p className="text-[14px] leading-[1.55] mb-4" style={{ color: 'var(--text-2)' }}>
        {copy.body}
      </p>

      {topic.fields.length > 0 && <TopicFields key={topic.id} topic={topic} />}

      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1" />
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] text-[13px] font-semibold" style={{ background: 'var(--forest)', color: 'var(--text)' }}>
          <Check size={15} /> {t.onboarding.done}
        </button>
      </div>
    </div>
  );
}

/**
 * Draft inputs for one fill topic. Remounted per topic (keyed by the parent), so
 * its `values` state seeds once from live state via the lazy initializer — no
 * syncing effect. Each edit writes straight through to real state.
 */
function TopicFields({ topic }: { topic: OnboardingTopic }) {
  const {
    t, lang, setLang, region, setRegion,
    currentMonth, effectiveIncome, setMonthlyIncomeForMonth,
    savingsTargetPercent, setSavingsTargetPercent,
    assets, updateAsset, pension, updatePension,
  } = useFinance();

  const monthKey = format(currentMonth, 'yyyy-MM');

  const readValue = (f: OnboardingField): string => {
    switch (f.writer) {
      case 'lang': return lang;
      case 'region': return region;
      case 'income': return String(Math.round(effectiveIncome));
      case 'savingsTarget': return String(savingsTargetPercent);
      case 'asset': return String(assets[f.key as keyof Assets] ?? 0);
      case 'pension': return String(pension[f.key as keyof Pension] ?? 0);
      default: return '';
    }
  };

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of topic.fields) seed[f.key] = readValue(f);
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
    else if (f.writer === 'pension') updatePension(f.key as keyof Pension, n);
  };

  const fieldLabels = t.onboarding.fields;
  const optionLabels = t.onboarding.options;

  return (
    <div className="space-y-3 mb-5">
      {topic.fields.map(f => {
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
