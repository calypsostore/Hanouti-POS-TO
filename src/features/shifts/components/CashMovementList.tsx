import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import type { CashMovementReason, CashMovementRecord } from '../../../types/domain';

export function CashMovementList({ movements, staffNames, className = '', presentation = 'default', onShowMore }: {
  movements: CashMovementRecord[];
  staffNames: Record<string, string>;
  className?: string;
  presentation?: 'default' | 'modal';
  onShowMore?: () => void;
}) {
  const reasonLabel = (reason: CashMovementReason) => {
    if (reason === 'supplier') return 'Bought milk';
    if (reason === 'change') return 'Change float';
    if (reason === 'expense') return 'Expense';
    return 'Other';
  };
  const isModal = presentation === 'modal';
  const visibleMovements = isModal ? movements : movements.slice(0, 2);
  return (
    <section className={`mt-4 w-full border-t border-outline-variant pt-3 ${className}`}>
      <h3 className="mb-2 font-body text-label-md text-on-surface">Cash movements</h3>
      {movements.length > 0 ? (
        <ul className={`flex flex-col gap-2${isModal ? ' cash-movement-history-transactions' : ''}`}>
          {visibleMovements.map((movement) => (
            <li
              key={movement.id}
              className={`shift-history-card__movement flex items-start justify-between gap-3 rounded-lg bg-surface-container-low p-3${isModal ? ` cash-movement-history-card cash-movement-history-card--${movement.kind}` : ''}`}
            >
              {isModal && (
                <span className={`cash-movement-history-icon cash-movement-history-icon--${movement.kind}`}>
                  <MaterialIcon name={movement.kind === 'in' ? 'payments' : 'shopping_bag'} />
                </span>
              )}
              <div className="shift-history-card__movement-copy min-w-0">
                <p className="font-body text-label-md text-on-surface">
                  {movement.kind === 'in' ? 'Cash in' : 'Cash out'} · {reasonLabel(movement.reason)}
                </p>
                <p className={`mt-0.5 font-body text-body-sm text-outline${isModal ? ' cash-movement-history-meta' : ''}`}>
                  {isModal && <MaterialIcon name="schedule" />}
                  {staffNames[movement.staffId] ?? 'Staff'} · {new Date(movement.createdAt).toLocaleString()}
                </p>
                {movement.note && <p className="mt-0.5 break-words font-body text-body-sm text-on-surface-variant">{movement.note}</p>}
              </div>
              <strong className={`shrink-0 font-display tabular-nums ${movement.kind === 'in' ? 'text-success-dark' : 'text-error-dark'}${isModal ? ` cash-movement-history-amount cash-movement-history-amount--${movement.kind}` : ''}`}>
                {movement.kind === 'in' ? '+' : '−'}{formatTnd(movement.amountMillimes / 1000)} DT
              </strong>
            </li>
          ))}
        </ul>
      ) : <p className="font-body text-body-sm text-outline">No cash movements for this shift.</p>}
      {!isModal && movements.length > visibleMovements.length && onShowMore && (
        <button type="button" className="shift-history-card__movements-show-more" onClick={onShowMore}>
          Show more <MaterialIcon name="chevron_right" />
        </button>
      )}
    </section>
  );
}
