import type { LucideIcon } from 'lucide-react';
import { DinarInput } from '../../../components/DinarInput';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import { t } from '../../../i18n/translations';
import { ticketT } from '../../../i18n/tickets';

export function Metric({ label, amount, prominent = false, signed = false, icon, className, hidden = false }: { label: string; amount: number; prominent?: boolean; signed?: boolean; icon?: string; className?: string; hidden?: boolean }) {
  const formatted = formatTnd(Math.abs(amount) / 1000);
  const prefix = signed && amount > 0 ? '+' : signed && amount < 0 ? '−' : '';
  return (
    <div className={icon ? `shift-current-metric${prominent ? ' shift-current-metric--prominent' : ''}` : `flex items-baseline justify-between gap-2${className ? ` ${className}` : ''}`}>
      {icon && <span className="shift-current-metric__icon"><MaterialIcon name={icon} /></span>}
      <span className={`font-body text-body-sm text-on-surface-variant${icon ? ' shift-current-metric__label' : ''}`}>{label}</span>
      <span aria-label={hidden ? t('shift.hidden') : undefined} className={`font-display tabular-nums ${prominent ? 'text-headline-md text-primary' : 'text-title-md text-on-surface'} ${signed && amount !== 0 ? 'text-error-dark' : ''}`}>{hidden ? '*****' : `${prefix}${formatted} DT`}</span>
    </div>
  );
}

export function ZReportCountField({ id, label, value, onChange, icon: Icon }: { id: string; label: string; value: string; onChange: (value: string) => void; icon: LucideIcon }) {
  return (
    <section className="close-shift-count z-report-count">
      <span className="close-shift-count__icon" aria-hidden="true">
        <Icon size={28} strokeWidth={2.1} />
      </span>
      <div className="close-shift-count__content">
        <label htmlFor={id} className="close-shift-count__label">{label}</label>
        <div className="close-shift-count__input-wrap">
          <DinarInput
            id={id}
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={ticketT('e.g. 140.000')}
            className="close-shift-count__input"
          />
          <span className="close-shift-count__unit">DT</span>
        </div>
      </div>
    </section>
  );
}
