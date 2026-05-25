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
    'inline-flex items-center justify-center gap-2 rounded-full font-medium select-none cursor-pointer transition-[transform,background,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  let variantClass = '';
  let variantStyle: React.CSSProperties = {};

  if (variant === 'primary') {
    variantClass = 'text-[#08080A] font-semibold border-0 hover:-translate-y-px';
    variantStyle = {
      background: 'linear-gradient(135deg, var(--accent), var(--violet))',
      boxShadow: '0 6px 20px color-mix(in srgb, var(--violet) 35%, transparent)',
    };
  } else if (variant === 'secondary') {
    variantClass = 'border';
    variantStyle = {
      background: 'rgba(255,255,255,0.05)',
      borderColor: 'var(--border)',
      color: 'var(--text-1)',
    };
  } else if (variant === 'ghost') {
    variantClass = 'border-0 hover:bg-[rgba(255,255,255,0.04)]';
    variantStyle = { background: 'transparent', color: 'var(--text-2)' };
  } else {
    variantClass = 'border';
    variantStyle = {
      background: 'var(--negative-bg)',
      borderColor: 'color-mix(in srgb, var(--negative) 40%, transparent)',
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
