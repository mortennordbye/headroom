import { useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import {
  useFinance,
  type SalaryEntry, type SalaryChangeType,
  type BonusEntry, type BonusType,
  type OvertimeEntry, type HoursSnapshot,
} from '../context/FinanceContext';
import { computeNewGross, priorSalaryForJob, type SalaryEntryMode } from '../lib/salary';
import { isValidYearMonth, isValidYearMonthDay, isNonNegativeNumber, parseLocaleNumber } from '../lib/validators';

const inputBase =
  'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--positive)]';
const inputMono = `${inputBase} font-mono placeholder:text-[var(--text-2)] placeholder:font-sans`;
const labelClass = 'text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wide';

/** The event kinds selectable from the type grid. */
export type RecordType = 'raise' | 'promotion' | 'adjustment' | 'bonus' | 'overtime' | 'hours';
const SALARY_TYPES: readonly RecordType[] = ['raise', 'promotion', 'adjustment'];

/** When editing, which entity + row we're editing. */
export type RecordEditTarget =
  | { kind: 'salary'; entry: SalaryEntry }
  | { kind: 'bonus'; entry: BonusEntry }
  | { kind: 'overtime'; entry: OvertimeEntry }
  | { kind: 'hours'; entry: HoursSnapshot };

type Entity = 'salary' | 'bonus' | 'overtime' | 'hours';
const entityOf = (t: RecordType): Entity =>
  SALARY_TYPES.includes(t) ? 'salary' : (t as Entity);

interface Props {
  target?: RecordEditTarget;
  initialType?: RecordType;
  onClose: () => void;
  /** Opens the separate "new job" flow (jobs aren't events). */
  onNewJob?: () => void;
}

/**
 * Type-first "record event" dialog. Pick an event kind from the grid (or edit
 * an existing one) and the relevant fields appear. Salary changes support the
 * +% / +kr / new-total entry with a live computed result; bonus, overtime and
 * hours reuse the same entities and validation as before.
 */
export default function RecordEventModal({ target, initialType, onClose, onNewJob }: Props) {
  const {
    t, formatCurrency, jobs, salaries,
    addSalary, updateSalary,
    addBonus, updateBonus,
    addOvertime, updateOvertime,
    addHoursSnapshot, updateHoursSnapshot,
  } = useFinance();

  const editing = !!target;
  const defaultJobId = useMemo(() => {
    const current = [...jobs].reverse().find(j => !j.endDate);
    return current?.id ?? jobs[jobs.length - 1]?.id ?? '';
  }, [jobs]);

  // Grid selection (add mode). Editing derives the entity from the target.
  const [selType, setSelType] = useState<RecordType>(() => {
    if (target?.kind === 'salary') return SALARY_TYPES.includes(target.entry.changeType as RecordType) ? (target.entry.changeType as RecordType) : 'raise';
    if (target) return target.kind;
    return initialType ?? 'raise';
  });
  const entity: Entity = editing ? target!.kind : entityOf(selType);

  const sTarget = target?.kind === 'salary' ? target.entry : undefined;
  const bTarget = target?.kind === 'bonus' ? target.entry : undefined;
  const oTarget = target?.kind === 'overtime' ? target.entry : undefined;
  const hTarget = target?.kind === 'hours' ? target.entry : undefined;

  const [jobId, setJobId] = useState<string>(
    (target ? (target.kind === 'salary' ? target.entry.jobId : target.entry.jobId ?? '') : defaultJobId),
  );
  const [notes, setNotes] = useState(target?.entry.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  // Salary
  const [salaryChangeType, setSalaryChangeType] = useState<SalaryChangeType>(sTarget?.changeType ?? 'raise');
  const [effectiveDate, setEffectiveDate] = useState(sTarget?.effectiveDate ?? '');
  const [salaryMode, setSalaryMode] = useState<SalaryEntryMode>(sTarget ? 'total' : 'percent');
  const [salaryAmount, setSalaryAmount] = useState(sTarget ? String(sTarget.grossAnnual) : '');

  // Bonus
  const [bonusDate, setBonusDate] = useState(bTarget?.date ?? '');
  const [bonusAmount, setBonusAmount] = useState(bTarget ? String(bTarget.amount) : '');
  const [bonusType, setBonusType] = useState<BonusType>(bTarget?.type ?? 'annual');
  const [bonusInclude, setBonusInclude] = useState(!!bTarget?.includeInBudget);

  // Overtime
  const [otDate, setOtDate] = useState(oTarget?.date ?? '');
  const [otHours, setOtHours] = useState(oTarget ? String(oTarget.hours) : '');
  const [otAmount, setOtAmount] = useState(oTarget ? String(oTarget.amount) : '');
  const [otInclude, setOtInclude] = useState(!!oTarget?.includeInBudget);

  // Hours
  const [hoursMonth, setHoursMonth] = useState(hTarget?.periodMonth ?? '');
  const [hoursValue, setHoursValue] = useState(hTarget ? String(hTarget.actualHoursPerWeek) : '37.5');

  const typeCards: { type: RecordType; label: string; color: string }[] = [
    { type: 'raise', label: t.salary.changeTypeRaise, color: 'var(--positive)' },
    { type: 'promotion', label: t.salary.changeTypePromotion, color: 'var(--violet)' },
    { type: 'adjustment', label: t.salary.changeTypeAdjustment, color: 'var(--warning)' },
    { type: 'bonus', label: t.salary.bonuses, color: 'var(--teal)' },
    { type: 'overtime', label: t.salary.overtime, color: 'var(--slate)' },
    { type: 'hours', label: t.salary.hoursChange, color: 'var(--text-dim)' },
  ];

  // ── Salary live result ──────────────────────────────────────────
  const prior = useMemo(
    () => (entity === 'salary' && isValidYearMonth(effectiveDate)
      ? priorSalaryForJob(salaries, jobId, effectiveDate, sTarget?.id)
      : null),
    [entity, salaries, jobId, effectiveDate, sTarget?.id],
  );
  const prevGross = prior ? prior.grossAnnual : null;
  const hasPrev = prevGross != null;
  const effMode: SalaryEntryMode = hasPrev ? salaryMode : 'total';
  const sAmt = parseLocaleNumber(salaryAmount);
  const newGross = salaryAmount.trim() !== '' && Number.isFinite(sAmt)
    ? computeNewGross(effMode, sAmt, prevGross ?? 0) : null;
  const amountLabel = effMode === 'percent' ? t.salary.amountPercent
    : effMode === 'kr' ? t.salary.amountKr : t.salary.amountTotal;

  const bonusTypes: { value: BonusType; label: string }[] = [
    { value: 'annual', label: t.salary.bonusTypeAnnual },
    { value: 'performance', label: t.salary.bonusTypePerformance },
    { value: 'signing', label: t.salary.bonusTypeSigning },
    { value: 'holiday_pay', label: t.salary.bonusTypeHolidayPay },
    { value: 'profit_share', label: t.salary.bonusTypeProfitShare },
    { value: 'other', label: t.salary.bonusTypeOther },
  ];
  const jobOptional = entity !== 'salary';

  const handleSave = () => {
    if (entity === 'salary') {
      if (!isValidYearMonth(effectiveDate)) return setError(t.salaryPage.errInvalidDateMonth);
      if (newGross == null || newGross < 0) return setError(t.salaryPage.errSalaryPositive);
      const payload = {
        jobId,
        effectiveDate,
        grossAnnual: newGross,
        changeType: editing ? salaryChangeType : (selType as SalaryChangeType),
        notes: notes.trim() || undefined,
      };
      if (sTarget) updateSalary(sTarget.id, payload); else addSalary(payload);
    } else if (entity === 'bonus') {
      if (!isValidYearMonthDay(bonusDate)) return setError(t.salaryPage.errInvalidDateDay);
      if (!isNonNegativeNumber(bonusAmount)) return setError(t.salaryPage.errAmountPositive);
      const payload = {
        jobId: jobId || undefined,
        date: bonusDate,
        amount: parseLocaleNumber(bonusAmount),
        type: bonusType,
        includeInBudget: bonusInclude || undefined,
        notes: notes.trim() || undefined,
      };
      if (bTarget) updateBonus(bTarget.id, payload); else addBonus(payload);
    } else if (entity === 'overtime') {
      if (!isValidYearMonthDay(otDate)) return setError(t.salaryPage.errInvalidDateDay);
      if (!isNonNegativeNumber(otHours) || !isNonNegativeNumber(otAmount)) return setError(t.salaryPage.errHoursAmountPositive);
      const payload = {
        jobId: jobId || undefined,
        date: otDate,
        hours: parseLocaleNumber(otHours),
        amount: parseLocaleNumber(otAmount),
        includeInBudget: otInclude || undefined,
        notes: notes.trim() || undefined,
      };
      if (oTarget) updateOvertime(oTarget.id, payload); else addOvertime(payload);
    } else {
      if (!isValidYearMonth(hoursMonth)) return setError(t.salaryPage.errInvalidMonth);
      if (!isNonNegativeNumber(hoursValue)) return setError(t.salaryPage.errHoursPositiveShort);
      const payload = {
        jobId: jobId || undefined,
        periodMonth: hoursMonth,
        actualHoursPerWeek: parseLocaleNumber(hoursValue),
        notes: notes.trim() || undefined,
      };
      if (hTarget) updateHoursSnapshot(hTarget.id, payload); else addHoursSnapshot(payload);
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSave(); };

  const jobField = (
    <div className="space-y-1.5">
      <label className={labelClass}>{t.salary.job}</label>
      <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={inputBase}>
        {jobOptional && <option value="">{t.salary.unassigned}</option>}
        {jobs.map(j => <option key={j.id} value={j.id}>{`${j.employer} — ${j.role}`}</option>)}
      </select>
    </div>
  );

  const toggle = (opts: { value: string; label: string }[], value: string, onChange: (v: string) => void) => (
    <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden shrink-0">
      {opts.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className="px-3 py-2 text-[12px] font-semibold transition-colors"
            style={{ background: active ? 'var(--accent-bg)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );

  const includeToggle = (value: boolean, onChange: (v: boolean) => void) => (
    <div className="space-y-1.5">
      <label className={labelClass}>{t.salary.includeInBudget}</label>
      {toggle([{ value: 'no', label: t.salary.includeInBudgetNo }, { value: 'yes', label: t.salary.includeInBudgetYes }],
        value ? 'yes' : 'no', v => onChange(v === 'yes'))}
    </div>
  );

  return (
    <ModalShell
      title={editing ? typeCards.find(c => c.type === selType)?.label ?? t.salary.recordEvent : t.salary.recordEvent}
      onClose={onClose}
      closeLabel={t.cancel}
      icon={<TrendingUp size={16} className="text-[var(--text-2)]" />}
      panelClassName="sm:min-w-[380px] sm:max-w-sm space-y-5"
      initialFocus={firstRef}
      footer={
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors">{t.cancel}</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity">{t.save}</button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Type grid (add mode only) */}
        {!editing && (
          <div className="grid grid-cols-3 gap-2">
            {typeCards.map(c => {
              const active = selType === c.type;
              return (
                <button key={c.type} type="button" onClick={() => setSelType(c.type)}
                  className="rounded-[7px] border px-2 py-2.5 text-center text-[11px] font-semibold transition-colors"
                  style={{
                    background: active ? 'var(--accent-bg)' : 'var(--bg-raised)',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                  }}>
                  <span className="block w-[9px] h-[9px] rounded-full mx-auto mb-1.5" style={{ background: c.color }} />
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Salary edit: change-type select (grid is hidden when editing) */}
        {editing && entity === 'salary' && (
          <div className="space-y-1.5">
            <label className={labelClass}>{t.salary.changeType}</label>
            <select value={salaryChangeType} onChange={(e) => setSalaryChangeType(e.target.value as SalaryChangeType)} className={inputBase}>
              <option value="initial">{t.salary.changeTypeInitial}</option>
              <option value="raise">{t.salary.changeTypeRaise}</option>
              <option value="promotion">{t.salary.changeTypePromotion}</option>
              <option value="job_change">{t.salary.changeTypeJobChange}</option>
              <option value="adjustment">{t.salary.changeTypeAdjustment}</option>
            </select>
          </div>
        )}

        {/* ── SALARY ── */}
        {entity === 'salary' && (<>
          <div className="space-y-1.5">
            <label htmlFor="re-eff" className={labelClass}>{t.salary.effectiveDate}</label>
            <input id="re-eff" ref={firstRef} type="text" value={effectiveDate} placeholder="2024-04"
              onChange={(e) => setEffectiveDate(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
          {jobs.length > 1 && jobField}
          <div className="space-y-1.5">
            <div className={labelClass}>{amountLabel}</div>
            <div className="flex gap-2">
              <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden shrink-0">
                {([['percent', t.salary.entryModePercent], ['kr', t.salary.entryModeKr], ['total', t.salary.entryModeTotal]] as [SalaryEntryMode, string][]).map(([m, lbl]) => {
                  const disabled = !hasPrev && m !== 'total';
                  const active = effMode === m;
                  return (
                    <button key={m} type="button" disabled={disabled} onClick={() => setSalaryMode(m)}
                      className="px-3 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: active ? 'var(--accent-bg)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)' }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <input type="text" inputMode="decimal" value={salaryAmount}
                onChange={(e) => setSalaryAmount(e.target.value)} onKeyDown={onKeyDown}
                className={inputMono} />
            </div>
            {!hasPrev && isValidYearMonth(effectiveDate) && (
              <p className="text-[11px] leading-snug text-[var(--text-2)] normal-case tracking-normal">{t.salary.noPriorSalaryHint}</p>
            )}
          </div>
          {newGross != null && (
            <div className="flex items-baseline justify-between px-4 py-3 rounded-[6px] bg-[var(--bg-raised)] border border-[var(--border)]">
              <span className={labelClass}>{t.salary.computedNewSalary}</span>
              <span className="text-[14px] font-mono font-semibold text-[var(--text-1)]">
                {formatCurrency(newGross)}
                {effMode !== 'total' && hasPrev && (
                  <span className="ml-2 text-[11px] font-normal text-[var(--text-2)]">({t.salary.wasPrefix} {formatCurrency(prevGross)})</span>
                )}
              </span>
            </div>
          )}
        </>)}

        {/* ── BONUS ── */}
        {entity === 'bonus' && (<>
          <div className="space-y-1.5">
            <label htmlFor="re-bd" className={labelClass}>{t.salary.bonusDate}</label>
            <input id="re-bd" ref={firstRef} type="text" value={bonusDate} placeholder="2024-06-15"
              onChange={(e) => setBonusDate(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
          {jobs.length > 1 && jobField}
          <div className="space-y-1.5">
            <label className={labelClass}>{t.salary.bonusAmount}</label>
            <input type="text" inputMode="decimal" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>{t.salary.bonusType}</label>
            <select value={bonusType} onChange={(e) => setBonusType(e.target.value as BonusType)} className={inputBase}>
              {bonusTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {includeToggle(bonusInclude, setBonusInclude)}
        </>)}

        {/* ── OVERTIME ── */}
        {entity === 'overtime' && (<>
          <div className="space-y-1.5">
            <label htmlFor="re-od" className={labelClass}>{t.salary.overtimeDate}</label>
            <input id="re-od" ref={firstRef} type="text" value={otDate} placeholder="2024-06-15"
              onChange={(e) => setOtDate(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
          {jobs.length > 1 && jobField}
          <div className="flex gap-2">
            <div className="space-y-1.5 flex-1">
              <label className={labelClass}>{t.salary.overtimeHours}</label>
              <input type="text" inputMode="decimal" value={otHours} onChange={(e) => setOtHours(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
            </div>
            <div className="space-y-1.5 flex-1">
              <label className={labelClass}>{t.salary.overtimeAmount}</label>
              <input type="text" inputMode="decimal" value={otAmount} onChange={(e) => setOtAmount(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
            </div>
          </div>
          {includeToggle(otInclude, setOtInclude)}
        </>)}

        {/* ── HOURS ── */}
        {entity === 'hours' && (<>
          <div className="space-y-1.5">
            <label htmlFor="re-hm" className={labelClass}>{t.salary.periodMonth}</label>
            <input id="re-hm" ref={firstRef} type="text" value={hoursMonth} placeholder="2024-06"
              onChange={(e) => setHoursMonth(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
          {jobs.length > 1 && jobField}
          <div className="space-y-1.5">
            <label className={labelClass}>{t.salary.actualHours}</label>
            <input type="text" inputMode="decimal" value={hoursValue} onChange={(e) => setHoursValue(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
          </div>
        </>)}

        {/* Notes (all types) */}
        <div className="space-y-1.5">
          <label className={labelClass}>{t.salary.notes}</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={onKeyDown} className={inputMono} />
        </div>

        {!editing && onNewJob && (
          <button type="button" onClick={() => { onClose(); onNewJob(); }}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-[6px] text-[12px] font-semibold border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--text-3)] transition-colors">
            ＋ {t.salary.addJob}
          </button>
        )}

        {error && <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>}
      </div>
    </ModalShell>
  );
}
