import { Edit2 } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  sublabel?: React.ReactNode;
  accent?: boolean;
  editable?: boolean;
  onEdit?: () => void;
  /** Accessible name for the edit button (translated by the caller). */
  editLabel?: string;
}

/**
 * A labelled stat tile (title + big value + optional sublabel/edit). Named
 * StatCard so it doesn't shadow the layout `ui/Card` primitive.
 */
export function StatCard({ title, value, sublabel, accent, editable, onEdit, editLabel }: StatCardProps) {
  // The highlighted stat is set apart by a brass hairline only — no glow, no gradient.
  const accentStyle: React.CSSProperties = accent
    ? { background: 'var(--bg-3)', borderColor: 'var(--brass-dim)' }
    : { background: 'var(--bg-card)', borderColor: 'var(--border)' };

  return (
    <div
      className="p-5 md:p-6 rounded-[8px] border flex flex-col gap-3"
      style={accentStyle}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent ? 'var(--brass)' : 'var(--text-3)' }}
      >
        {title}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[24px] md:text-[28px] font-mono font-medium tracking-[-0.02em] leading-none tabular-nums"
          style={{ color: 'var(--text-1)' }}
        >
          {value}
        </span>
        {editable && (
          <button
            onClick={onEdit}
            className="p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
            aria-label={editLabel}
          >
            <Edit2 size={13} />
          </button>
        )}
      </div>
      {sublabel && (
        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
