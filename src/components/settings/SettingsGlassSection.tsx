import type { ReactNode } from 'react';
import { MaterialIcon } from '../MaterialIcon';

interface SettingsGlassSectionProps {
  heading: string;
  description?: string;
  icon?: string;
  headingId?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  hidden?: boolean;
}

export function SettingsGlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`settings-glass-card ${className}`}>{children}</div>;
}

export function SettingsGlassList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`settings-glass-list ${className}`}>{children}</div>;
}

export function SettingsGlassSection({
  heading,
  description,
  icon,
  headingId,
  children,
  actions,
  className = '',
  hidden,
}: SettingsGlassSectionProps) {
  return (
    <section
      hidden={hidden}
      aria-labelledby={headingId}
      className={`settings-glass-section flex flex-col gap-4 rounded-2xl p-4 sm:p-5 ${className}`}
    >
      <header className="settings-glass-section__header flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="settings-glass-section__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <MaterialIcon name={icon} className="text-xl" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-headline-md text-on-surface">{heading}</h2>
            {description && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{description}</p>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="settings-glass-section__body flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
