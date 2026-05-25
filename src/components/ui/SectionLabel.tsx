import type { HTMLAttributes, ReactNode } from 'react';

interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  children: ReactNode;
}

export function SectionLabel({ icon, children, className = '', ...rest }: SectionLabelProps) {
  return (
    <div
      className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}
      style={{ color: 'var(--text-3)' }}
      {...rest}
    >
      {icon && <span className="flex items-center [&_svg]:w-3 [&_svg]:h-3">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}
