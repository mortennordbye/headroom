import React, { useMemo, useState, lazy, Suspense } from 'react';
import {
  TrendingUp,
  Briefcase,
  Gift,
  Clock,
  Timer,
  Edit2,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  useFinance,
  type SalaryEntry,
  type JobEntry,
  type BonusEntry,
  type OvertimeEntry,
  type HoursSnapshot,
  type SalaryChangeType,
  type BonusType,
} from '../context/FinanceContext';
import type { Translations } from '../i18n/translations';
import EditModal, { type ModalField } from '../components/EditModal';
import ConfirmModal from '../components/ConfirmModal';
import ChartTooltip from '../components/ChartTooltip';
import { calcTaxByRegion } from '../lib/norwegianTax';
import { monthKeyFromDate, addMonthsKey, monthsBetween, yearOf } from '../lib/date';
import { salaryAt, hoursAt } from '../lib/salary';
import { isValidYearMonth, isValidYearMonthDay, isOptionalYearMonth, isPositiveNumber, isNonEmpty, parseLocaleNumber } from '../lib/validators';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

const TaxBreakdownChart = lazy(() => import('../components/charts/TaxBreakdownChart'));
const MoneyFlowSankey = lazy(() => import('../components/charts/MoneyFlowSankey'));

const WEEKS_PER_MONTH = 4.345;

const CHANGE_TYPE_COLOR: Record<SalaryChangeType, string> = {
  initial: '#5F6555',
  raise: 'var(--positive)',
  promotion: 'var(--violet)',
  job_change: 'var(--accent)',
  adjustment: 'var(--warning)',
};

// ── Page ───────────────────────────────────────────────────────────

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
}

interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}

