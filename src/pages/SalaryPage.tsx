import React, { useMemo, useState, lazy, Suspense } from 'react';
import {
  TrendingUp,
  Briefcase,
  Gift,
  Clock,
  Edit2,
  Trash2,
  Plus,
  AlertTriangle,
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
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { Translations } from '../i18n/translations';
import EditModal, { type ModalField } from '../components/EditModal';
import ConfirmModal from '../components/ConfirmModal';
import ChartTooltip from '../components/ChartTooltip';
import { PaydayField } from '../components/PaydayField';
import { WageCalculator } from '../components/WageCalculator';
import RecordEventModal, { type RecordEditTarget, type RecordType } from '../components/RecordEventModal';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import { calcTaxByRegion, calcMarginalTaxRate } from '../lib/norwegianTax';
import { restskattEstimate } from '../lib/restskatt';
import { monthKeyFromDate, addMonthsKey, monthsBetween, yearOf } from '../lib/date';
import { salaryAt, hoursAt, nominalHourlyRate, WEEKS_PER_MONTH, activeJobBreakdown } from '../lib/salary';
import { formatSignedPct, formatAxisInt } from '../lib/format';
import { isValidYearMonth, isOptionalYearMonth, isNonNegativeNumber, isNonEmpty, parseLocaleNumber } from '../lib/validators';
import { ChartSkeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';

const MoneyFlowSankey = lazy(() => import('../components/charts/MoneyFlowSankey'));

const CHANGE_TYPE_COLOR: Record<SalaryChangeType, string> = {
  initial: 'var(--text-dim)',
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
    salaries, addSalary, removeSalary,
    bonuses, removeBonus,
    overtime, removeOvertime,
    hoursSnapshots, removeHoursSnapshot,
    inflation, inflationStale, refreshInflation,
    wageStats, wageStatsStale, payslips,
    region, customTaxRatePct, pension, annualMortgageInterest,
    grossAnnualIncome,
  } = useFinance();
  const reduced = useReducedMotion();
  const isGeneric = region === 'generic';

  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  const [recordEvent, setRecordEvent] = useState<{ target?: RecordEditTarget; initialType?: RecordType } | null>(null);
  // Salary-over-time card view: nominal trajectory vs real (inflation-adjusted) hourly.
  const [timelineView, setTimelineView] = useState<'nominal' | 'real'>('nominal');
  const [refreshingInflation, setRefreshingInflation] = useState(false);
  const handleRefreshInflation = async () => {
    setRefreshingInflation(true);
    try { await refreshInflation(); } finally { setRefreshingInflation(false); }
  };

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);
  const openConfirm = (config: ConfirmConfig) => setConfirm(config);
  const closeConfirm = () => setConfirm(null);

  const sortedSalaries = useMemo(
    () => [...salaries].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [salaries]
  );

  const currentMonthKey = monthKeyFromDate(new Date());

  // Concurrent employment is legitimate and deliberately summed, but it is also
  // what a job change looks like when the previous job's end date wasn't
  // shortened — and that silently doubles income. Surface it either way.
  const overlappingJobs = useMemo(
    () => activeJobBreakdown(salaries, jobs, currentMonthKey),
    [salaries, jobs, currentMonthKey],
  );

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
      const nominalHourly = nominalHourlyRate(monthlyGross, onCallMonthly, hours);
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
      { key: 'startDate', label: t.salary.startDate, type: 'monthpicker', pickerMode: 'month', value: existing?.startDate ?? '', placeholder: '2023-08' },
      { key: 'endDate', label: t.salary.endDate, type: 'monthpicker', pickerMode: 'month', value: existing?.endDate ?? '', placeholder: '2024-09' },
      { key: 'contractedHoursPerWeek', label: t.salary.contractedHours, type: 'number', value: (existing?.contractedHoursPerWeek ?? 37.5).toString() },
      { key: 'onCallAnnual', label: t.salary.onCallAnnual, type: 'number', value: (existing?.onCallAnnual ?? '').toString(), placeholder: '0' },
    ];
    if (!existing) {
      fields.push({ key: 'initialSalary', label: t.salary.initialSalary, type: 'number', value: '', placeholder: '600000' });
    }
    const currentJobs = jobs.filter(j => !j.endDate);
    if (!existing && currentJobs.length > 0) {
      fields.push({
        key: 'endPrevJob',
        label: t.salary.endPrevJobField,
        type: 'checkbox',
        value: 'true',
        hint: currentJobs.map(j => `${j.employer} — ${j.role}`).join(', '),
      });
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
        if (!isNonNegativeNumber(vals.contractedHoursPerWeek)) {
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
          closeModal();
          return;
        }
        const newJobId = addJob(payload);
        if (initialSalaryNum !== null) {
          addSalary({
            jobId: newJobId,
            effectiveDate: vals.startDate,
            grossAnnual: initialSalaryNum,
            changeType: 'initial' as SalaryChangeType,
          });
        }
        // A new current job usually means you left the previous one — end any
        // earlier still-current job at the new start (opt-out via the checkbox
        // so genuinely concurrent jobs remain possible).
        if (vals.endPrevJob === 'true' && payload.endDate == null) {
          jobs
            .filter(j => !j.endDate && j.startDate < payload.startDate)
            .forEach(j => updateJob(j.id, { endDate: payload.startDate }));
        }
        closeModal();
      },
    });
  };

  const openRecordEvent = (target?: RecordEditTarget, initialType?: RecordType) =>
    setRecordEvent({ target, initialType });

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

  // Clamp to the salary in effect *today* — the last entry may be a
  // future-dated raise, and the headline (`current`) is already clamped.
  const activeSalary = salaryAt(currentMonthKey, sortedSalaries);
  const currentJob = activeSalary ? jobsById.get(activeSalary.jobId) : undefined;
  const currentOnCallAnnual = currentJob?.onCallAnnual ?? 0;

  // Marginal rate on the next krone — the "is the extra shift worth it" number.
  // Norwegian model only; in generic mode the marginal rate is just the flat rate.
  const marginalRate = !isGeneric && current
    ? calcMarginalTaxRate(current.totalAnnual, pension.ipsAnnualContribution)
    : null;

  // Restskatt early warning: withheld-to-date vs expected annual tax, projected
  // from this year's payslips. Norwegian model only — "restskatt" is a Norwegian
  // concept and the tax fn already carries region + deductions.
  const restskatt = useMemo(() => {
    if (isGeneric) return null;
    return restskattEstimate(
      payslips,
      yearOf(currentMonthKey),
      (gross) => calcTaxByRegion(gross, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest).totalTax,
    );
  }, [isGeneric, payslips, currentMonthKey, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest]);

  const yoyChip = yoy ? yoy.salary - yoy.cpi : null;
  const chipColor = yoyChip != null && yoyChip >= 0 ? 'var(--positive)' : 'var(--negative)';
  const chipBg = yoyChip != null && yoyChip >= 0 ? 'var(--positive-bg)' : 'var(--negative-bg)';

  // Total-comp: only chart the components that ever carry a value, so the stack
  // isn't padded with always-zero series (base + on-call, say, without bonus/OT).
  const compSeries = [
    { key: 'base', name: t.salaryPage.baseSalary, fill: 'url(#compBaseGradient)', legend: CHART.forest },
    { key: 'onCall', name: t.salary.onCallLabel, fill: 'url(#compOnCallGradient)', legend: CHART.forestLight },
    { key: 'bonus', name: t.salary.bonuses, fill: 'url(#compBonusGradient)', legend: CHART.teal },
    { key: 'overtime', name: t.salary.overtime, fill: 'url(#compOtGradient)', legend: CHART.slate },
  ] as const;
  const activeCompSeries = compSeries.filter(s => compByYear.some(r => (r[s.key] ?? 0) > 0));
  // Hours-vs-rate only says anything when weekly hours actually change over time;
  // with constant hours the chart is flat, so hide it (still shows for variable hours).
  const hoursVary = new Set(hoursVsHourly.map(d => Math.round(d.hoursPerWeek))).size > 1;

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
          <p className="mt-2 text-[11px] flex items-center gap-2" style={{ color: 'var(--warning)' }}>
            <span>{t.salary.inflationOffline}</span>
            <button
              type="button"
              onClick={handleRefreshInflation}
              disabled={refreshingInflation}
              className="underline underline-offset-2 hover:opacity-80 transition-opacity disabled:opacity-60 disabled:no-underline"
            >
              {refreshingInflation ? t.salary.inflationRefreshing : t.salary.inflationRefresh}
            </button>
          </p>
        )}
        {wageStatsStale && (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--warning)' }}>
            {t.salary.wageBenchmarkOffline}
          </p>
        )}
      </header>

      {overlappingJobs.length > 1 && (
        <Card padding="md" style={{ borderColor: 'var(--warning)' }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium" style={{ color: 'var(--warning)' }}>
                {t.salaryPage.overlapTitle.replace('{count}', String(overlappingJobs.length))}
              </p>
              <ul className="mt-2 space-y-1">
                {overlappingJobs.map((c) => (
                  <li key={c.jobId} className="text-[13px] flex items-baseline gap-2">
                    <span className="text-[var(--text-1)] truncate">{c.job?.role ?? t.salaryPage.overlapUnknownJob}</span>
                    <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      {c.job?.startDate ?? '—'} → {c.job?.endDate ?? t.salaryPage.overlapOpenEnded}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[12px]" style={{ color: 'var(--text-2)' }}>
                      {formatCurrency(c.gross)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
                {t.salaryPage.overlapTotal.replace('{total}', formatCurrency(grossAnnualIncome))}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.salaryPage.overlapHint}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Summary tiles */}
      <div data-tour="salary-overview" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile
          label={t.salary.currentSalary}
          value={current ? formatCurrency(current.totalAnnual) : '—'}
          sub={current ? (
            currentOnCallAnnual > 0
              ? `${formatCurrency(current.grossAnnual)} ${t.salaryPage.baseSuffix} + ${formatCurrency(currentOnCallAnnual)} ${t.salary.onCallShort} · ${formatCurrency(calcTaxByRegion(current.totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest).netMonthly)} ${t.salaryPage.netPerMonth}`
              : `${formatCurrency(calcTaxByRegion(current.totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest).netMonthly)} ${t.salaryPage.netPerMonth}`
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
          value={formatSignedPct(cumulativeGrowthPct)}
          sub={first ? `${t.salary.growthSinceFirst} ${first.month}` : ''}
          color={cumulativeGrowthPct >= 0 ? 'var(--positive)' : 'var(--negative)'}
        />
        {isGeneric ? (
          <SummaryTile
            label={t.salaryPage.yoySalary}
            value={formatSignedPct(yoy?.salary)}
            sub={first ? `${t.salary.growthSinceFirst} ${first.month}` : ''}
            color={yoy && yoy.salary >= 0 ? 'var(--positive)' : yoy ? 'var(--negative)' : undefined}
          />
        ) : (
          <SummaryTile
            label={t.salary.yoyVsInflation}
            value={formatSignedPct(yoy?.salary)}
            sub={yoy ? `${t.salaryPage.cpi} ${formatSignedPct(yoy.cpi)}` : ''}
            chip={yoyChip != null ? (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{ color: chipColor, background: chipBg }}
              >
                {formatSignedPct(yoyChip, 1, 'pp')} · {yoyChip >= 0 ? t.salary.beatsCpi : t.salary.losesCpi}
              </span>
            ) : undefined}
          />
        )}
        <SummaryTile
          label={t.salary.effectiveHourly}
          value={current ? formatCurrency(trailingHourly) : '—'}
          sub={current ? `${current.hoursPerWeek.toFixed(1)} ${t.common.hoursPerWeekUnit}` : ''}
        />
      </div>

      {/* Wage-unit calculator — annual ↔ month/week/day/hour/minute/second. */}
      <WageCalculator currentAnnual={current?.grossAnnual ?? grossAnnualIncome} />

      {/* Money flow — where the gross salary goes, with the marginal-rate readout. */}
      <Card padding="none" className="p-5 md:p-7">
        <div className="flex items-start justify-between gap-3 pb-4 mb-2 border-b border-[var(--border)]">
          <div>
            <SectionLabel>{t.charts.moneyFlowTitle}</SectionLabel>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.moneyFlowSub}</p>
          </div>
          {marginalRate != null && (
            <div className="text-right shrink-0" title={t.salaryPage.marginalTitle}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{t.salaryPage.marginalRate}</div>
              <div className="text-[18px] font-mono font-semibold leading-tight" style={{ color: 'var(--warning)' }}>{marginalRate.toFixed(0)}%</div>
              <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>{t.salaryPage.marginalHint}</div>
            </div>
          )}
        </div>
        <div className="h-[280px] w-full">
          <Suspense fallback={<ChartSkeleton />}><MoneyFlowSankey /></Suspense>
        </div>
      </Card>

      {/* Restskatt early warning — withheld-to-date vs expected annual tax. */}
      {restskatt && (
        <Card padding="none" className="p-5 md:p-7 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-4 border-b border-[var(--border)]">
            <div>
              <SectionLabel>{t.salaryPage.restskattTitle}</SectionLabel>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.salaryPage.restskattDesc}</p>
            </div>
            <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: 'var(--text-3)' }}>
              {t.salaryPage.restskattMonths.replace('{n}', String(restskatt.monthsRecorded))}
            </span>
          </div>
          <div
            className="text-[14px] font-semibold"
            style={{ color: restskatt.status === 'restskatt' ? 'var(--warning)' : restskatt.status === 'refund' ? 'var(--positive)' : 'var(--text-2)' }}
          >
            {(restskatt.status === 'restskatt' ? t.salaryPage.restskattRestskatt
              : restskatt.status === 'refund' ? t.salaryPage.restskattRefund
              : t.salaryPage.restskattOnTrack)
              .replace('{amount}', formatCurrency(Math.round(Math.abs(restskatt.gap))))}
          </div>
          <div className="grid grid-cols-3 gap-3 text-[13px]">
            <div>
              <SectionLabel className="mb-1">{t.salaryPage.restskattWithheld}</SectionLabel>
              <div className="font-mono font-semibold text-[var(--text-1)] [overflow-wrap:anywhere]">{formatCurrency(Math.round(restskatt.withheldToDate))}</div>
            </div>
            <div>
              <SectionLabel className="mb-1">{t.salaryPage.restskattProjected}</SectionLabel>
              <div className="font-mono font-semibold text-[var(--text-1)] [overflow-wrap:anywhere]">{formatCurrency(Math.round(restskatt.projectedAnnualWithholding))}</div>
            </div>
            <div>
              <SectionLabel className="mb-1">{t.salaryPage.restskattExpected}</SectionLabel>
              <div className="font-mono font-semibold text-[var(--text-1)] [overflow-wrap:anywhere]">{formatCurrency(Math.round(restskatt.expectedAnnualTax))}</div>
            </div>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.salaryPage.restskattNote}</p>
        </Card>
      )}

      {/* Next salary review — forward-looking helper for negotiation moments. */}
      {!isGeneric && reviewContext && (
        <NextReviewCard
          ctx={reviewContext}
          t={t}
          formatCurrency={formatCurrency}
        />
      )}

      {/* Salary over time — nominal trajectory, with a real-hourly (purchasing-power)
          toggle when CPI is available. Folds in the former standalone real-rate card. */}
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Briefcase size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <SectionLabel>{timelineView === 'real' ? t.salary.realHourlyRate : t.salary.salaryTimeline}</SectionLabel>
          </div>
          {!isGeneric && (
            <div className="inline-flex rounded-[6px] border border-[var(--border)] p-0.5">
              {([['nominal', t.salary.salaryTimeline], ['real', t.salary.realHourlyRate]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTimelineView(v)}
                  className="px-2.5 py-1 rounded-[4px] text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
                  style={timelineView === v ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : { color: 'var(--text-3)' }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {timelineView === 'real' ? (
          <>
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.realHourlyRateDesc}</p>
            <RealHourlyChart series={series} formatCurrency={formatCurrency} t={t} />
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.salary.inflationSource}</p>
          </>
        ) : (
          <>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.salaryTimelineDesc}</p>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salaryTimeline} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salaryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0.12} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={52} />
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
                isAnimationActive={!reduced}
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
          </>
        )}
      </Card>

      {/* YoY vs inflation — hidden in generic region (no CPI source). */}
      {!isGeneric && (
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.salary.yoyChart}</SectionLabel>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.yoyChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yoyByYear} margin={{ top: 28, right: 12, left: 0, bottom: 0 }} barGap={4} barCategoryGap="22%">
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={44} />
              <Tooltip
                content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />}
                cursor={{ fill: CHART.surface2 }}
              />
              <ReferenceLine y={0} stroke="var(--text-3)" strokeWidth={1} />
              <Bar isAnimationActive={!reduced} dataKey="salaryPct" name={t.salaryPage.salaryIncrease} fill="var(--accent)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="salaryPct" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--accent)' }} />
              </Bar>
              <Bar isAnimationActive={!reduced} dataKey="cpiPct" name={t.salaryPage.cpi} fill="var(--violet)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="cpiPct" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--violet)' }} />
              </Bar>
              <Bar isAnimationActive={!reduced} dataKey="gap" name={t.salaryPage.gap} radius={[4, 4, 0, 0]}>
                {yoyByYear.map((row) => (
                  <Cell key={row.year} fill={row.gap >= 0 ? 'var(--positive)' : 'var(--negative)'} />
                ))}
                <LabelList dataKey="gap" position="top" formatter={(v) => formatSignedPct(Number(v ?? 0), 1, 'pp')} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-1)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Inline series legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{t.salaryPage.salaryIncrease}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--violet)' }} />{t.salaryPage.cpi}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--positive)' }} />{t.salaryPage.beatsCpiLegend}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--negative)' }} />{t.salaryPage.belowCpi}</div>
        </div>

        {/* Numeric summary row */}
        {yoyByYear.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-t border-[var(--border)]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-2)' }}>
                  <th scope="col" className="py-2 pr-3 font-medium uppercase tracking-wider text-[10px]">{t.salaryPage.year}</th>
                  <th scope="col" className="py-2 px-2 font-medium uppercase tracking-wider text-[10px] text-right">{t.salaryPage.salaryCol}</th>
                  <th scope="col" className="py-2 px-2 font-medium uppercase tracking-wider text-[10px] text-right">{t.salaryPage.cpi}</th>
                  <th scope="col" className="py-2 pl-2 font-medium uppercase tracking-wider text-[10px] text-right">{t.salaryPage.gap}</th>
                </tr>
              </thead>
              <tbody>
                {yoyByYear.map(row => (
                  <tr key={row.year} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3 font-mono font-semibold text-[var(--text-1)]">{row.year}</td>
                    <td className="py-2 px-2 font-mono text-right" style={{ color: 'var(--accent)' }}>
                      {formatSignedPct(row.salaryPct)}
                    </td>
                    <td className="py-2 px-2 font-mono text-right" style={{ color: 'var(--violet)' }}>
                      {formatSignedPct(row.cpiPct)}
                    </td>
                    <td
                      className="py-2 pl-2 font-mono font-semibold text-right"
                      style={{ color: row.gap >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                    >
                      {formatSignedPct(row.gap, 1, 'pp')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      {/* Total comp by year */}
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Gift size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.salary.totalCompChart}</SectionLabel>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.totalCompChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={compByYear} margin={{ top: 28, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
              <defs>
                <linearGradient id="compBaseGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.forest} stopOpacity={1} />
                  <stop offset="100%" stopColor={CHART.forest} stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compBonusGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.teal} stopOpacity={1} />
                  <stop offset="100%" stopColor={CHART.teal} stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compOtGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.slate} stopOpacity={1} />
                  <stop offset="100%" stopColor={CHART.slate} stopOpacity={1} />
                </linearGradient>
                <linearGradient id="compOnCallGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.forestLight} stopOpacity={1} />
                  <stop offset="100%" stopColor={CHART.forestLight} stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={52} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: CHART.surface2 }}
              />
              {activeCompSeries.map((s, i) => {
                const isLast = i === activeCompSeries.length - 1;
                return (
                  <Bar isAnimationActive={!reduced} key={s.key} dataKey={s.key} stackId="a" name={s.name} fill={s.fill} radius={isLast ? [6, 6, 0, 0] : undefined}>
                    {isLast && (
                      <LabelList dataKey="total" position="top" formatter={(v) => formatAxisInt(Number(v ?? 0))} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-1)' }} />
                    )}
                  </Bar>
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Inline legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          {activeCompSeries.map(s => (
            <div key={s.key} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.legend }} />{s.name}</div>
          ))}
        </div>
      </Card>

      {/* Hours vs effective hourly — only meaningful when weekly hours vary. */}
      {hoursVary && (
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Clock size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.salary.hoursVsComp}</SectionLabel>
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
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--text-2)', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tickFormatter={(v) => `${v}t`} {...AXIS_PROPS_Y} width={40} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={56} />
              <Tooltip
                cursor={{ fill: CHART.surface2 }}
                content={<ChartTooltip valueFormatter={(v, e) => e?.dataKey === 'hoursPerWeek' ? `${v.toFixed(1)} ${t.common.hoursPerWeekUnit}` : formatCurrency(v)} />}
              />
              <Bar isAnimationActive={!reduced} yAxisId="left" dataKey="hoursPerWeek" name={t.salaryPage.hoursPerWk} fill="url(#hoursGradient)" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="hoursPerWeek" position="top" formatter={(v) => `${Number(v ?? 0).toFixed(0)}t`} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--warning)' }} />
              </Bar>
              <Line
                yAxisId="right"
                isAnimationActive={!reduced}
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
      </Card>
      )}

      {/* One box: each job is a lane with its events on a timeline spine */}
      {(() => {
        // Salary/hours are YYYY-MM, bonus/overtime YYYY-MM-DD — pad for a shared sort key.
        const norm = (d: string) => (d.length === 7 ? `${d}-01` : d);
        const salaryTypeLabel = (ct: SalaryChangeType) => ({
          initial: t.salary.changeTypeInitial,
          raise: t.salary.changeTypeRaise,
          promotion: t.salary.changeTypePromotion,
          job_change: t.salary.changeTypeJobChange,
          adjustment: t.salary.changeTypeAdjustment,
        } as Record<SalaryChangeType, string>)[ct];
        const bonusTypeLabel = (bt: BonusType) => ({
          annual: t.salary.bonusTypeAnnual,
          performance: t.salary.bonusTypePerformance,
          signing: t.salary.bonusTypeSigning,
          holiday_pay: t.salary.bonusTypeHolidayPay,
          profit_share: t.salary.bonusTypeProfitShare,
          other: t.salary.bonusTypeOther,
        } as Record<BonusType, string>)[bt];
        const salaryChip = (id: string): React.ReactNode => {
          const chipData = salaryChipsById.get(id);
          if (!chipData) return undefined;
          const { pct, gap } = chipData;
          const pctColor = pct >= 0 ? 'var(--positive)' : 'var(--negative)';
          const pctBg = pct >= 0 ? 'var(--positive-bg)' : 'var(--negative-bg)';
          return (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap"
              style={{ color: pctColor, background: pctBg }}
              title={gap != null ? `${formatSignedPct(gap, 1, 'pp')} ${t.salary.vsCpi}` : undefined}
            >
              {formatSignedPct(pct)}
              {gap != null && (
                <span style={{ color: gap >= 0 ? 'var(--positive)' : 'var(--warning)', opacity: 0.85 }}>
                  ({formatSignedPct(gap, 1, '')} {t.salary.vsCpi})
                </span>
              )}
            </span>
          );
        };

        const salaryEv = (s: SalaryEntry): TimelineEvent => ({
          id: s.id, sortKey: norm(s.effectiveDate), year: s.effectiveDate.slice(0, 4),
          accent: CHANGE_TYPE_COLOR[s.changeType], title: salaryTypeLabel(s.changeType),
          chip: salaryChip(s.id), date: s.effectiveDate, notes: s.notes,
          amount: formatCurrency(s.grossAnnual),
          onEdit: () => openRecordEvent({ kind: 'salary', entry: s }),
          onDelete: () => confirmDelete(s.effectiveDate, () => removeSalary(s.id)),
        });
        const bonusEv = (b: BonusEntry): TimelineEvent => ({
          id: b.id, sortKey: norm(b.date), year: b.date.slice(0, 4), accent: 'var(--teal)',
          title: bonusTypeLabel(b.type), date: b.date, notes: b.notes,
          amount: formatCurrency(b.amount),
          onEdit: () => openRecordEvent({ kind: 'bonus', entry: b }),
          onDelete: () => confirmDelete(b.date, () => removeBonus(b.id)),
        });
        const overtimeEv = (o: OvertimeEntry): TimelineEvent => ({
          id: o.id, sortKey: norm(o.date), year: o.date.slice(0, 4), accent: 'var(--slate)',
          title: `${t.salary.overtime} · ${o.hours} t`, date: o.date, notes: o.notes,
          amount: formatCurrency(o.amount),
          onEdit: () => openRecordEvent({ kind: 'overtime', entry: o }),
          onDelete: () => confirmDelete(o.date, () => removeOvertime(o.id)),
        });
        const hoursEv = (h: HoursSnapshot): TimelineEvent => ({
          id: h.id, sortKey: norm(h.periodMonth), year: h.periodMonth.slice(0, 4), accent: 'var(--text-dim)',
          title: t.salary.hoursChange, date: h.periodMonth, notes: h.notes,
          amount: `${h.actualHoursPerWeek}${t.common.hoursPerWeekUnit}`,
          onEdit: () => openRecordEvent({ kind: 'hours', entry: h }),
          onDelete: () => confirmDelete(h.periodMonth, () => removeHoursSnapshot(h.id)),
        });

        const byDateDesc = (a: TimelineEvent, b: TimelineEvent) => b.sortKey.localeCompare(a.sortKey);
        const jobEvents = (jobId: string): TimelineEvent[] => [
          ...sortedSalaries.filter(s => s.jobId === jobId).map(salaryEv),
          ...bonuses.filter(b => b.jobId === jobId).map(bonusEv),
          ...overtime.filter(o => o.jobId === jobId).map(overtimeEv),
          ...hoursSnapshots.filter(h => h.jobId === jobId).map(hoursEv),
        ].sort(byDateDesc);
        const unassignedEvents = [
          ...bonuses.filter(b => !b.jobId).map(bonusEv),
          ...overtime.filter(o => !o.jobId).map(overtimeEv),
          ...hoursSnapshots.filter(h => !h.jobId).map(hoursEv),
        ].sort(byDateDesc);
        const latestSalaryFor = (jobId: string): SalaryEntry | null => {
          const list = sortedSalaries.filter(s => s.jobId === jobId);
          return list.length ? list[list.length - 1] : null;
        };
        // Current jobs (no end date) first, then past jobs newest-started first.
        const laneJobs = [...jobs].sort((a, b) => {
          const ac = a.endDate ? 1 : 0, bc = b.endDate ? 1 : 0;
          return ac !== bc ? ac - bc : b.startDate.localeCompare(a.startDate);
        });

        const renderTimeline = (events: TimelineEvent[]) => {
          if (events.length === 0) {
            return <p className="text-[12px] pl-6 pt-2" style={{ color: 'var(--text-3)' }}>{t.salary.noEntries}</p>;
          }
          let lastYear = '';
          return (
            <div className="relative mt-3 pl-6">
              <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />
              {events.map(ev => {
                const showYear = ev.year !== lastYear;
                lastYear = ev.year;
                return (
                  <div key={ev.id}>
                    {showYear && (
                      <div className="text-[10px] font-mono font-semibold pt-2 pb-0.5" style={{ color: 'var(--text-3)' }}>{ev.year}</div>
                    )}
                    <div className="relative flex items-start justify-between gap-3 py-2 group">
                      <span className="absolute left-[-21px] top-[13px] w-2 h-2 rounded-full" style={{ background: ev.accent, boxShadow: '0 0 0 2px var(--bg-card)' }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-[13px] text-[var(--text-1)]">
                          <span className="font-medium">{ev.title}</span>
                          {ev.chip}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-2)' }}>{ev.date}{ev.notes ? ` · ${ev.notes}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[13px] font-mono font-semibold tabular-nums text-[var(--text-1)]">{ev.amount}</span>
                        <button aria-label={`${t.edit} — ${ev.title}`} onClick={ev.onEdit} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"><Edit2 size={13} /></button>
                        <button aria-label={`${t.delete} — ${ev.title}`} onClick={ev.onDelete} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--negative)] hover:bg-[var(--bg-elev)] transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        };

        const renderLane = (job: JobEntry) => {
          const isCurrent = !job.endDate;
          const latest = latestSalaryFor(job.id);
          const spark = sortedSalaries.filter(s => s.jobId === job.id).map(s => s.grossAnnual);
          return (
            <div key={job.id} className="rounded-[8px] border p-4" style={{ borderColor: isCurrent ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Briefcase size={14} className="text-[var(--text-3)] shrink-0" />
                    <span className="text-[14px] font-semibold text-[var(--text-1)]">{job.employer} — {job.role}</span>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-[4px]" style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>{t.salary.currentJob}</span>
                    )}
                  </div>
                  <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-2)' }}>
                    <span>{job.startDate} → {job.endDate ?? t.salaryPage.now} · {job.contractedHoursPerWeek}{t.common.hoursPerWeekUnit}</span>
                    {job.onCallAnnual != null && job.onCallAnnual > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold font-mono tabular-nums" style={{ color: 'var(--positive)', background: 'var(--positive-bg)' }} title={t.salary.onCallAnnual}>
                        {t.salary.onCallLabel} {formatCurrency(job.onCallAnnual)}/{t.salaryPage.yearAbbr}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Sparkline values={spark} />
                  {latest && (
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-3)' }}>{isCurrent ? t.salary.nowLabel : t.salary.endLabel}</div>
                      <div className="text-[17px] font-mono font-semibold text-[var(--text-1)]">{formatCurrency(latest.grossAnnual)}</div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <button aria-label={`${t.edit} — ${job.employer}`} onClick={() => openJobModal(job)} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"><Edit2 size={13} /></button>
                    <button aria-label={`${t.delete} — ${job.employer}`} onClick={() => confirmDelete(job.employer, () => removeJob(job.id))} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--negative)] hover:bg-[var(--bg-elev)] transition-colors"><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
              {renderTimeline(jobEvents(job.id))}
            </div>
          );
        };

        return (
          <Card padding="none" className="p-5 md:p-7 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--border)] flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <TrendingUp size={14} className="text-[var(--text-2)]" />
                <SectionLabel>{t.salary.salaryAndJobs}</SectionLabel>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <PaydayField />
                <button
                  onClick={() => openJobModal()}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[6px] text-[12px] font-semibold border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--text-3)] transition-colors"
                >
                  <Briefcase size={13} /> {t.salary.addJob}
                </button>
                {jobs.length > 0 && (
                  <RecordEventButton label={t.salary.recordEvent} onClick={() => openRecordEvent()} />
                )}
              </div>
            </div>

            {jobs.length === 0 && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{t.salary.noEntries}</p>
            )}
            {laneJobs.map(renderLane)}
            {unassignedEvents.length > 0 && (
              <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{t.salary.unassigned}</span>
                </div>
                {renderTimeline(unassignedEvents)}
              </div>
            )}
          </Card>
        );
      })()}

      {modal && <EditModal {...modal} onCancel={closeModal} />}
      {confirm && <ConfirmModal {...confirm} onCancel={closeConfirm} />}
      {recordEvent && (
        <RecordEventModal
          target={recordEvent.target}
          initialType={recordEvent.initialType}
          onNewJob={() => openJobModal()}
          onClose={() => setRecordEvent(null)}
        />
      )}
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
  <Card padding="none" className="p-4 md:p-5 space-y-1.5">
    <SectionLabel>{label}</SectionLabel>
    <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums" style={{ color: color ?? 'var(--text-1)' }}>
      {value}
    </div>
    {chip && <div>{chip}</div>}
    {sub && <div className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{sub}</div>}
  </Card>
);

