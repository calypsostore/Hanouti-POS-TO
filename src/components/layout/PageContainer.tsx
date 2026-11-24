import type { ReactNode } from 'react';

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`page-container mx-auto w-full max-w-[var(--page-max-width)] px-[var(--page-gutter-mobile)] py-[var(--section-gap)] tablet:px-[var(--page-gutter-tablet)] lg:px-[var(--page-gutter-desktop)] lg:py-[var(--section-gap)] ${className}`}>
      {children}
    </div>
  );
}