const SalaryPage: React.FC = () => {
  const {
    t,
    formatCurrency,
    jobs, addJob, updateJob, removeJob,
    salaries, addSalary, updateSalary, removeSalary,
    bonuses, addBonus, updateBonus, removeBonus,
    overtime, addOvertime, updateOvertime, removeOvertime,
    hoursSnapshots, addHoursSnapshot, updateHoursSnapshot, removeHoursSnapshot,
    inflation, inflationStale,
    wageStats,
    region, customTaxRatePct, pension,
  } = useFinance();
  const isGeneric = region === 'generic';

  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  const [activeJobFilter, setActiveJobFilter] = useState<string>('all');

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);
  const openConfirm = (config: ConfirmConfig) => setConfirm(config);
  const closeConfirm = () => setConfirm(null);

  const sortedSalaries = useMemo(
    () => [...salaries].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [salaries]
  );

  const currentMonthKey = monthKeyFromDate(new Date());

  // ── Build a monthly series from first salary to current month ───
  type Point = {
    month: string;
    grossAnnual: number;        // base salary only
    totalAnnual: number;        // base + on-call (what affects the paycheck)
    monthlyGross: number;
    onCallMonthly: number;
    hoursPerWeek: number;
    nominalHourly: number;
    realHourly: number | null;
    cpiIndex: number | null;
  };

  const jobsById = useMemo(() => {
    const m = new Map<string, JobEntry>();
    jobs.forEach(j => m.set(j.id, j));
    return m;
  }, [jobs]);

  const cpiByMonth = useMemo(() => {
    const m = new Map<string, number>();
    inflation.forEach(p => m.set(p.month, p.cpiIndex));
    return m;
  }, [inflation]);

  const series: Point[] = useMemo(() => {
    if (sortedSalaries.length === 0) return [];
    const startMonth = sortedSalaries[0].effectiveDate;
    const endMonth = currentMonthKey > startMonth ? currentMonthKey : startMonth;
    const baseCpi = cpiByMonth.get(startMonth) ?? null;

    return monthsBetween(startMonth, endMonth).map(month => {
      const salary = salaryAt(month, sortedSalaries);
      const grossAnnual = salary?.grossAnnual ?? 0;
      const hours = hoursAt(month, hoursSnapshots, jobs, salary);
      const monthlyGross = grossAnnual / 12;
      const job = salary ? jobsById.get(salary.jobId) : undefined;
      const onCallAnnual = job?.onCallAnnual ?? 0;
      const onCallMonthly = onCallAnnual / 12;
      const totalAnnual = grossAnnual + onCallAnnual;
      // Nominal hourly uses total earnings — on-call is regular pay for the hours worked.
      const nominalHourly = hours > 0 ? (monthlyGross + onCallMonthly) / (WEEKS_PER_MONTH * hours) : 0;
      const cpi = cpiByMonth.get(month) ?? null;
      const realHourly = cpi && baseCpi ? nominalHourly * (baseCpi / cpi) : null;
      return { month, grossAnnual, totalAnnual, monthlyGross, onCallMonthly, hoursPerWeek: hours, nominalHourly, realHourly, cpiIndex: cpi };
    });
  }, [sortedSalaries, cpiByMonth, hoursSnapshots, jobs, jobsById, currentMonthKey]);

  // ── Summary metrics ────────────────────────────────────────────
  const current = series.length > 0 ? series[series.length - 1] : null;
  const first = series.length > 0 ? series[0] : null;

  const cumulativeGrowthPct =
    first && current && first.totalAnnual > 0
      ? ((current.totalAnnual / first.totalAnnual) - 1) * 100
      : 0;

  // YoY: compare current month to 12 months ago (total comp including on-call).
  // Null with under 13 months of history — a fabricated +0.0% would read as a
  // confident "flat vs inflation" to a new user.
  const yoy = useMemo(() => {
    if (series.length < 13) return null;
    const last = series[series.length - 1];
    const prior = series[series.length - 13];
    const salaryPct = prior.totalAnnual > 0
      ? ((last.totalAnnual / prior.totalAnnual) - 1) * 100
      : 0;
    const cpiPct = prior.cpiIndex && last.cpiIndex
      ? ((last.cpiIndex / prior.cpiIndex) - 1) * 100
      : 0;
    return { salary: salaryPct, cpi: cpiPct };
  }, [series]);

  // Effective hourly including bonus + overtime + on-call over trailing 12 months
  const trailingHourly = useMemo(() => {
    if (!current) return 0;
    const fromMonth = addMonthsKey(current.month, -11);
    const window = series.filter(p => p.month >= fromMonth);
    if (window.length === 0) return 0;
    const baseGross = window.reduce((s, p) => s + p.monthlyGross, 0);
    const onCallGross = window.reduce((s, p) => s + p.onCallMonthly, 0);
    const bonusGross = bonuses
      .filter(b => b.date.slice(0, 7) >= fromMonth && b.date.slice(0, 7) <= current.month)
      .reduce((s, b) => s + b.amount, 0);
    const otGross = overtime
      .filter(o => o.date.slice(0, 7) >= fromMonth && o.date.slice(0, 7) <= current.month)
      .reduce((s, o) => s + o.amount, 0);
    const otHours = overtime
      .filter(o => o.date.slice(0, 7) >= fromMonth && o.date.slice(0, 7) <= current.month)
      .reduce((s, o) => s + o.hours, 0);
    const totalGross = baseGross + onCallGross + bonusGross + otGross;
    const totalHours = window.reduce((s, p) => s + WEEKS_PER_MONTH * p.hoursPerWeek, 0) + otHours;
    return totalHours > 0 ? totalGross / totalHours : 0;
  }, [current, series, bonuses, overtime]);

  // ── Chart data: YoY bars per year ──────────────────────────────
  // Compute annual averages, then YoY between consecutive years.
  const yoyByYear = useMemo(() => {
    type Acc = { grossSum: number; grossN: number; cpiSum: number; cpiN: number };
    const byYear = new Map<number, Acc>();
    series.forEach(p => {
      const y = yearOf(p.month);
      if (!byYear.has(y)) byYear.set(y, { grossSum: 0, grossN: 0, cpiSum: 0, cpiN: 0 });
      const acc = byYear.get(y)!;
      acc.grossSum += p.totalAnnual;
      acc.grossN += 1;
      if (p.cpiIndex != null) {
        acc.cpiSum += p.cpiIndex;
        acc.cpiN += 1;
      }
    });
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const out: { year: number; salaryPct: number; cpiPct: number; gap: number }[] = [];
    for (const y of years) {
      const cur = byYear.get(y)!;
      const prev = byYear.get(y - 1);
      if (!prev || prev.grossN === 0 || cur.grossN === 0) continue;
      const curAvg = cur.grossSum / cur.grossN;
      const prevAvg = prev.grossSum / prev.grossN;
      const salaryPct = ((curAvg / prevAvg) - 1) * 100;
      const cpiPct = (prev.cpiN > 0 && cur.cpiN > 0)
        ? (((cur.cpiSum / cur.cpiN) / (prev.cpiSum / prev.cpiN)) - 1) * 100
        : 0;
      out.push({
        year: y,
        salaryPct: Number(salaryPct.toFixed(1)),
        cpiPct: Number(cpiPct.toFixed(1)),
        gap: Number((salaryPct - cpiPct).toFixed(1)),
      });
    }
    return out;
  }, [series]);

  // ── Total comp by year ─────────────────────────────────────────
  const compByYear = useMemo(() => {
    type Row = { year: number; base: number; onCall: number; bonus: number; overtime: number };
    const map = new Map<number, Row>();
    const ensure = (y: number): Row => {
      if (!map.has(y)) map.set(y, { year: y, base: 0, onCall: 0, bonus: 0, overtime: 0 });
      return map.get(y)!;
    };
    series.forEach(p => {
      const row = ensure(yearOf(p.month));
      row.base += p.monthlyGross;
      row.onCall += p.onCallMonthly;
    });
    bonuses.forEach(b => { ensure(yearOf(b.date)).bonus += b.amount; });
    overtime.forEach(o => { ensure(yearOf(o.date)).overtime += o.amount; });
    return Array.from(map.values())
      .sort((a, b) => a.year - b.year)
      .map(r => ({ ...r, total: r.base + r.onCall + r.bonus + r.overtime }));
  }, [series, bonuses, overtime]);

  // ── Next-review context: current baseline + CPI baselines ──────
  // The "baseline" is whatever currently sets your salary: a recent raise,
  // a promotion, or — after a job change — the starting salary of the new
  // role. Anything else would compare today's CPI against an old employer.
  const reviewContext = useMemo(() => {
    // The salary in effect today, not the last entry — a future-dated raise
    // isn't setting your pay yet and would skew the CPI-since-baseline maths.
    const lastRaise = salaryAt(currentMonthKey, sortedSalaries);
    if (!lastRaise) return null;

    const nowMonth = currentMonthKey;
    const [ry, rm] = lastRaise.effectiveDate.split('-').map(Number);
    const [ny, nm] = nowMonth.split('-').map(Number);
    const monthsSince = (ny - ry) * 12 + (nm - rm);

    const cpiThen = cpiByMonth.get(lastRaise.effectiveDate) ?? null;
    // Pick the latest CPI point we have (CPI publishes with a lag).
    let cpiNow: number | null = null;
    let cpiNowMonth: string | null = null;
    for (const p of inflation) {
      if (!cpiNowMonth || p.month > cpiNowMonth) {
        cpiNowMonth = p.month;
        cpiNow = p.cpiIndex;
      }
    }
    const cpiSincePct = (cpiThen != null && cpiNow != null && cpiThen > 0)
      ? ((cpiNow / cpiThen) - 1) * 100
      : null;

    // Rolling 12-month CPI from latest CPI point.
    let cpiRolling12Pct: number | null = null;
    if (cpiNowMonth && cpiNow != null) {
      const priorMonth = addMonthsKey(cpiNowMonth, -12);
      const priorCpi = cpiByMonth.get(priorMonth);
      if (priorCpi && priorCpi > 0) {
        cpiRolling12Pct = ((cpiNow / priorCpi) - 1) * 100;
      }
    }

    const inflationOnlySalary = cpiSincePct != null
      ? lastRaise.grossAnnual * (1 + cpiSincePct / 100)
      : null;

    return {
      lastRaise,
      monthsSince,
      cpiSincePct,
      cpiRolling12Pct,
      cpiAsOf: cpiNowMonth,
      inflationOnlySalary,
    };
  }, [sortedSalaries, cpiByMonth, inflation, currentMonthKey]);

  // ── Per-entry % chips: salary vs prior entry, with CPI gap ─────
  const salaryChipsById = useMemo(() => {
    const out = new Map<string, { pct: number; cpiPct: number | null; gap: number | null }>();
    // Build per-job ordered lists; chips are job-scoped so a job_change doesn't show a misleading delta.
    const byJob = new Map<string, SalaryEntry[]>();
    sortedSalaries.forEach(s => {
      const list = byJob.get(s.jobId) ?? [];
      list.push(s);
      byJob.set(s.jobId, list);
    });
    byJob.forEach(list => {
      for (let i = 1; i < list.length; i++) {
        const cur = list[i];
        const prev = list[i - 1];
        if (cur.changeType === 'initial' || cur.changeType === 'job_change') continue;
        if (prev.grossAnnual <= 0) continue;
        const pct = ((cur.grossAnnual / prev.grossAnnual) - 1) * 100;
        const cpiCur = cpiByMonth.get(cur.effectiveDate);
        const cpiPrev = cpiByMonth.get(prev.effectiveDate);
        const cpiPct = (cpiCur && cpiPrev && cpiPrev > 0)
          ? ((cpiCur / cpiPrev) - 1) * 100
          : null;
        const gap = cpiPct != null ? pct - cpiPct : null;
        out.set(cur.id, { pct, cpiPct, gap });
      }
    });
    return out;
  }, [sortedSalaries, cpiByMonth]);

  // ── Salary timeline data for Recharts step line ────────────────
  // Augment each sampled point with whether a salary change took effect there,
  // so we can color those dots and draw labels for the event.
  const wageByYear = useMemo(() => {
    const m = new Map<number, number>();
    wageStats.forEach(w => m.set(w.year, w.median));
    return m;
  }, [wageStats]);

  const salaryTimeline = useMemo(() => {
    const changeByMonth = new Map<string, SalaryChangeType>();
    sortedSalaries.forEach(s => changeByMonth.set(s.effectiveDate, s.changeType));
    return series
      .filter((_, i, arr) => i === 0 || i === arr.length - 1 || i % 3 === 0 || changeByMonth.has(arr[i].month))
      .map(p => ({
        month: p.month,
        gross: Math.round(p.totalAnnual),
        median: wageByYear.get(yearOf(p.month)) ?? null,
        changeType: changeByMonth.get(p.month) ?? null,
      }));
  }, [series, sortedSalaries, wageByYear]);

  // Vertical lines for job changes
  const jobChangeMonths = useMemo(() => {
    return sortedSalaries
      .filter(s => s.changeType === 'job_change')
      .map(s => ({ month: s.effectiveDate, employer: jobs.find(j => j.id === s.jobId)?.employer ?? '' }));
  }, [sortedSalaries, jobs]);

  // ── Hours vs effective hourly per year ─────────────────────────
  // Normalize by *actual* months of data in the year so partial years
  // (current year, first job year) don't artificially deflate hourly rate.
  const hoursVsHourly = useMemo(() => {
    return compByYear.map(y => {
      const yearMonths = series.filter(p => yearOf(p.month) === y.year);
      const avgHours = yearMonths.length > 0
        ? yearMonths.reduce((s, p) => s + p.hoursPerWeek, 0) / yearMonths.length
        : 0;
      const totalGross = y.base + y.onCall + y.bonus + y.overtime;
      // Each month ≈ 4.345 weeks; only count months we actually have data for.
      const totalActualHours = avgHours * WEEKS_PER_MONTH * yearMonths.length;
      const hourly = totalActualHours > 0 ? totalGross / totalActualHours : 0;
      return { year: y.year, hoursPerWeek: Number(avgHours.toFixed(1)), hourly: Math.round(hourly) };
    });
  }, [compByYear, series]);

  // ── CRUD handlers ──────────────────────────────────────────────

  const openJobModal = (existing?: JobEntry) => {
    const employerSuggestions = Array.from(
      new Set(jobs.map(j => j.employer.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const roleSuggestions = Array.from(
      new Set(jobs.map(j => j.role.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const fields: ModalField[] = [
      { key: 'employer', label: t.salary.employer, type: 'text', value: existing?.employer ?? '', suggestions: employerSuggestions },
      { key: 'role', label: t.salary.role, type: 'text', value: existing?.role ?? '', suggestions: roleSuggestions },
      { key: 'startDate', label: t.salary.startDate, type: 'text', value: existing?.startDate ?? '', placeholder: '2023-08' },
      { key: 'endDate', label: t.salary.endDate, type: 'text', value: existing?.endDate ?? '', placeholder: '2024-09' },
      { key: 'contractedHoursPerWeek', label: t.salary.contractedHours, type: 'number', value: (existing?.contractedHoursPerWeek ?? 37.5).toString() },
      { key: 'onCallAnnual', label: t.salary.onCallAnnual, type: 'number', value: (existing?.onCallAnnual ?? '').toString(), placeholder: '0' },
    ];
    if (!existing) {
      fields.push({ key: 'initialSalary', label: t.salary.initialSalary, type: 'number', value: '', placeholder: '600000' });
    }

    openModal({
      title: existing ? `${t.salary.jobs}: ${existing.employer}` : t.salary.addJob,
      fields,
      onSave: (vals) => {
        if (!isNonEmpty(vals.employer)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errEmployerRequired });
          return;
        }
        if (!isValidYearMonth(vals.startDate)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidStartDate });
          return;
        }
        if (!isOptionalYearMonth(vals.endDate)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidEndDate });
          return;
        }
        if (!isPositiveNumber(vals.contractedHoursPerWeek)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errHoursPositive });
          return;
        }
        const onCallRaw = vals.onCallAnnual?.trim() ?? '';
        const onCallNum = onCallRaw === '' ? null : parseLocaleNumber(onCallRaw);
        if (onCallNum !== null && (isNaN(onCallNum) || onCallNum < 0)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errOnCallPositive });
          return;
        }
        const initialSalaryRaw = vals.initialSalary?.trim() ?? '';
        let initialSalaryNum: number | null = null;
        if (!existing && initialSalaryRaw !== '') {
          const parsed = parseLocaleNumber(initialSalaryRaw);
          if (isNaN(parsed) || parsed <= 0) {
            setModal(prev => prev && { ...prev, error: t.salaryPage.errInitialSalaryPositive });
            return;
          }
          initialSalaryNum = parsed;
        }
        const payload = {
          employer: vals.employer.trim(),
          role: vals.role.trim(),
          startDate: vals.startDate,
          endDate: isValidYearMonth(vals.endDate) ? vals.endDate : null,
          contractedHoursPerWeek: parseLocaleNumber(vals.contractedHoursPerWeek),
          onCallAnnual: onCallNum,
        };
        if (existing) {
          updateJob(existing.id, payload);
        } else {
          const newJobId = addJob(payload);
          if (initialSalaryNum !== null) {
            addSalary({
              jobId: newJobId,
              effectiveDate: vals.startDate,
              grossAnnual: initialSalaryNum,
              changeType: 'initial' as SalaryChangeType,
            });
          }
        }
        closeModal();
      },
    });
  };

  const openSalaryModal = (existing?: SalaryEntry) => {
    if (jobs.length === 0) {
      openModal({
        title: t.salary.addSalary,
        fields: [{ key: 'msg', label: t.salary.noJobsHint, type: 'text', value: '' }],
        onSave: () => closeModal(),
      });
      return;
    }
    const changeTypes: { value: SalaryChangeType; label: string }[] = [
      { value: 'initial', label: t.salary.changeTypeInitial },
      { value: 'raise', label: t.salary.changeTypeRaise },
      { value: 'promotion', label: t.salary.changeTypePromotion },
      { value: 'job_change', label: t.salary.changeTypeJobChange },
      { value: 'adjustment', label: t.salary.changeTypeAdjustment },
    ];
    openModal({
      title: existing ? t.salary.salaries : t.salary.addSalary,
      fields: [
        {
          key: 'jobId',
          label: t.salary.job,
          type: 'select',
          value: existing?.jobId ?? jobs[jobs.length - 1].id,
          options: jobs.map(j => ({ value: j.id, label: `${j.employer} — ${j.role}` })),
        },
        { key: 'effectiveDate', label: t.salary.effectiveDate, type: 'text', value: existing?.effectiveDate ?? '', placeholder: '2024-04' },
        { key: 'grossAnnual', label: t.salary.grossAnnual, type: 'number', value: (existing?.grossAnnual ?? 0).toString() },
        {
          key: 'changeType',
          label: t.salary.changeType,
          type: 'select',
          value: existing?.changeType ?? 'raise',
          options: changeTypes,
        },
        { key: 'notes', label: t.salary.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isValidYearMonth(vals.effectiveDate)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidDateMonth });
          return;
        }
        if (!isPositiveNumber(vals.grossAnnual)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errSalaryPositive });
          return;
        }
        const payload = {
          jobId: vals.jobId,
          effectiveDate: vals.effectiveDate,
          grossAnnual: parseLocaleNumber(vals.grossAnnual),
          changeType: vals.changeType as SalaryChangeType,
          notes: vals.notes.trim() || undefined,
        };
        if (existing) {
          updateSalary(existing.id, payload);
        } else {
          addSalary(payload);
        }
        closeModal();
      },
    });
  };

  const defaultJobIdForNewEntry = (): string =>
    activeJobFilter !== 'all' ? activeJobFilter : (jobs[jobs.length - 1]?.id ?? '');
  const jobSelectOptions = () => jobs.map(j => ({ value: j.id, label: `${j.employer} — ${j.role}` }));
  const budgetToggleOptions = () => [
    { value: 'no', label: t.salary.includeInBudgetNo },
    { value: 'yes', label: t.salary.includeInBudgetYes },
  ];

  const openBonusModal = (existing?: BonusEntry) => {
    if (jobs.length === 0) {
      openModal({
        title: t.salary.addBonus,
        fields: [{ key: 'msg', label: t.salary.noJobsHint, type: 'text', value: '' }],
        onSave: () => closeModal(),
      });
      return;
    }
    const bonusTypes: { value: BonusType; label: string }[] = [
      { value: 'annual', label: t.salary.bonusTypeAnnual },
      { value: 'performance', label: t.salary.bonusTypePerformance },
      { value: 'signing', label: t.salary.bonusTypeSigning },
      { value: 'holiday_pay', label: t.salary.bonusTypeHolidayPay },
      { value: 'profit_share', label: t.salary.bonusTypeProfitShare },
      { value: 'other', label: t.salary.bonusTypeOther },
    ];
    openModal({
      title: existing ? t.salary.bonuses : t.salary.addBonus,
      fields: [
        { key: 'jobId', label: t.salary.job, type: 'select', value: existing?.jobId ?? defaultJobIdForNewEntry(), options: jobSelectOptions() },
        { key: 'date', label: t.salary.bonusDate, type: 'text', value: existing?.date ?? '', placeholder: '2024-06-15' },
        { key: 'amount', label: t.salary.bonusAmount, type: 'number', value: (existing?.amount ?? 0).toString() },
        { key: 'type', label: t.salary.bonusType, type: 'select', value: existing?.type ?? 'annual', options: bonusTypes },
        { key: 'includeInBudget', label: t.salary.includeInBudget, type: 'select', value: existing?.includeInBudget ? 'yes' : 'no', options: budgetToggleOptions() },
        { key: 'notes', label: t.salary.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isValidYearMonthDay(vals.date)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidDateDay });
          return;
        }
        if (!isPositiveNumber(vals.amount)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errAmountPositive });
          return;
        }
        const payload = {
          jobId: vals.jobId || undefined,
          date: vals.date,
          amount: parseLocaleNumber(vals.amount),
          type: vals.type as BonusType,
          includeInBudget: vals.includeInBudget === 'yes' || undefined,
          notes: vals.notes.trim() || undefined,
        };
        if (existing) updateBonus(existing.id, payload);
        else addBonus(payload);
        closeModal();
      },
    });
  };

  const openOvertimeModal = (existing?: OvertimeEntry) => {
    if (jobs.length === 0) {
      openModal({
        title: t.salary.addOvertime,
        fields: [{ key: 'msg', label: t.salary.noJobsHint, type: 'text', value: '' }],
        onSave: () => closeModal(),
      });
      return;
    }
    openModal({
      title: existing ? t.salary.overtime : t.salary.addOvertime,
      fields: [
        { key: 'jobId', label: t.salary.job, type: 'select', value: existing?.jobId ?? defaultJobIdForNewEntry(), options: jobSelectOptions() },
        { key: 'date', label: t.salary.overtimeDate, type: 'text', value: existing?.date ?? '', placeholder: '2024-06-15' },
        { key: 'hours', label: t.salary.overtimeHours, type: 'number', value: (existing?.hours ?? 0).toString() },
        { key: 'amount', label: t.salary.overtimeAmount, type: 'number', value: (existing?.amount ?? 0).toString() },
        { key: 'includeInBudget', label: t.salary.includeInBudget, type: 'select', value: existing?.includeInBudget ? 'yes' : 'no', options: budgetToggleOptions() },
        { key: 'notes', label: t.salary.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isValidYearMonthDay(vals.date)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidDateDay });
          return;
        }
        if (!isPositiveNumber(vals.hours) || !isPositiveNumber(vals.amount)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errHoursAmountPositive });
          return;
        }
        const payload = {
          jobId: vals.jobId || undefined,
          date: vals.date,
          hours: parseLocaleNumber(vals.hours),
          amount: parseLocaleNumber(vals.amount),
          includeInBudget: vals.includeInBudget === 'yes' || undefined,
          notes: vals.notes.trim() || undefined,
        };
        if (existing) updateOvertime(existing.id, payload);
        else addOvertime(payload);
        closeModal();
      },
    });
  };

  const openHoursModal = (existing?: HoursSnapshot) => {
    if (jobs.length === 0) {
      openModal({
        title: t.salary.addHoursSnapshot,
        fields: [{ key: 'msg', label: t.salary.noJobsHint, type: 'text', value: '' }],
        onSave: () => closeModal(),
      });
      return;
    }
    openModal({
      title: existing ? t.salary.hoursSnapshots : t.salary.addHoursSnapshot,
      fields: [
        { key: 'jobId', label: t.salary.job, type: 'select', value: existing?.jobId ?? defaultJobIdForNewEntry(), options: jobSelectOptions() },
        { key: 'periodMonth', label: t.salary.periodMonth, type: 'text', value: existing?.periodMonth ?? '', placeholder: '2024-06' },
        { key: 'actualHoursPerWeek', label: t.salary.actualHours, type: 'number', value: (existing?.actualHoursPerWeek ?? 37.5).toString() },
        { key: 'notes', label: t.salary.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isValidYearMonth(vals.periodMonth)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errInvalidMonth });
          return;
        }
        if (!isPositiveNumber(vals.actualHoursPerWeek)) {
          setModal(prev => prev && { ...prev, error: t.salaryPage.errHoursPositiveShort });
          return;
        }
        const payload = {
          jobId: vals.jobId || undefined,
          periodMonth: vals.periodMonth,
          actualHoursPerWeek: parseLocaleNumber(vals.actualHoursPerWeek),
          notes: vals.notes.trim() || undefined,
        };
        if (existing) updateHoursSnapshot(existing.id, payload);
        else addHoursSnapshot(payload);
        closeModal();
      },
    });
  };

  const confirmDelete = (label: string, onConfirm: () => void) => {
    openConfirm({
      title: t.confirmDelete,
      message: `${t.delete}: ${label}?`,
      confirmLabel: t.delete,
      cancelLabel: t.cancel,
      danger: true,
      onConfirm: () => { onConfirm(); closeConfirm(); },
    });
  };

  // ── Render ─────────────────────────────────────────────────────

  const formatAxisInt = (val: number) => {
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
    return val.toString();
  };

  // Clamp to the salary in effect *today* — the last entry may be a
  // future-dated raise, and the headline (`current`) is already clamped.
  const activeSalary = salaryAt(currentMonthKey, sortedSalaries);
  const currentJob = activeSalary ? jobsById.get(activeSalary.jobId) : undefined;
  const currentOnCallAnnual = currentJob?.onCallAnnual ?? 0;

  const yoyChip = yoy ? yoy.salary - yoy.cpi : null;
  const chipColor = yoyChip != null && yoyChip >= 0 ? 'var(--positive)' : 'var(--negative)';
  const chipBg = yoyChip != null && yoyChip >= 0 ? 'var(--positive-bg)' : 'var(--negative-bg)';

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.salary.heroLabel}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.salary.heroTitlePre}{' '}
          <em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.salary.heroTitleEm}</em>.
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {isGeneric
            ? t.salaryPage.genericSubtitle
            : t.salary.subtitle}
        </p>
        {inflationStale && (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--warning)' }}>
            {t.salary.inflationOffline}
          </p>
        )}
      </header>

      {/* Summary tiles */}
      <div data-tour="salary-overview" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile
          label={t.salary.currentSalary}
          value={current ? formatCurrency(current.totalAnnual) : '—'}
          sub={current ? (
            currentOnCallAnnual > 0
              ? `${formatCurrency(current.grossAnnual)} ${t.salaryPage.baseSuffix} + ${formatCurrency(currentOnCallAnnual)} ${t.salary.onCallShort} · ${formatCurrency(calcTaxByRegion(current.totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution).netMonthly)} ${t.salaryPage.netPerMonth}`
              : `${formatCurrency(calcTaxByRegion(current.totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution).netMonthly)} ${t.salaryPage.netPerMonth}`
          ) : ''}
          chip={(() => {
            if (!current) return undefined;
            // Fall back to most recent wage stat if current year is missing.
            const currentYear = yearOf(current.month);
            const median = wageByYear.get(currentYear)
              ?? (wageStats.length > 0 ? wageStats[wageStats.length - 1].median : null);
            if (!median) return undefined;
            const pct = ((current.totalAnnual / median) - 1) * 100;
            const positive = pct >= 0;
            return (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{
                  color: positive ? 'var(--positive)' : 'var(--negative)',
                  background: positive ? 'var(--positive-bg)' : 'var(--negative-bg)',
                }}
              >
                {positive ? '+' : ''}{pct.toFixed(0)}% {t.salary.vsNationalMedian}
              </span>
            );
          })()}
        />
        <SummaryTile
          label={t.salary.cumulativeGrowth}
          value={`${cumulativeGrowthPct >= 0 ? '+' : ''}${cumulativeGrowthPct.toFixed(1)}%`}
          sub={first ? `${t.salary.growthSinceFirst} ${first.month}` : ''}
          color={cumulativeGrowthPct >= 0 ? 'var(--positive)' : 'var(--negative)'}
        />
        {isGeneric ? (
          <SummaryTile
            label={t.salaryPage.yoySalary}
            value={yoy ? `${yoy.salary >= 0 ? '+' : ''}${yoy.salary.toFixed(1)}%` : '—'}
            sub={first ? `${t.salary.growthSinceFirst} ${first.month}` : ''}
            color={yoy && yoy.salary >= 0 ? 'var(--positive)' : yoy ? 'var(--negative)' : undefined}
          />
        ) : (
          <SummaryTile
            label={t.salary.yoyVsInflation}
            value={yoy ? `${yoy.salary >= 0 ? '+' : ''}${yoy.salary.toFixed(1)}%` : '—'}
            sub={yoy ? `KPI ${yoy.cpi >= 0 ? '+' : ''}${yoy.cpi.toFixed(1)}%` : ''}
            chip={yoyChip != null ? (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{ color: chipColor, background: chipBg }}
              >
                {yoyChip >= 0 ? '+' : ''}{yoyChip.toFixed(1)}pp · {yoyChip >= 0 ? t.salary.beatsCpi : t.salary.losesCpi}
              </span>
            ) : undefined}
          />
        )}
        <SummaryTile
          label={t.salary.effectiveHourly}
          value={current ? formatCurrency(trailingHourly) : '—'}
          sub={current ? `${current.hoursPerWeek.toFixed(1)} t/uke` : ''}
        />
      </div>

      {/* Tax breakdown + money flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <div className={`${card} p-5 md:p-7`}>
          <div className="pb-4 mb-2 border-b border-[var(--border)]">
            <h3 className={sectionLabel}>{t.charts.taxBreakdownTitle}</h3>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.taxBreakdownSub}</p>
          </div>
          <div className="h-[260px] w-full">
            <Suspense fallback={<div className="h-full w-full" />}><TaxBreakdownChart /></Suspense>
          </div>
        </div>
        <div className={`${card} p-5 md:p-7`}>
          <div className="pb-4 mb-2 border-b border-[var(--border)]">
            <h3 className={sectionLabel}>{t.charts.moneyFlowTitle}</h3>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.moneyFlowSub}</p>
          </div>
          <div className="h-[260px] w-full">
            <Suspense fallback={<div className="h-full w-full" />}><MoneyFlowSankey /></Suspense>
          </div>
        </div>
      </div>

      {/* Next salary review — forward-looking helper for negotiation moments. */}
      {!isGeneric && reviewContext && (
        <NextReviewCard
          ctx={reviewContext}
          t={t}
          formatCurrency={formatCurrency}
        />
      )}

      {/* Hero chart: real hourly rate — hidden in generic region (no CPI source). */}
      {!isGeneric && (
        <div className={`${card} p-5 md:p-7 space-y-4`}>
          <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
            <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <h3 className={sectionLabel}>{t.salary.realHourlyRate}</h3>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.realHourlyRateDesc}</p>
          <RealHourlyChart series={series} formatCurrency={formatCurrency} t={t} />
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.salary.inflationSource}</p>
        </div>
      )}

      {/* Salary timeline */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Briefcase size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.salary.salaryTimeline}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.salaryTimelineDesc}</p>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salaryTimeline} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salaryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0.12} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<ChartTooltip />} />
              {jobChangeMonths.map(jc => (
                <ReferenceLine
                  key={jc.month}
                  x={jc.month}
                  stroke="var(--violet)"
                  strokeDasharray="3 3"
                  label={{
                    value: jc.employer,
                    position: 'insideTopRight',
                    fill: 'var(--violet)',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              ))}
              <Line
                type="monotone"
                dataKey="median"
                name={t.salary.nationalMedian}
                stroke="var(--text-3)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="stepAfter"
                dataKey="gross"
                name={t.salary.grossAnnual}
                stroke="var(--accent)"
                strokeWidth={2.5}
                fill="url(#salaryGradient)"
                activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                dot={(props) => {
                  const { cx, cy, payload, index } = props as {
                    cx: number; cy: number; payload: { changeType: SalaryChangeType | null }; index: number;
                  };
                  if (!payload.changeType) return <g key={`d-${index}`} />;
                  const color = CHANGE_TYPE_COLOR[payload.changeType];
                  return (
                    <g key={`d-${index}`}>
                      <circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.2} />
                      <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--bg-card)" strokeWidth={1.5} />
                    </g>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Legend for change-type dot colors */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px]" style={{ color: 'var(--text-2)' }}>
          {(['initial', 'raise', 'promotion', 'job_change', 'adjustment'] as SalaryChangeType[]).map(ct => (
            <div key={ct} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: CHANGE_TYPE_COLOR[ct] }} />
              {({
                initial: t.salary.changeTypeInitial,
                raise: t.salary.changeTypeRaise,
                promotion: t.salary.changeTypePromotion,
                job_change: t.salary.changeTypeJobChange,
                adjustment: t.salary.changeTypeAdjustment,
              } as Record<SalaryChangeType, string>)[ct]}
            </div>
          ))}
          {wageStats.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5" style={{ background: 'var(--text-3)' }} />
              {t.salary.nationalMedian}
            </div>
          )}
        </div>
      </div>

      {/* YoY vs inflation — hidden in generic region (no CPI source). */}
      {!isGeneric && (
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.salary.yoyChart}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.yoyChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yoyByYear} margin={{ top: 28, right: 12, left: 0, bottom: 0 }} barGap={4} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <ReferenceLine y={0} stroke="var(--text-3)" strokeWidth={1} />
              <Bar dataKey="salaryPct" name={t.salaryPage.salaryIncrease} fill="var(--accent)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="salaryPct" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--accent)' }} />
              </Bar>
              <Bar dataKey="cpiPct" name="KPI" fill="var(--violet)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="cpiPct" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--violet)' }} />
              </Bar>
              <Bar dataKey="gap" name={t.salaryPage.gap} radius={[4, 4, 0, 0]}>
                {yoyByYear.map((row) => (
                  <Cell key={row.year} fill={row.gap >= 0 ? 'var(--positive)' : 'var(--negative)'} />
                ))}
                <LabelList dataKey="gap" position="top" formatter={(v) => `${Number(v ?? 0) >= 0 ? '+' : ''}${Number(v ?? 0).toFixed(1)}pp`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-1)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Inline series legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{t.salaryPage.salaryIncrease}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--violet)' }} />KPI</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--positive)' }} />{t.salaryPage.beatsCpiLegend}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--negative)' }} />{t.salaryPage.belowCpi}</div>
        </div>

        {/* Numeric summary row */}
        {yoyByYear.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-t border-[var(--border)]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-2)' }}>
                  <th className="py-2 pr-3 font-medium uppercase tracking-wider text-[10px]">{t.salaryPage.year}</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wider text-[10px] text-right">{t.salaryPage.salaryCol}</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wider text-[10px] text-right">KPI</th>
                  <th className="py-2 pl-2 font-medium uppercase tracking-wider text-[10px] text-right">{t.salaryPage.gap}</th>
                </tr>
              </thead>
              <tbody>
                {yoyByYear.map(row => (
                  <tr key={row.year} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3 font-mono font-semibold text-[var(--text-1)]">{row.year}</td>
                    <td className="py-2 px-2 font-mono text-right" style={{ color: 'var(--accent)' }}>
                      {row.salaryPct >= 0 ? '+' : ''}{row.salaryPct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2 font-mono text-right" style={{ color: 'var(--violet)' }}>
                      {row.cpiPct >= 0 ? '+' : ''}{row.cpiPct.toFixed(1)}%
                    </td>
                    <td
                      className="py-2 pl-2 font-mono font-semibold text-right"
                      style={{ color: row.gap >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                    >
                      {row.gap >= 0 ? '+' : ''}{row.gap.toFixed(1)}pp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Total comp by year */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Gift size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.salary.totalCompChart}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.totalCompChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={compByYear} margin={{ top: 28, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
              <defs>
                <linearGradient id="compBaseGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F5A42" stopOpacity={1} />
                  <stop offset="100%" stopColor="#1F5A42" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compBonusGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3F7373" stopOpacity={1} />
                  <stop offset="100%" stopColor="#3F7373" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compOtGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5B7280" stopOpacity={1} />
                  <stop offset="100%" stopColor="#5B7280" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compOnCallGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7FCBA0" stopOpacity={1} />
                  <stop offset="100%" stopColor="#7FCBA0" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="base" stackId="a" name={t.salaryPage.baseSalary} fill="url(#compBaseGradient)" />
              <Bar dataKey="onCall" stackId="a" name={t.salary.onCallLabel} fill="url(#compOnCallGradient)" />
              <Bar dataKey="bonus" stackId="a" name={t.salary.bonuses} fill="url(#compBonusGradient)" />
              <Bar dataKey="overtime" stackId="a" name={t.salary.overtime} fill="url(#compOtGradient)" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="total" position="top" formatter={(v) => formatAxisInt(Number(v ?? 0))} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-1)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Inline legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#1F5A42' }} />{t.salaryPage.baseSalary}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#7FCBA0' }} />{t.salary.onCallLabel}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#3F7373' }} />{t.salary.bonuses}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#5B7280' }} />{t.salary.overtime}</div>
        </div>
      </div>

      {/* Hours vs effective hourly */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Clock size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.salary.hoursVsComp}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.hoursVsCompDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hoursVsHourly} margin={{ top: 28, right: 12, left: 0, bottom: 0 }} barCategoryGap="40%">
              <defs>
                <linearGradient id="hoursGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.85} /><stop offset="100%" stopColor="var(--warning)" stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tickFormatter={(v) => `${v}t`} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={40} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={56} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                content={<ChartTooltip valueFormatter={(v, e) => e?.dataKey === 'hoursPerWeek' ? `${v.toFixed(1)} t/uke` : formatCurrency(v)} />}
              />
              <Bar yAxisId="left" dataKey="hoursPerWeek" name={t.salaryPage.hoursPerWk} fill="url(#hoursGradient)" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="hoursPerWeek" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(0)}t`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--warning)' }} />
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="hourly"
                name={t.salary.effectiveHourly}
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--bg-card)', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList dataKey="hourly" position="top" formatter={(v) => formatAxisInt(Number(v ?? 0))} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--accent)' }} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--warning)' }} />{t.salaryPage.hoursPerWk}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)' }} />{t.salary.effectiveHourly}</div>
        </div>
      </div>

      {/* Jobber — source of truth, full width above the filter */}
      <EntryList
        title={t.salary.jobs}
        icon={<Briefcase size={14} className="text-[var(--text-2)]" />}
        onAdd={() => openJobModal()}
        empty={t.salary.noEntries}
        editLabel={t.edit}
        deleteLabel={t.delete}
        items={jobs.map(j => ({
          id: j.id,
          primary: `${j.employer} — ${j.role}`,
          secondary: `${j.startDate} → ${j.endDate ?? t.salaryPage.now} · ${j.contractedHoursPerWeek}t/uke`,
          chip: j.onCallAnnual && j.onCallAnnual > 0 ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold font-mono tabular-nums shrink-0"
              style={{ color: 'var(--positive)', background: 'var(--positive-bg)' }}
              title={t.salary.onCallAnnual}
            >
              {t.salary.onCallLabel} {formatCurrency(j.onCallAnnual)}/{t.salaryPage.yearAbbr}
            </span>
          ) : undefined,
          onEdit: () => openJobModal(j),
          onDelete: () => confirmDelete(j.employer, () => removeJob(j.id)),
        }))}
      />

      {/* Job filter tabs */}
      {jobs.length > 0 && (() => {
        const tabs: { id: string; label: string }[] = [
          { id: 'all', label: t.salary.allJobs },
          ...[...jobs]
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
            .map(j => ({ id: j.id, label: `${j.employer} — ${j.role}` })),
        ];
        return (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.salary.job}>
            {tabs.map(tab => {
              const active = activeJobFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveJobFilter(tab.id)}
                  className="px-3 h-8 rounded-[6px] text-[12px] font-semibold transition-colors border"
                  style={{
                    background: active ? 'var(--accent-bg)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Filtered entry lists */}
      {(() => {
        const showAll = activeJobFilter === 'all';
        const matchesFilter = (jobId: string | undefined) => showAll || jobId === activeJobFilter;
        const jobLabel = (jobId: string | undefined): string => {
          if (!jobId) return t.salary.unassigned;
          const j = jobsById.get(jobId);
          if (!j) return t.salary.unassigned;
          return j.role ? `${j.employer} — ${j.role}` : j.employer;
        };
        const jobSuffix = (jobId: string | undefined) =>
          showAll ? ` · ${jobLabel(jobId)}` : '';

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <EntryList
              title={t.salary.salaries}
              icon={<TrendingUp size={14} className="text-[var(--text-2)]" />}
              onAdd={() => openSalaryModal()}
              empty={t.salary.noEntries}
        editLabel={t.edit}
        deleteLabel={t.delete}
              items={[...sortedSalaries]
                .filter(s => matchesFilter(s.jobId))
                .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
                .map(s => {
                  const typeLabel = ({
                    initial: t.salary.changeTypeInitial,
                    raise: t.salary.changeTypeRaise,
                    promotion: t.salary.changeTypePromotion,
                    job_change: t.salary.changeTypeJobChange,
                    adjustment: t.salary.changeTypeAdjustment,
                  } as Record<SalaryChangeType, string>)[s.changeType];
                  const chipData = salaryChipsById.get(s.id);
                  const chip = chipData ? (() => {
                    const { pct, gap } = chipData;
                    const pctColor = pct >= 0 ? 'var(--positive)' : 'var(--negative)';
                    const pctBg = pct >= 0 ? 'var(--positive-bg)' : 'var(--negative-bg)';
                    return (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap"
                        style={{ color: pctColor, background: pctBg }}
                        title={gap != null ? `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}pp ${t.salary.vsCpi}` : undefined}
                      >
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                        {gap != null && (
                          <span style={{ color: gap >= 0 ? 'var(--positive)' : 'var(--warning)', opacity: 0.85 }}>
                            ({gap >= 0 ? '+' : ''}{gap.toFixed(1)} {t.salary.vsCpi})
                          </span>
                        )}
                      </span>
                    );
                  })() : undefined;
                  return {
                    id: s.id,
                    primary: `${formatCurrency(s.grossAnnual)} · ${typeLabel}`,
                    secondary: `${s.effectiveDate}${jobSuffix(s.jobId)}${s.notes ? ` · ${s.notes}` : ''}`,
                    chip,
                    onEdit: () => openSalaryModal(s),
                    onDelete: () => confirmDelete(s.effectiveDate, () => removeSalary(s.id)),
                  };
                })}
            />
            <EntryList
              title={t.salary.bonuses}
              icon={<Gift size={14} className="text-[var(--text-2)]" />}
              onAdd={() => openBonusModal()}
              empty={t.salary.noEntries}
        editLabel={t.edit}
        deleteLabel={t.delete}
              items={[...bonuses]
                .filter(b => matchesFilter(b.jobId))
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(b => {
                  const typeLabel = ({
                    annual: t.salary.bonusTypeAnnual,
                    performance: t.salary.bonusTypePerformance,
                    signing: t.salary.bonusTypeSigning,
                    holiday_pay: t.salary.bonusTypeHolidayPay,
                    profit_share: t.salary.bonusTypeProfitShare,
                    other: t.salary.bonusTypeOther,
                  } as Record<BonusType, string>)[b.type];
                  return {
                    id: b.id,
                    primary: `${formatCurrency(b.amount)} · ${typeLabel}`,
                    secondary: `${b.date}${jobSuffix(b.jobId)}${b.notes ? ` · ${b.notes}` : ''}`,
                    onEdit: () => openBonusModal(b),
                    onDelete: () => confirmDelete(b.date, () => removeBonus(b.id)),
                  };
                })}
            />
            <EntryList
              title={t.salary.overtime}
              icon={<Timer size={14} className="text-[var(--text-2)]" />}
              onAdd={() => openOvertimeModal()}
              empty={t.salary.noEntries}
        editLabel={t.edit}
        deleteLabel={t.delete}
              items={[...overtime]
                .filter(o => matchesFilter(o.jobId))
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(o => ({
                  id: o.id,
                  primary: `${o.hours}t · ${formatCurrency(o.amount)}`,
                  secondary: `${o.date}${jobSuffix(o.jobId)}${o.notes ? ` · ${o.notes}` : ''}`,
                  onEdit: () => openOvertimeModal(o),
                  onDelete: () => confirmDelete(o.date, () => removeOvertime(o.id)),
                }))}
            />
            <EntryList
              title={t.salary.hoursSnapshots}
              icon={<Clock size={14} className="text-[var(--text-2)]" />}
              onAdd={() => openHoursModal()}
              empty={t.salary.noEntries}
        editLabel={t.edit}
        deleteLabel={t.delete}
              items={[...hoursSnapshots]
                .filter(h => matchesFilter(h.jobId))
                .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth))
                .map(h => ({
                  id: h.id,
                  primary: `${h.actualHoursPerWeek}t/uke`,
                  secondary: `${h.periodMonth}${jobSuffix(h.jobId)}${h.notes ? ` · ${h.notes}` : ''}`,
                  onEdit: () => openHoursModal(h),
                  onDelete: () => confirmDelete(h.periodMonth, () => removeHoursSnapshot(h.id)),
                }))}
            />
          </div>
        );
      })()}

      {modal && <EditModal {...modal} onCancel={closeModal} />}
      {confirm && <ConfirmModal {...confirm} onCancel={closeConfirm} />}
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────────

interface SummaryTileProps {
  label: string;
  value: string;
  sub?: string;
  chip?: React.ReactNode;
  color?: string;
}

const SummaryTile: React.FC<SummaryTileProps> = ({ label, value, sub, chip, color }) => (
  <div className={`${card} p-4 md:p-5 space-y-1.5`}>
    <div className={sectionLabel}>{label}</div>
    <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums" style={{ color: color ?? 'var(--text-1)' }}>
      {value}
    </div>
    {chip && <div>{chip}</div>}
    {sub && <div className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{sub}</div>}
  </div>
);

interface EntryItem {
  id: string;
  primary: string;
  secondary: string;
  chip?: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}

interface EntryListProps {
  title: string;
  icon: React.ReactNode;
  onAdd: () => void;
  empty: string;
  items: EntryItem[];
  editLabel: string;
  deleteLabel: string;
}

const EntryList: React.FC<EntryListProps> = ({ title, icon, onAdd, empty, items, editLabel, deleteLabel }) => (
  <div className={`${card} p-5 md:p-7 space-y-4`}>
    <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className={sectionLabel}>{title}</h3>
      </div>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
      >
        <Plus size={12} /> {title.split(' ')[0]}
      </button>
    </div>
    {items.length === 0 ? (
      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{empty}</p>
    ) : (
      <div className="space-y-0">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0 group">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-1)] font-mono tabular-nums truncate">{item.primary}</div>
                {item.chip}
              </div>
              <div className="text-[11px] text-[var(--text-2)] truncate">{item.secondary}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <button aria-label={`${editLabel} — ${item.primary}`} onClick={item.onEdit} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors">
                <Edit2 size={13} />
              </button>
              <button aria-label={`${deleteLabel} — ${item.primary}`} onClick={item.onDelete} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[#B5533A] hover:bg-[var(--bg-elev)] transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// ── Real Hourly Rate inline SVG chart ──────────────────────────────

interface RealHourlyChartProps {
  series: {
    month: string;
    nominalHourly: number;
    realHourly: number | null;
  }[];
  formatCurrency: (v: number) => string;
  t: {
    salary: {
      nominal: string;
      real: string;
    };
  };
}

const RealHourlyChart: React.FC<RealHourlyChartProps> = ({ series, formatCurrency, t }) => {
  // Two views: raw points (for chart) and CPI-anchored points (for chip stats)
  const rawData = series.filter(p => p.nominalHourly > 0);
  const data = rawData.map(p => ({
    month: p.month,
    nominal: Math.round(p.nominalHourly),
    real: Math.round(p.realHourly ?? p.nominalHourly),
  }));

  if (data.length < 2) {
    return (
      <div className="h-[260px] grid place-items-center text-[12px]" style={{ color: 'var(--text-3)' }}>
        —
      </div>
    );
  }

  // For the summary chips, find the latest point that actually has CPI data
  // so the "real" and "gap" aren't quietly falling back to nominal.
  const lastWithCpi = [...rawData].reverse().find(p => p.realHourly != null) ?? rawData[rawData.length - 1];
  const first = data[0];
  const last = {
    nominal: Math.round(lastWithCpi.nominalHourly),
    real: Math.round(lastWithCpi.realHourly ?? lastWithCpi.nominalHourly),
  };
  const eatenPct = last.nominal > 0 ? ((last.nominal - last.real) / last.nominal) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Inline summary chips above the chart */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-mono" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
          {t.salary.nominal} {formatCurrency(last.nominal)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-mono" style={{ background: 'color-mix(in srgb, var(--violet) 14%, transparent)', color: 'var(--violet)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--violet)' }} />
          {t.salary.real} {formatCurrency(last.real)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-mono" style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', color: 'var(--warning)' }}>
          Inflation gap {eatenPct.toFixed(1)}%
        </span>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="nominalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="realGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.1} />
                <stop offset="100%" stopColor="var(--violet)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${Math.round(v)}`}
              tick={{ fontSize: 11, fill: '#5F6555' }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--text-3)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <ReferenceLine y={first.real} stroke="var(--text-3)" strokeDasharray="2 4" label={{ value: 'baseline', position: 'insideTopLeft', fill: 'var(--text-3)', fontSize: 10 }} />
            <Area type="monotone" dataKey="nominal" name={t.salary.nominal} stroke="var(--accent)" strokeWidth={2.5} fill="url(#nominalGradient)" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }} />
            <Area type="monotone" dataKey="real" name={t.salary.real} stroke="var(--violet)" strokeWidth={2.5} strokeDasharray="5 3" fill="url(#realGradient)" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ── Next Review Card ───────────────────────────────────────────────

