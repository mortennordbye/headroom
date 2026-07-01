import { forwardRef, type HTMLAttributes } from 'react';

type Variant = 'default' | 'hero' | 'flat';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  glow?: 'accent' | 'violet' | 'positive' | 'warning' | 'none';
}

const padMap = {
  none: '',
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-8',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  // `glow` kept for API compatibility but is a no-op — the old-money theme uses
  // no colored gradients; a hero panel is distinguished by a brass hairline only.
  { variant = 'default', padding = 'md', glow: _glow = 'none', className = '', style, children, ...rest },
  ref,
) {
  const base = 'rounded-[8px] border transition-[border-color] duration-200';

  const variantStyle: React.CSSProperties =
    variant === 'hero'
      ? { background: 'var(--bg-3)', borderColor: 'var(--brass-dim)' }
      : variant === 'flat'
        ? { background: 'transparent', borderColor: 'var(--rule)' }
        : { background: 'var(--bg-2)', borderColor: 'var(--rule)' };

  return (
    <div
      ref={ref}
      className={`${base} ${padMap[padding]} ${className}`}
      style={{ ...variantStyle, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
});
