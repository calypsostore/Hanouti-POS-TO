import type { ReactNode } from 'react';

export function StatGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`stat-grid grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6 ${className}`}>{children}</div>;
}
