import type { ReactNode } from 'react';

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`page-container mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-8 lg:py-6 ${className}`}>
      {children}
    </div>
  );
}
