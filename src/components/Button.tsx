import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-card hover:bg-primary-pressed',
  secondary: 'bg-surface-container-high text-primary hover:bg-surface-dim',
  success: 'bg-success-dark text-on-primary shadow-card hover:bg-success',
  danger: 'bg-error-container text-on-error-container hover:bg-error',
  ghost: 'bg-transparent text-on-surface-variant hover:bg-surface-container',
};

const sizes: Record<ButtonSize, string> = {
  small: 'min-h-[var(--button-height-small)] px-[var(--button-padding-small)] text-label-md',
  medium: 'min-h-[var(--button-height-medium)] px-[var(--button-padding-medium)] text-label-lg',
  large: 'min-h-[var(--button-height-large)] px-[var(--button-padding-large)] text-label-lg',
};

export function Button({
  variant = 'primary',
  size = 'medium',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-body transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
