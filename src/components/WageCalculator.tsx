import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Card, SectionLabel, SegmentedControl } from './ui';
import { useFinanceSettings } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';
import { fromAnnual, toAnnual, WAGE_UNIT_ORDER, type WageUnit } from '../lib/wageUnits';

type Mode = 'current' | 'custom';

// Decimal places shown per unit — whole kroner down to the day, fractions below.
const UNIT_DECIMALS: Record<WageUnit, number> = {
  year: 0,
  month: 0,
  week: 0,
  day: 0,
  hour: 2,
  minute: 2,
  second: 4,
};

/**
 * Bidirectional wage-unit calculator. A single canonical `annual` value drives
 * seven linked rows (year → second); editing any row re-derives the rest via
 * `toAnnual`/`fromAnnual`. Page-local what-if state — nothing persists.
 */
export function WageCalculator({ currentAnnual }: { currentAnnual: number }) {
  const { t, lang } = useFinanceSettings();
  const c = t.wageCalc;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';

  const hasCurrent = currentAnnual > 0;
  const [mode, setMode] = useState<Mode>(hasCurrent ? 'current' : 'custom');
  const [customAnnual, setCustomAnnual] = useState<number>(currentAnnual);
  // The row being edited: show its raw draft; every other row shows a derived value.
  const [editing, setEditing] = useState<{ unit: WageUnit; draft: string } | null>(null);

  // "From current salary" tracks the live figure; "custom" holds the user's number.
  const annual = mode === 'current' ? currentAnnual : customAnnual;

  const displayValue = (unit: WageUnit): string => {
    if (editing?.unit === unit) return editing.draft;
    return fromAnnual(annual, unit).toLocaleString(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: UNIT_DECIMALS[unit],
    });
  };

  const beginEdit = (unit: WageUnit) => {
    const raw = fromAnnual(annual, unit).toLocaleString(locale, {
      useGrouping: false,
      maximumFractionDigits: UNIT_DECIMALS[unit],
    });
    setEditing({ unit, draft: raw });
  };

  const commit = (unit: WageUnit, draft: string) => {
    const parsed = parseLocaleNumber(draft.replace(/\s/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) {
      setCustomAnnual(toAnnual(parsed, unit));
      setMode('custom'); // any manual edit detaches from the live salary
    }
    setEditing(null);
  };

  const modes = [
    { value: 'current' as const, label: c.fromCurrent, disabled: !hasCurrent },
    { value: 'custom' as const, label: c.custom },
  ];

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-4">
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--border)] flex-wrap">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <SectionLabel>{c.title}</SectionLabel>
        </div>
        <SegmentedControl
          items={modes}
          value={mode}
          onChange={(m) => {
            setEditing(null);
            setMode(m);
          }}
          ariaLabel={c.title}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {WAGE_UNIT_ORDER.map((unit) => (
          <div key={unit}>
            <label
              className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2"
              style={{ color: 'var(--text-3)' }}
              htmlFor={`wage-${unit}`}
            >
              {c[unit]}
            </label>
            <div className="relative">
              <input
                id={`wage-${unit}`}
                type="text"
                inputMode="decimal"
                value={displayValue(unit)}
                onFocus={() => beginEdit(unit)}
                onChange={(e) => setEditing({ unit, draft: e.target.value })}
                onBlur={(e) => commit(unit, e.target.value)}
                className="w-full h-10 pl-3 pr-10 rounded-[8px] text-[14px] font-mono outline-none border focus:border-[var(--accent)]"
                style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono pointer-events-none"
                style={{ color: 'var(--text-3)' }}
              >
                kr
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{c.footnote}</p>
    </Card>
  );
}
