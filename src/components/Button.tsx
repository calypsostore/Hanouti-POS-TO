import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-card hover:bg-primary-pressed',
  secondary: 'bg-surface-container-high text-primary hover:bg-surface-dim',
  danger: 'bg-error-container text-on-error-container hover:bg-red-200',
  ghost: 'bg-transparent text-on-surface-variant hover:bg-surface-container',
};

export function Button({
  variant = 'primary',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 font-body text-label-lg transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
