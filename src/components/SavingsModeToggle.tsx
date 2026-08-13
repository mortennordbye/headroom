import React from 'react';

// How a savings row is sized: a share of the savings base, a fixed number of
// kroner, or whatever the other rows leave of the savings target. Shared by the
// allocation panel and the expense dialog so one saving means the same thing in
// both places.
export type SavingsMode = 'percent' | 'amount' | 'rest';

export interface SavingsModeLabels {
  group: string;
  percent: string;
  amount: string;
  rest: string;
  percentHint: string;
  amountHint: string;
  restHint: string;
}

/**
 * The %/kr/rest switch. Every option is always visible with the active one
 * filled — a single button showing only the current unit read as a label rather
 * than a control, so the choice that makes a transfer follow income went
 * unnoticed. `modes` narrows the set for a surface where one of them is
 * meaningless.
 */
export function SavingsModeToggle({ mode, onChange, modes, labels, size = 'sm' }: {
  mode: SavingsMode;
  onChange: (m: SavingsMode) => void;
  modes: SavingsMode[];
  labels: SavingsModeLabels;
  /** 'md' for the roomier dialog form; 'sm' for the dense panel rows. */
  size?: 'sm' | 'md';
}) {
  const text: Record<SavingsMode, string> = { percent: labels.percent, amount: labels.amount, rest: labels.rest };
  const hint: Record<SavingsMode, string> = { percent: labels.percentHint, amount: labels.amountHint, rest: labels.restHint };
  return (
    <div
      role="group"
      aria-label={labels.group}
      className="inline-flex rounded-[9px] border border-[var(--border)] overflow-hidden"
    >
      {modes.map((m, i) => (
        <React.Fragment key={m}>
          {i > 0 && <span aria-hidden className="w-px" style={{ background: 'var(--border)' }} />}
          <button
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={mode === m}
            title={hint[m]}
            className={`font-medium transition-colors ${size === 'md' ? 'px-3 py-1.5 text-[12.5px]' : 'px-2 py-1 text-[12px]'}`}
            style={{
              background: mode === m ? 'var(--bg-elev)' : 'transparent',
              color: mode === m ? 'var(--text-1)' : 'var(--text-3)',
            }}
          >
            {text[m]}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
