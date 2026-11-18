import type { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, className = '', children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 font-body text-label-md transition active:scale-[0.98] ${
        selected
          ? 'border-primary bg-primary text-on-primary'
          : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