// One event on a job's timeline spine (salary change, bonus, overtime, hours).
interface TimelineEvent {
  id: string;
  sortKey: string;
  year: string;
  accent: string;
  title: string;
  chip?: React.ReactNode;
  date: string;
  notes?: string;
  amount: string;
  onEdit: () => void;
  onDelete: () => void;
}

const RecordEventButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[6px] text-[12px] font-semibold border transition-colors"
    style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}
  >
    <Plus size={13} /> {label}
  </button>
);

// Tiny salary-progression sparkline for a job lane. Null below two points.
const Sparkline: React.FC<{ values: number[] }> = ({ values }) => {
  if (values.length < 2) return null;
  const w = 80, h = 34, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline points={pts} fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

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
    salaryPage: {
      inflationGap: string;
    };
  };
}

const RealHourlyChart: React.FC<RealHourlyChartProps> = ({ series, formatCurrency, t }) => {
  const reduced = useReducedMotion();
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
          {t.salaryPage.inflationGap} {eatenPct.toFixed(1)}%
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
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="month" {...AXIS_PROPS} />
            <YAxis
              tickFormatter={(v) => `${Math.round(v)}`}
              {...AXIS_PROPS_Y}
              width={44}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--text-3)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <ReferenceLine y={first.real} stroke="var(--text-3)" strokeDasharray="2 4" label={{ value: 'baseline', position: 'insideTopLeft', fill: 'var(--text-3)', fontSize: 10 }} />
            <Area isAnimationActive={!reduced} type="monotone" dataKey="nominal" name={t.salary.nominal} stroke="var(--accent)" strokeWidth={2.5} fill="url(#nominalGradient)" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }} />
            <Area isAnimationActive={!reduced} type="monotone" dataKey="real" name={t.salary.real} stroke="var(--violet)" strokeWidth={2.5} strokeDasharray="5 3" fill="url(#realGradient)" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }} />
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
  const [mode, setMode] = useState<'kr' | 'pct'>('kr');
  const [draft, setDraft] = useState<string>('');

  const base = ctx.lastRaise.grossAnnual;
  // Reference inflation for the "real raise" verdict: prefer CPI since the last
  // raise; fall back to the rolling 12-month rate when the baseline is too new.
  const refCpi = ctx.cpiSincePct ?? ctx.cpiRolling12Pct;
  const floor = refCpi != null ? base * (1 + refCpi / 100) : null;

  const raw = parseLocaleNumber(draft);
  const hasInput = draft.trim() !== '' && Number.isFinite(raw);
  let newSalary: number | null = null;
  let pct: number | null = null;
  if (hasInput) {
    if (mode === 'pct') { pct = raw; newSalary = Math.round(base * (1 + raw / 100)); }
    else { newSalary = Math.round(raw); pct = base > 0 ? ((raw / base) - 1) * 100 : null; }
  }
  const real = pct != null && refCpi != null ? pct - refCpi : null;
  const overFloor = newSalary != null && floor != null ? Math.round(newSalary - floor) : null;
  const fmtPct = formatSignedPct;

  // Gauge maps real-raise percentage points onto a fixed [-4, +6] pp track.
  const DMIN = -4, DMAX = 6;
  const toX = (v: number) => ((Math.max(DMIN, Math.min(DMAX, v)) - DMIN) / (DMAX - DMIN)) * 100;
  const loseW = toX(0);              // real < 0 → losing ground
  const keepW = toX(1) - toX(0);     // 0..1pp → break-even band
  const verdictColor = real == null ? 'var(--text-2)' : real >= 0 ? 'var(--positive)' : 'var(--negative)';

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-5">
      <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
        <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
        <SectionLabel>{t.salary.nextReviewTitle}</SectionLabel>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.salary.nextReviewDesc}</p>

      {/* Offer input with kr / % toggle */}
      <div className="space-y-2">
        <SectionLabel>{t.salary.proposedSalaryLabel}</SectionLabel>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="flex rounded-[6px] border border-[var(--border)] overflow-hidden shrink-0">
            {([['kr', t.salary.offerModeKr], ['pct', t.salary.offerModePct]] as ['kr' | 'pct', string][]).map(([m, lbl]) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className="px-3 text-[12px] font-semibold transition-colors"
                style={{ background: mode === m ? 'var(--accent-bg)' : 'transparent', color: mode === m ? 'var(--accent)' : 'var(--text-2)' }}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-stretch flex-1 min-w-[180px]">
            <input
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={t.salary.proposedSalaryHint}
              className="flex-1 min-w-0 h-10 px-3 rounded-l-lg bg-[var(--bg-elev)] border border-r-0 border-[var(--border)] text-[14px] font-mono tabular-nums text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="flex items-center px-4 rounded-r-lg border border-l-0 border-[var(--border)] bg-[var(--bg-raised)] font-mono text-[13px]" style={{ color: 'var(--text-3)' }}>
              {mode === 'kr' ? 'kr' : '%'}
            </span>
          </div>
        </div>
        {hasInput && newSalary != null && (
          <p className="text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>
            {mode === 'pct'
              ? `= ${formatCurrency(newSalary)}`
              : `= ${fmtPct(pct)}`}
          </p>
        )}
      </div>

      {/* Verdict */}
      <div className="flex items-center gap-4 px-4 py-4 rounded-[10px] border"
        style={{ borderColor: real != null ? 'var(--accent-line)' : 'var(--border)', background: real != null ? 'var(--accent-bg)' : 'transparent' }}>
        {real != null ? (<>
          <div className="text-[28px] md:text-[30px] font-semibold font-mono tabular-nums shrink-0" style={{ color: verdictColor }}>
            {fmtPct(real, 1, 'pp')}
          </div>
          <div className="text-[13px] min-w-0" style={{ color: 'var(--text-1)' }}>
            <span className="font-mono font-semibold">{t.salary.realRaiseAfterInflation}</span>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              {`${fmtPct(pct)} − ${fmtPct(refCpi)} ${t.salaryPage.cpi}`}
              {overFloor != null && `. ${formatCurrency(Math.abs(overFloor))} ${overFloor >= 0 ? t.salary.overFloor : t.salary.underFloor}`}
            </div>
          </div>
        </>) : (
          <div className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            {refCpi == null ? t.salary.inflationOffline : t.salary.proposedSalaryHint}
          </div>
        )}
      </div>

      {/* Gauge */}
      {refCpi != null && (
        <div className="space-y-1.5">
          <div className="relative h-3.5 rounded-full overflow-hidden border border-[var(--border)]" style={{ background: 'var(--bg-raised)' }}>
            <div className="absolute inset-y-0 left-0" style={{ width: `${loseW}%`, background: 'color-mix(in srgb, var(--negative) 30%, transparent)' }} />
            <div className="absolute inset-y-0" style={{ left: `${loseW}%`, width: `${keepW}%`, background: 'color-mix(in srgb, var(--warning) 28%, transparent)' }} />
            <div className="absolute inset-y-0 right-0" style={{ left: `${loseW + keepW}%`, background: 'color-mix(in srgb, var(--positive) 30%, transparent)' }} />
            {real != null && (
              <div className="absolute -inset-y-1 w-[3px]" style={{ left: `calc(${toX(real)}% - 1.5px)`, background: 'var(--text-1)', boxShadow: '0 0 0 2px var(--bg-card)' }} />
            )}
          </div>
          <div className="flex justify-between text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>
            <span>{t.salary.gaugeLose}</span>
            <span>{t.salary.gaugeKeep}</span>
            <span>{t.salary.gaugeReal} ▸</span>
          </div>
        </div>
      )}

      {/* Reference tiles */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <SummaryTile
          label={t.salary.lastRaiseLabel}
          value={formatCurrency(base)}
          sub={`${ctx.lastRaise.effectiveDate} · ${ctx.monthsSince} ${t.salary.monthsAgo}`}
        />
        <SummaryTile
          label={t.salary.inflationFloor}
          value={floor != null ? formatCurrency(Math.round(floor)) : '—'}
          sub={refCpi != null ? `${t.salaryPage.cpi} ${fmtPct(refCpi)}` : ''}
          color={floor != null ? 'var(--warning)' : undefined}
        />
        <SummaryTile
          label={t.salary.proposedIncreaseLabel}
          value={fmtPct(pct)}
          sub={newSalary != null ? formatCurrency(Math.round(newSalary - base)) : ''}
          color={pct != null ? (pct >= 0 ? 'var(--positive)' : 'var(--negative)') : undefined}
        />
      </div>
    </Card>
  );
};

export default SalaryPage;
