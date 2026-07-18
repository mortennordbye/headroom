import React from 'react';
import { NavLink } from 'react-router-dom';

// One pill-segmented control for the whole app. Two rendering modes, same look:
//  • button mode  — in-page pick-one state (Bolig hub/mode, Settings currency).
//                   role="radiogroup"|"tablist" + aria-checked|selected.
//  • route mode   — sub-tab navigation between sibling routes (the nav strips).
//                   any item with `to` flips the whole control to <nav> + <NavLink>,
//                   which sets aria-current="page" and owns active state itself.

export interface SegItem<V extends string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** button mode only — dims and blocks the item. */
  disabled?: boolean;
  /** present on any item → the control renders as route-linking sub-tabs. */
  to?: string;
}

interface SegmentedControlProps<V extends string> {
  items: SegItem<V>[];
  /** controlled selection (button mode). */
  value?: V;
  /** button mode change handler. */
  onChange?: (value: V) => void;
  ariaLabel?: string;
  /** button mode only; ignored in route mode. */
  role?: 'radiogroup' | 'tablist';
  /** container background token; defaults to the shared --surface-2. */
  bg?: string;
  className?: string;
}

const containerBase = 'inline-flex p-1 rounded-[8px] border flex-wrap gap-1';
const itemBase =
  'flex items-center gap-2 px-4 h-8 rounded-[6px] text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

function itemStyle(active: boolean): React.CSSProperties {
  return active
    ? { background: 'var(--text-1)', color: 'var(--bg-page)', fontWeight: 600 }
    : { background: 'transparent', color: 'var(--text-2)', fontWeight: 500 };
}

export function SegmentedControl<V extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  role = 'radiogroup',
  bg = 'var(--surface-2)',
  className = '',
}: SegmentedControlProps<V>) {
  const containerClass = `${containerBase} ${className}`.trim();
  const containerStyle: React.CSSProperties = { background: bg, borderColor: 'var(--border)' };
  const routeMode = items.some(it => it.to !== undefined);

  if (routeMode) {
    return (
      <nav className={containerClass} style={containerStyle} aria-label={ariaLabel}>
        {items.map(({ value: v, label, icon, to }) => (
          <NavLink
            key={v}
            to={to!}
            end={to === '/'}
            className={itemBase}
            style={({ isActive }) => itemStyle(isActive)}
          >
            {icon}
            {label}
          </NavLink>
        ))}
      </nav>
    );
  }

  const itemRole = role === 'tablist' ? 'tab' : 'radio';
  return (
    <div className={containerClass} style={containerStyle} role={role} aria-label={ariaLabel}>
      {items.map(({ value: v, label, icon, disabled }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role={itemRole}
            aria-selected={role === 'tablist' ? active : undefined}
            aria-checked={role === 'radiogroup' ? active : undefined}
            disabled={disabled}
            onClick={() => onChange?.(v)}
            className={itemBase}
            style={itemStyle(active)}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
