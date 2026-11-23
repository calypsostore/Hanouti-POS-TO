import type { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  compact?: boolean;
}

export function Chip({ selected = false, compact = false, className = '', children, ...props }: ChipProps) {
  const appearance = selected
    ? 'border-primary bg-primary text-on-primary'
    : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container';
  if (compact) {
    return (
      <button
        type="button"
        className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full p-0 transition active:scale-[0.98] ${className}`}
        {...props}
      >
        <span className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 font-body text-label-sm ${appearance}`}>
          {children}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 font-body text-label-md transition active:scale-[0.98] ${appearance} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
