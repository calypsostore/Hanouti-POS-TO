import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import type { OverdueCustomerRecord } from '../services/customerService';
import { getLanguage, t } from '../i18n';

function formatCustomerTnd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(getLanguage(), {
    useGrouping: true,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amount);
}

type OverdueAction = 'statement' | 'share' | null;

export function OverdueCustomerRow({
  entry,
  onStatement,
  onShare,
  busyAction = null,
}: {
  entry: OverdueCustomerRecord;
  onStatement: () => void;
  onShare: () => void;
  busyAction?: OverdueAction;
}) {
  const dueDate = entry.dueInfo.nextDueAt ? new Date(entry.dueInfo.nextDueAt) : undefined;
  const dueDateLabel = dueDate && !Number.isNaN(dueDate.getTime())
    ? dueDate.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })
    : t('customers.overdue.pastDue');

  return (
    <article className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="truncate font-body text-label-lg text-on-surface">{entry.customer.name}</h3>
        <p className="mt-1 font-body text-body-sm text-error-dark">
          {t('customers.overdue.since', { amount: formatCustomerTnd(entry.balanceMillimes / 1000), date: dueDateLabel })}
        </p>
        <p className="font-body text-body-xs text-on-surface-variant">
          {t('customers.overdue.oldestUnpaid', { date: entry.dueInfo.oldestUnpaidAt ? new Date(entry.dueInfo.oldestUnpaidAt).toLocaleDateString(getLanguage()) : t('customers.overdue.unknownDate') })}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="secondary"
          className="min-h-10 px-3 text-label-sm"
          icon={<MaterialIcon name="description" className="text-base" />}
          disabled={busyAction !== null}
          onClick={onStatement}
        >
          {busyAction === 'statement' ? t('customers.overdue.opening') : t('customers.action.statement')}
        </Button>
        <Button
          variant="ghost"
          className="min-h-10 px-3 text-label-sm"
          icon={<MaterialIcon name="share" className="text-base" />}
          disabled={busyAction !== null}
          onClick={onShare}
        >
          {busyAction === 'share' ? t('customers.overdue.preparing') : t('customers.overdue.share')}
        </Button>
      </div>
    </article>
  );
}
