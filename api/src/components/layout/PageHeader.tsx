import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`page-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${className}`}>
      <div className="min-w-0">
        <h1 className="font-display text-headline-lg text-on-surface lg:text-headline-md">{title}</h1>
        {subtitle && <p className="mt-1 font-body text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">{actions}</div>}
    </header>
  );
}
