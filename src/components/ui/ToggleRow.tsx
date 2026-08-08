import React from 'react';

// A labelled on/off switch with an optional hint and trailing detail line.
// Used for the balance-automation controls (Pension page per-target opt-in,
// Settings master switch), which all need the same shape: a real `role="switch"`
// button, a description of what turning it on will do, and a status line.

interface Props {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Explains what the toggle does — always visible, not a tooltip. */
  hint?: string;
  /** Status line under the hint (e.g. "Last posted 2026-07"). */
  detail?: string;
  /** Greys the control out and blocks the click (e.g. no salary recorded yet). */
  disabled?: boolean;
}

export const ToggleRow: React.FC<Props> = ({ label, checked, onChange, hint, detail, disabled }) => (
  <div className="flex items-start justify-between gap-4" style={{ opacity: disabled ? 0.55 : 1 }}>
    <div className="min-w-0">
      <span className="block text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>{label}</span>
      {hint && <span className="block text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      {detail && <span className="block text-[11px] mt-1 font-mono" style={{ color: 'var(--text-3)' }}>{detail}</span>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 w-[42px] h-[24px] rounded-full transition-colors disabled:cursor-not-allowed"
      style={{
        background: checked ? 'var(--forest)' : 'var(--bg-raised)',
        border: `1px solid ${checked ? 'var(--forest)' : 'var(--border)'}`,
      }}
    >
      <span
        className="absolute top-[2px] w-[18px] h-[18px] rounded-full transition-[left]"
        style={{ left: checked ? '21px' : '2px', background: checked ? 'var(--text)' : 'var(--text-2)' }}
      />
    </button>
  </div>
);
