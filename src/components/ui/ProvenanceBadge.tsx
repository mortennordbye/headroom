import { useFinance } from '../../context/FinanceContext';
import type { Provenance } from '../../lib/provenance';

const toneFor: Record<Provenance, { bg: string; color: string }> = {
  default: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  custom: { bg: 'var(--positive-bg)', color: 'var(--positive)' },
  estimate: { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-2)' },
};

interface ProvenanceBadgeProps {
  kind: Provenance;
  className?: string;
}

/** Small pill telling the user whether a value is a Default, their own (Yours), or an Estimate. */
export function ProvenanceBadge({ kind, className = '' }: ProvenanceBadgeProps) {
  const { t } = useFinance();
  const p = t.provenance;
  const label = kind === 'default' ? p.default : kind === 'custom' ? p.custom : p.estimate;
  const hint = kind === 'default' ? p.defaultHint : kind === 'custom' ? p.customHint : p.estimateHint;
  const tone = toneFor[kind];

  return (
    <span
      className={`inline-flex items-center rounded-[4px] font-semibold h-[18px] px-[7px] text-[10px] ${className}`}
      style={{ background: tone.bg, color: tone.color }}
      title={hint}
    >
      {label}
    </span>
  );
}
