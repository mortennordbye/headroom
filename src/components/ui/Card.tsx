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
  { variant = 'default', padding = 'md', glow = 'none', className = '', style, children, ...rest },
  ref,
) {
  const base = 'rounded-[20px] border transition-[border-color,transform,box-shadow] duration-200';

  const variantStyle: React.CSSProperties =
    variant === 'hero'
      ? {
          background:
            'radial-gradient(circle at 90% 10%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 60%), radial-gradient(circle at 10% 100%, color-mix(in srgb, var(--violet) 25%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--violet) 8%, transparent)), var(--bg-card)',
          borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
        }
      : variant === 'flat'
        ? { background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }
        : { background: 'var(--bg-card)', borderColor: 'var(--border)' };

  const glowBg =
    glow === 'none'
      ? null
      : `linear-gradient(135deg, color-mix(in srgb, var(--${glow}) 10%, transparent), transparent 70%), var(--bg-card)`;
  if (glowBg && variant === 'default') {
    variantStyle.background = glowBg;
  }

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
