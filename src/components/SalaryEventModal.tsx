import { useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import type { SalaryEntry, SalaryChangeType, JobEntry } from '../context/FinanceContext';
import type { Translations } from '../i18n/translations';
import { computeNewGross, priorSalaryForJob, type SalaryEntryMode } from '../lib/salary';
import { isValidYearMonth, parseLocaleNumber } from '../lib/validators';

const inputBase =
  'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--positive)]';
const inputMono = `${inputBase} font-mono placeholder:text-[var(--text-2)] placeholder:font-sans`;
const labelClass = 'text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wide';

interface Props {
  existing?: SalaryEntry;
  prefillChangeType?: SalaryChangeType;
  jobs: JobEntry[];
  salaries: SalaryEntry[];
  defaultJobId: string;
  t: Translations;
  formatCurrency: (n: number) => string;
  onSubmit: (payload: Omit<SalaryEntry, 'id'>, existingId?: string) => void;
  onClose: () => void;
}

/**
 * Records a salary change (raise/promotion/adjustment/initial). Unlike the
 * generic EditModal, it lets you enter the change as +%, +kr, or a new total
 * and computes the resulting gross live from the prior salary for the job.
 */
export default function SalaryEventModal({
  existing, prefillChangeType, jobs, salaries, defaultJobId, t, formatCurrency, onSubmit, onClose,
}: Props) {
  const [jobId, setJobId] = useState(existing?.jobId ?? defaultJobId);
  const [effectiveDate, setEffectiveDate] = useState(existing?.effectiveDate ?? '');
  const [changeType, setChangeType] = useState<SalaryChangeType>(existing?.changeType ?? prefillChangeType ?? 'raise');
  // Editing an existing entry starts in 'total' so the number never silently recomputes.
  const [mode, setMode] = useState<SalaryEntryMode>(existing ? 'total' : 'percent');
  const [amount, setAmount] = useState(existing ? String(existing.grossAnnual) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const changeTypes: { value: SalaryChangeType; label: string }[] = [
    { value: 'initial', label: t.salary.changeTypeInitial },
    { value: 'raise', label: t.salary.changeTypeRaise },
    { value: 'promotion', label: t.salary.changeTypePromotion },
    { value: 'job_change', label: t.salary.changeTypeJobChange },
    { value: 'adjustment', label: t.salary.changeTypeAdjustment },
  ];

  const prior = useMemo(
    () => (isValidYearMonth(effectiveDate) ? priorSalaryForJob(salaries, jobId, effectiveDate, existing?.id) : null),
    [salaries, jobId, effectiveDate, existing?.id],
  );
  const prevGross = prior ? prior.grossAnnual : null;
  const hasPrev = prevGross != null;
  // Without a prior salary (job's first entry), only a full total makes sense.
  const effectiveMode: SalaryEntryMode = hasPrev ? mode : 'total';

  const amountNum = parseLocaleNumber(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum);
  const newGross = amountValid ? computeNewGross(effectiveMode, amountNum, prevGross ?? 0) : null;

  const amountLabel =
    effectiveMode === 'percent' ? t.salary.amountPercent
    : effectiveMode === 'kr' ? t.salary.amountKr
    : t.salary.amountTotal;

  const modes: { value: SalaryEntryMode; label: string }[] = [
    { value: 'percent', label: t.salary.entryModePercent },
    { value: 'kr', label: t.salary.entryModeKr },
    { value: 'total', label: t.salary.entryModeTotal },
  ];

  const handleSave = () => {
    if (!isValidYearMonth(effectiveDate)) { setError(t.salaryPage.errInvalidDateMonth); return; }
    if (newGross == null || newGross < 0) { setError(t.salaryPage.errSalaryPositive); return; }
    onSubmit(
      { jobId, effectiveDate, grossAnnual: newGross, changeType, notes: notes.trim() || undefined },
      existing?.id,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSave(); };

  return (
    <ModalShell
      title={existing ? t.salary.salaries : t.salary.recordEvent}
      onClose={onClose}
      closeLabel={t.cancel}
      icon={<TrendingUp size={16} className="text-[var(--text-2)]" />}
      panelClassName="sm:min-w-[360px] sm:max-w-sm space-y-5"
      initialFocus={firstInputRef}
      footer={
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity"
          >
            {t.save}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="se-effective" className={labelClass}>{t.salary.effectiveDate}</label>
          <input
            id="se-effective"
            ref={firstInputRef}
            type="text"
            value={effectiveDate}
            placeholder="2024-04"
            onChange={(e) => setEffectiveDate(e.target.value)}
            onKeyDown={onKeyDown}
            className={inputMono}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="se-type" className={labelClass}>{t.salary.changeType}</label>
          <select
            id="se-type"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as SalaryChangeType)}
            className={inputBase}
          >
            {changeTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {jobs.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="se-job" className={labelClass}>{t.salary.job}</label>
            <select
              id="se-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className={inputBase}
            >
              {jobs.map(j => <option key={j.id} value={j.id}>{`${j.employer} — ${j.role}`}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <div className={labelClass}>{amountLabel}</div>
          <div className="flex gap-2">
            <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden shrink-0">
              {modes.map(m => {
                const disabled = !hasPrev && m.value !== 'total';
                const active = effectiveMode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMode(m.value)}
                    className="px-3 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: active ? 'var(--accent-bg)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-2)',
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onKeyDown}
              className={inputMono}
            />
          </div>
          {!hasPrev && isValidYearMonth(effectiveDate) && (
            <p className="text-[11px] leading-snug text-[var(--text-2)] normal-case tracking-normal">
              {t.salary.noPriorSalaryHint}
            </p>
          )}
        </div>

        {newGross != null && (
          <div className="flex items-baseline justify-between px-4 py-3 rounded-[6px] bg-[var(--bg-raised)] border border-[var(--border)]">
            <span className={labelClass}>{t.salary.computedNewSalary}</span>
            <span className="text-[14px] font-mono font-semibold text-[var(--text-1)]">
              {formatCurrency(newGross)}
              {effectiveMode !== 'total' && hasPrev && (
                <span className="ml-2 text-[11px] font-normal text-[var(--text-2)]">
                  ({t.salary.wasPrefix} {formatCurrency(prevGross)})
                </span>
              )}
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="se-notes" className={labelClass}>{t.salary.notes}</label>
          <input
            id="se-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={onKeyDown}
            className={inputMono}
          />
        </div>

        {error && <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>}
      </div>
    </ModalShell>
  );
}
