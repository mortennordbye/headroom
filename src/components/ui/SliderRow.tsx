import { type ReactNode } from 'react';

/**
 * Labelled range slider showing the live value + suffix, with an optional
 * provenance `badge` next to the label. Shared by the Pension and Employer-cost
 * pages.
 */
export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  badge,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  badge?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{label}</label>
          {badge}
        </div>
        <span className="text-[18px] font-semibold tabular-nums">
          {value}
          {suffix && <span className="text-[12px] ml-1" style={{ color: 'var(--text-3)' }}>{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--accent)' }}
      />
    </div>
  );
}
