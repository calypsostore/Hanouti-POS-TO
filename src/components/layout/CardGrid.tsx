import type { ReactNode } from 'react';

export function CardGrid({ children, columns = 3, className = '' }: { children: ReactNode; columns?: 3 | 4; className?: string }) {
  return (
    <div className={`card-grid grid grid-cols-1 gap-[var(--card-gap)] md:grid-cols-2 ${columns === 4 ? '2xl:grid-cols-4' : 'xl:grid-cols-3'} ${className}`}>
      {children}
    </div>
  );
}
