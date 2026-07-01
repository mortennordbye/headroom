import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const sizeMap: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-9 px-4 text-[13px]',
  lg: 'h-11 px-5 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', leadingIcon, trailingIcon, className = '', style, children, disabled, ...rest },
  ref,
) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[6px] font-medium select-none cursor-pointer transition-[background,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  let variantClass: string;
  let variantStyle: React.CSSProperties;

  if (variant === 'primary') {
    // Forest fill — not brass (brass is reserved for totals/active-nav/warnings).
    variantClass = 'font-semibold border';
    variantStyle = {
      background: 'var(--forest)',
      borderColor: 'var(--forest)',
      color: 'var(--text)',
    };
  } else if (variant === 'secondary') {
    variantClass = 'border';
    variantStyle = {
      background: 'var(--bg-2)',
      borderColor: 'var(--rule)',
      color: 'var(--text-1)',
    };
  } else if (variant === 'ghost') {
    variantClass = 'border-0 hover:bg-[var(--bg-2)]';
    variantStyle = { background: 'transparent', color: 'var(--text-2)' };
  } else {
    variantClass = 'border';
    variantStyle = {
      background: 'var(--negative-bg)',
      borderColor: 'color-mix(in srgb, var(--negative) 45%, transparent)',
      color: 'var(--negative)',
    };
  }

  return (
    <button
      ref={ref}
      className={`${base} ${sizeMap[size]} ${variantClass} ${className}`}
      style={{ ...variantStyle, ...style }}
      disabled={disabled}
      {...rest}
    >
      {leadingIcon && <span className="flex items-center [&_svg]:w-[14px] [&_svg]:h-[14px]">{leadingIcon}</span>}
      {children}
      {trailingIcon && <span className="flex items-center [&_svg]:w-[14px] [&_svg]:h-[14px]">{trailingIcon}</span>}
    </button>
  );
});
