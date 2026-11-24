import type { ReactNode } from 'react';

interface SettingsGlassSectionProps {
  id?: string;
  heading: string;
  description?: string;
  icon?: string;
  headingId?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  hidden?: boolean;
}

export function SettingsGlassSection({
  id,
  heading,
  description,
  headingId,
  children,
  actions,
  className = '',
  hidden,
}: SettingsGlassSectionProps) {
  return (
    <section
      id={id}
      hidden={hidden}
      aria-labelledby={headingId}
      className={`settings-section flex flex-col gap-[var(--section-gap)] rounded-[var(--card-radius)] bg-surface-container-lowest p-[var(--card-padding)] shadow-card ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-headline-md text-on-surface">{heading}</h2>
            {description && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{description}</p>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="flex min-w-0 flex-col gap-[var(--space-md)]">{children}</div>
    </section>
  );
}
