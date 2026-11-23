import type { ReactNode } from 'react';

export function SplitView({ list, detail, className = '' }: { list: ReactNode; detail: ReactNode; className?: string }) {
  return <div className={`split-view grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] ${className}`}><div className="min-w-0">{list}</div><div className="min-w-0">{detail}</div></div>;
}