interface NextReviewCtx {
  lastRaise: SalaryEntry;
  monthsSince: number;
  cpiSincePct: number | null;
  cpiRolling12Pct: number | null;
  cpiAsOf: string | null;
  inflationOnlySalary: number | null;
}

interface NextReviewCardProps {
  ctx: NextReviewCtx;
  t: Translations;
  formatCurrency: (v: number) => string;
}

const NextReviewCard: React.FC<NextReviewCardProps> = ({ ctx, t, formatCurrency }) => {
  const [proposed, setProposed] = useState<string>('');
  const proposedNum = (() => {
    const n = parseLocaleNumber(proposed);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const proposedPct = proposedNum != null && ctx.lastRaise.grossAnnual > 0
    ? ((proposedNum / ctx.lastRaise.grossAnnual) - 1) * 100
    : null;
  const realVsSince = proposedPct != null && ctx.cpiSincePct != null
    ? proposedPct - ctx.cpiSincePct
    : null;
  const realVsRolling = proposedPct != null && ctx.cpiRolling12Pct != null
    ? proposedPct - ctx.cpiRolling12Pct
    : null;

  const fmtPct = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const gapColor = (v: number | null) => v == null
    ? 'var(--text-2)'
    : v >= 0 ? 'var(--positive)' : 'var(--warning)';

  return (
    <div className={`${card} p-5 md:p-7 space-y-5`}>
      <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
        <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
        <h3 className={sectionLabel}>{t.salary.nextReviewTitle}</h3>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.nextReviewDesc}</p>

      {/* Metric grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile
          label={t.salary.lastRaiseLabel}
          value={formatCurrency(ctx.lastRaise.grossAnnual)}
          sub={`${({
            initial: t.salary.changeTypeInitial,
            raise: t.salary.changeTypeRaise,
            promotion: t.salary.changeTypePromotion,
            job_change: t.salary.changeTypeJobChange,
            adjustment: t.salary.changeTypeAdjustment,
          } as Record<string, string>)[ctx.lastRaise.changeType] ?? ''} · ${ctx.lastRaise.effectiveDate}`}
        />
        <SummaryTile
          label={t.salary.timeSinceLabel}
          value={`${ctx.monthsSince} ${t.salary.monthsAgo}`}
          sub={ctx.lastRaise.effectiveDate}
        />
        <SummaryTile
          label={t.salary.cpiSinceLabel}
          value={fmtPct(ctx.cpiSincePct)}
          sub={ctx.cpiAsOf ? `${t.salaryPage.asOf} ${ctx.cpiAsOf}` : ''}
          color={ctx.cpiSincePct != null ? 'var(--accent)' : undefined}
        />
        <SummaryTile
          label={t.salary.cpiRolling12Label}
          value={fmtPct(ctx.cpiRolling12Pct)}
          sub={ctx.cpiAsOf ?? ''}
          color={ctx.cpiRolling12Pct != null ? 'var(--accent)' : undefined}
        />
      </div>

      {/* Inflation-only target */}
      {ctx.inflationOnlySalary != null && (
        <div className="flex flex-wrap items-baseline gap-3 pt-1">
          <div className={sectionLabel}>{t.salary.inflationOnlyTarget}</div>
          <div className="text-[20px] md:text-[22px] font-semibold font-mono tabular-nums" style={{ color: 'var(--violet)' }}>
            {formatCurrency(Math.round(ctx.inflationOnlySalary))}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {t.salary.inflationOnlyTargetDesc}
          </div>
        </div>
      )}

      {/* Calculator */}
      <div className="pt-4 border-t border-[var(--border)] space-y-3">
        <label className="block">
          <div className={sectionLabel}>{t.salary.proposedSalaryLabel}</div>
          <input
            type="text"
            inputMode="decimal"
            value={proposed}
            onChange={e => setProposed(e.target.value)}
            placeholder={t.salary.proposedSalaryHint}
            className="mt-2 w-full md:w-72 h-10 px-3 rounded-lg bg-[var(--bg-elev)] border border-[var(--border)] text-[14px] font-mono tabular-nums text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--accent)]"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <SummaryTile
            label={t.salary.proposedIncreaseLabel}
            value={fmtPct(proposedPct)}
            sub={proposedNum != null
              ? `${formatCurrency(Math.round(proposedNum - ctx.lastRaise.grossAnnual))}`
              : ''}
            color={proposedPct != null ? (proposedPct >= 0 ? 'var(--positive)' : 'var(--negative)') : undefined}
          />
          <SummaryTile
            label={t.salary.realRaiseSinceLabel}
            value={realVsSince != null ? `${realVsSince >= 0 ? '+' : ''}${realVsSince.toFixed(1)}pp` : '—'}
            sub={ctx.cpiSincePct != null ? `KPI ${fmtPct(ctx.cpiSincePct)}` : ''}
            color={gapColor(realVsSince)}
          />
          <SummaryTile
            label={t.salary.realRaiseRollingLabel}
            value={realVsRolling != null ? `${realVsRolling >= 0 ? '+' : ''}${realVsRolling.toFixed(1)}pp` : '—'}
            sub={ctx.cpiRolling12Pct != null ? `KPI ${fmtPct(ctx.cpiRolling12Pct)}` : ''}
            color={gapColor(realVsRolling)}
          />
        </div>
      </div>
    </div>
  );
};

export default SalaryPage;
