import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { formatTnd } from '../lib/format';
import type { OverdueCustomerRecord } from '../services/customerService';

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
    ? dueDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Past due';

  return (
    <article className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="truncate font-body text-label-lg text-on-surface">{entry.customer.name}</h3>
        <p className="mt-1 font-body text-body-sm text-error-dark">
          {formatTnd(entry.balanceMillimes / 1000)} DT overdue since {dueDateLabel}
        </p>
        <p className="font-body text-body-xs text-on-surface-variant">
          Oldest unpaid entry: {entry.dueInfo.oldestUnpaidAt ? new Date(entry.dueInfo.oldestUnpaidAt).toLocaleDateString() : 'Unknown'}
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
          {busyAction === 'statement' ? 'Opening...' : 'Statement'}
        </Button>
        <Button
          variant="ghost"
          className="min-h-10 px-3 text-label-sm"
          icon={<MaterialIcon name="share" className="text-base" />}
          disabled={busyAction !== null}
          onClick={onShare}
        >
          {busyAction === 'share' ? 'Preparing...' : 'Share'}
        </Button>
      </div>
    </article>
  );
}
