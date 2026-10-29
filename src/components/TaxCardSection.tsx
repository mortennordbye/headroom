import { useEffect, useId, useMemo, useState } from 'react';
import { useFinance, calcActiveGrossAnnual } from '../context/FinanceContext';
import { calcTaxByRegion } from '../lib/norwegianTax';
import { parseTableNumber, withholdingByMonth, trekkYear, type TaxCard } from '../lib/forskuddstrekk';
import { restskattStatus } from '../lib/restskatt';
import { parseLocaleNumber } from '../lib/validators';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { FitText } from './ui/FitText';
import { SegmentedControl } from './ui/SegmentedControl';

type Mode = 'none' | 'table' | 'percent';

const draftFor = (card: TaxCard | null, locale: string): string =>
  card?.kind === 'table' ? card.table : card?.kind === 'percent' ? card.pct.toLocaleString(locale) : '';

/**
 * Skattekort editor + what it withholds month by month this year, and the
 * restskatt / refund that leaves against the modelled annual tax. Norwegian
 * region only; the budget's monthly income is deliberately not affected.
 */
export function TaxCardSection() {
  const {
    t, lang, formatCurrency, taxCard, setTaxCard,
    salaries, jobs, region, customTaxRatePct, pension, annualMortgageInterest,
  } = useFinance();
  const sp = t.salaryPage;
  const inputId = useId();
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const [mode, setMode] = useState<Mode>(taxCard?.kind ?? 'none');
  const [draft, setDraft] = useState(draftFor(taxCard, locale));
  const [error, setError] = useState<string | null>(null);
  // Re-sync when the stored card changes from outside (load, import, undo).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMode(taxCard?.kind ?? 'none'); setDraft(draftFor(taxCard, locale)); setError(null); }, [taxCard, locale]);

  // The stored card only changes on a valid commit (or "none"), so switching
  // modes to look doesn't throw the old card away.
  const changeMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setDraft(m === taxCard?.kind ? draftFor(taxCard, locale) : '');
    setError(null);
    if (m === 'none') setTaxCard(null);
  };

  const commit = () => {
    if (draft.trim() === '') {
      setError(null);
      if (taxCard?.kind === mode) setTaxCard(null);
      return;
    }
    if (mode === 'table') {
      if (!parseTableNumber(draft)) { setError(sp.taxCardInvalidTable); return; }
      setError(null);
      setTaxCard({ kind: 'table', table: draft.trim() });
    } else if (mode === 'percent') {
      const pct = parseLocaleNumber(draft);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError(sp.taxCardInvalidPercent); return; }
      setError(null);
      setTaxCard({ kind: 'percent', pct });
    }
  };

  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const summary = useMemo(() => {
    if (!taxCard) return null;
    const grossFor = (m: number) => calcActiveGrossAnnual(salaries, jobs, `${year}-${String(m).padStart(2, '0')}`) / 12;
    const months = withholdingByMonth(taxCard, grossFor);
    const yearGross = Array.from({ length: 12 }, (_, i) => grossFor(i + 1)).reduce((s, g) => s + g, 0);
    if (!(yearGross > 0)) return null;
    const yearWithheld = months.reduce((s, v) => s + v, 0);
    const expectedTax = calcTaxByRegion(yearGross, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest).totalTax;
    const gap = expectedTax - yearWithheld;
    const thisGross = grossFor(currentMonth);
    return {
      months, yearWithheld, expectedTax, gap,
      status: restskattStatus(gap, expectedTax),
      thisWithheld: months[currentMonth - 1],
      thisNet: thisGross - months[currentMonth - 1],
    };
  }, [taxCard, salaries, jobs, year, currentMonth, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest]);

  const evenSpread = taxCard?.kind === 'percent' || (taxCard?.kind === 'table' && parseTableNumber(taxCard.table)?.twelveMonths);
  const monthLabel = (i: number) => new Date(year, i, 1).toLocaleString(locale, { month: 'short' });

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-4">
      <div className="pb-4 border-b border-[var(--border)]">
        <SectionLabel>{sp.taxCardTitle}</SectionLabel>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{sp.taxCardDesc}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Mode>
          ariaLabel={sp.taxCardTitle}
          value={mode}
          onChange={changeMode}
          items={[
            { value: 'none', label: sp.taxCardNone },
            { value: 'table', label: sp.taxCardTable },
            { value: 'percent', label: sp.taxCardPercent },
          ]}
        />
        {mode !== 'none' && (
          <div className="inline-flex items-center gap-2 h-8 px-3 rounded-[6px] border border-[var(--border)]">
            <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-[0.1em] shrink-0" style={{ color: 'var(--text-2)' }}>
              {mode === 'table' ? sp.taxCardTableLabel : sp.taxCardPercentLabel}
            </label>
            <input
              id={inputId}
              type="text"
              inputMode={mode === 'table' ? 'numeric' : 'decimal'}
              value={draft}
              placeholder={mode === 'table' ? '8130' : '30'}
              aria-invalid={error != null}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
              className="w-16 h-6 text-center rounded-[4px] border border-[var(--border)] bg-[var(--bg-raised)] text-[13px] font-mono text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[var(--positive)] placeholder:text-[var(--text-3)]"
            />
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--negative)' }}>{error}</p>}

      {summary && taxCard?.kind === mode && (
        <>
          <div
            className="text-[14px] font-semibold"
            style={{ color: summary.status === 'restskatt' ? 'var(--warning)' : summary.status === 'refund' ? 'var(--positive)' : 'var(--text-2)' }}
          >
            {(summary.status === 'restskatt' ? sp.restskattRestskatt
              : summary.status === 'refund' ? sp.restskattRefund
              : sp.restskattOnTrack)
              .replace('{amount}', formatCurrency(Math.round(Math.abs(summary.gap))))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
            <div className="min-w-0">
              <SectionLabel className="mb-1">{sp.taxCardThisMonth}</SectionLabel>
              <FitText className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(summary.thisWithheld)}</FitText>
            </div>
            <div className="min-w-0">
              <SectionLabel className="mb-1">{sp.taxCardNetThisMonth}</SectionLabel>
              <FitText className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(Math.round(summary.thisNet))}</FitText>
            </div>
            <div className="min-w-0">
              <SectionLabel className="mb-1">{sp.taxCardYearWithheld}</SectionLabel>
              <FitText className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(summary.yearWithheld)}</FitText>
            </div>
            <div className="min-w-0">
              <SectionLabel className="mb-1">{sp.restskattExpected}</SectionLabel>
              <FitText className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(Math.round(summary.expectedTax))}</FitText>
            </div>
          </div>
          <ol className="grid grid-cols-4 md:grid-cols-12 gap-2">
            {summary.months.map((v, i) => (
              <li
                key={i}
                className="min-w-0 rounded-[6px] border px-2 py-1.5"
                style={{ borderColor: i === currentMonth - 1 ? 'var(--accent)' : 'var(--border)' }}
              >
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{monthLabel(i)}</div>
                <FitText className="font-mono text-[12px] text-[var(--text-1)]">{formatCurrency(v)}</FitText>
              </li>
            ))}
          </ol>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {evenSpread ? sp.taxCardNoteEven : sp.taxCardNoteSplit.replace('{year}', String(trekkYear()))}
          </p>
        </>
      )}
    </Card>
  );
}
