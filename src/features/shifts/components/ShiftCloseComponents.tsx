import { useState, type FormEvent } from 'react';
import { Banknote, Ban, Calculator, CreditCard, Ellipsis, HandCoins, ReceiptText, Scale, UsersRound, WalletCards, type LucideIcon } from 'lucide-react';
import { Button } from '../../../components/Button';
import { DinarInput } from '../../../components/DinarInput';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import { parseNonNegativeMillimes } from '../../../lib/millimes';
import { t } from '../../../i18n/translations';
import type { CashMovementRecord, OrderRecord, ShiftRecord } from '../../../types/domain';
import { getCashMovementTotals, getExpectedCash, type ShiftCloseBreakdown } from '../utils/shiftCalculations';

export function ShiftCloseForm({
  shift,
  breakdown,
  movements,
  countedCash,
  differenceNote,
  onCountChange,
  onNoteChange,
  onSubmit,
  submitLabel,
  pendingVoidOrders,
  blind,
}: {
  shift: ShiftRecord;
  breakdown: ShiftCloseBreakdown;
  movements: CashMovementRecord[];
  countedCash: string;
  differenceNote: string;
  onCountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  pendingVoidOrders: OrderRecord[];
  blind: boolean;
}) {
  const [reviewed, setReviewed] = useState(false);
  const movementTotals = getCashMovementTotals(movements, shift.id);
  const expectedCash = getExpectedCash(shift, breakdown, movements);
  const countedCashMillimes = parseNonNegativeMillimes(countedCash);
  const difference = countedCashMillimes === undefined ? undefined : countedCashMillimes - expectedCash;
  const summaryRows: Array<{ label: string; amount: number; icon: LucideIcon; tone: string }> = [
    { label: 'Starting cash (float)', amount: shift.startingCashMillimes, icon: Banknote, tone: 'float' },
    { label: 'Cash sales', amount: breakdown.cashSalesMillimes, icon: ReceiptText, tone: 'cash-sales' },
    { label: 'Card sales', amount: breakdown.cardSalesMillimes, icon: CreditCard, tone: 'card-sales' },
    { label: 'Other sales', amount: breakdown.otherSalesMillimes, icon: Ellipsis, tone: 'other-sales' },
    { label: 'Tab sales (charged to customers, excluded from expected cash)', amount: breakdown.tabSalesMillimes, icon: UsersRound, tone: 'tab-sales' },
    { label: 'Tab payments received in cash', amount: breakdown.tabPaymentsMillimes, icon: WalletCards, tone: 'tab-payments' },
    { label: 'Cash in', amount: movementTotals.cashInMillimes, icon: HandCoins, tone: 'cash-in' },
    { label: 'Cash out', amount: movementTotals.cashOutMillimes, icon: HandCoins, tone: 'cash-out' },
    { label: 'Comps value', amount: breakdown.compsMillimes, icon: Scale, tone: 'comps' },
    { label: 'Voids', amount: breakdown.voidsMillimes, icon: Ban, tone: 'voids' },
  ];
  const countExampleId = `counted-cash-example-${shift.id}`;

  function submitOrReview(event: FormEvent<HTMLFormElement>) {
    if (!reviewed) {
      event.preventDefault();
      setReviewed(true);
      return;
    }
    onSubmit(event);
  }

  return (
    <form onSubmit={submitOrReview} className="close-shift-form">
      {breakdown.pendingVoidCount > 0 && (
        <section className="close-shift-pending-voids space-y-2 rounded-lg bg-warning-container p-3 text-on-warning-container">
          <h3 className="font-body text-label-md">Pending voids are treated as voided for sales and cash until rejected. Stock is held until approval.</h3>
          {pendingVoidOrders.map((order) => (
            <p key={order.id} className="font-body text-body-sm">
              #{order.number} · {formatTnd(order.totalMillimes / 1000)} DT · {order.voidReason || 'Reason not recorded'}
            </p>
          ))}
        </section>
      )}
      <section className="close-shift-summary" aria-labelledby={`close-shift-summary-${shift.id}`}>
        <h2 id={`close-shift-summary-${shift.id}`} className="close-shift-summary__heading">
          Close shift summary
        </h2>
        <div className="close-shift-summary__rows">
          {summaryRows.map(({ label, amount, icon: Icon, tone }) => (
            <div className={`close-shift-summary__row close-shift-summary__row--${tone}`} key={label}>
              <span className="close-shift-summary__icon" aria-hidden="true">
                <Icon size={22} strokeWidth={2.2} />
              </span>
              <span className="close-shift-summary__label">{label}</span>
              <span className="close-shift-summary__amount">{formatTnd(Math.abs(amount) / 1000)} DT</span>
            </div>
          ))}
        </div>
        {!blind && reviewed && countedCashMillimes !== undefined && (
          <div className="close-shift-summary__review" aria-live="polite">
            <div className="close-shift-summary__review-row">
              <span>Counted cash</span>
              <strong>{formatTnd(countedCashMillimes / 1000)} DT</strong>
            </div>
            <div className="close-shift-summary__review-row close-shift-summary__review-row--expected">
              <span>Expected cash in drawer</span>
              <strong>{formatTnd(expectedCash / 1000)} DT</strong>
            </div>
          </div>
        )}
      </section>
      <section className="close-shift-count">
        <span className="close-shift-count__icon" aria-hidden="true">
          <Calculator size={28} strokeWidth={2.1} />
        </span>
        <div className="close-shift-count__content">
          <label htmlFor={`counted-cash-${shift.id}`} className="close-shift-count__label">
            {t('shift.countedCash')} (TND)
          </label>
          <div className="close-shift-count__input-wrap">
            <DinarInput
              id={`counted-cash-${shift.id}`}
              required
              value={countedCash}
              onChange={(event) => onCountChange(event.target.value)}
              placeholder="e.g. 140.000"
              aria-describedby={countExampleId}
              className="close-shift-count__input"
            />
            <span className="close-shift-count__unit">DT</span>
          </div>
          <p id={countExampleId} className="close-shift-count__hint">
            Enter the cash counted in the drawer, for example 140.000.
          </p>
        </div>
      </section>
      {!blind && reviewed && difference !== undefined && (
        <p
          aria-live="polite"
          className={`close-shift-difference ${
            difference === 0 ? 'bg-success-container text-success-dark' :
              difference < 0 ? 'bg-error-container text-error-dark' : 'bg-warning-container text-on-warning-container'
          }`}
        >
          {difference === 0
            ? 'Balanced'
            : `${difference < 0 ? 'Short' : 'Over'} ${formatTnd(Math.abs(difference) / 1000)} DT`}
        </p>
      )}
      {!blind && reviewed && difference !== undefined && difference !== 0 && (
        <section className="close-shift-count close-shift-note-field">
          <span className="close-shift-count__icon" aria-hidden="true">
            <MaterialIcon name="edit_note" className="text-2xl" />
          </span>
          <div className="close-shift-count__content">
            <label htmlFor={`difference-note-${shift.id}`} className="close-shift-count__label">
              Short note (required)
            </label>
            <div className="close-shift-count__input-wrap close-shift-note-wrap">
              <textarea
                id={`difference-note-${shift.id}`}
                required
                maxLength={200}
                rows={2}
                value={differenceNote}
                onChange={(event) => onNoteChange(event.target.value)}
                className="close-shift-note"
              />
            </div>
          </div>
        </section>
      )}
      <div className="sheet-action-bar close-shift-actions">
        <Button type="submit" variant="primary" className="close-shift-submit w-full" disabled={countedCashMillimes === undefined || (reviewed && difference !== 0 && !differenceNote.trim())}>
          <Calculator size={22} strokeWidth={2.2} aria-hidden="true" />{reviewed ? submitLabel : 'Review count'}
        </Button>
      </div>
    </form>
  );
}

export function ClosedShiftSummary({
  shift,
  breakdown,
  onDone,
  blind,
}: {
  shift: ShiftRecord;
  breakdown: ShiftCloseBreakdown;
  onDone: () => void;
  blind: boolean;
}) {
  const closedAt = shift.closedAt ? new Date(shift.closedAt) : new Date(shift.openedAt);
  const durationMs = Math.max(0, closedAt.getTime() - new Date(shift.openedAt).getTime());
  const durationMinutes = Math.floor(durationMs / 60_000);
  const difference = shift.differenceMillimes ?? 0;
  return (
    <section className="shift-glass-card closed-shift-summary mb-4 rounded-2xl p-4">
      <div className="closed-shift-summary__identity">
        <span className="closed-shift-summary__icon" aria-hidden="true">
          <MaterialIcon name="task_alt" />
        </span>
        <div>
          <h2 className="font-display text-headline-md text-on-surface">Shift closed</h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            {durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h ` : ''}{durationMinutes % 60}m duration
          </p>
        </div>
      </div>
      <div className="closed-shift-summary__metrics">
        <SummaryValue icon="receipt_long" label="Orders" value={String(breakdown.orderCount)} />
        <SummaryValue
          icon="payments"
          label="Cash"
          value={blind
            ? 'Hidden'
            : shift.countedCashMillimes === undefined
              ? 'Not recorded'
              : `${formatTnd(shift.countedCashMillimes / 1000)} DT`}
          detail={blind
            ? 'Reconciliation available to the owner'
            : shift.expectedCashMillimes === undefined
              ? 'Expected cash not recorded'
              : `Expected ${formatTnd(shift.expectedCashMillimes / 1000)} DT`}
        />
        <SummaryValue icon="account_balance" label="Tabs" value={`${formatTnd(breakdown.tabSalesMillimes / 1000)} DT`} />
        <SummaryValue
          icon="balance"
          label="Difference"
          value={blind ? 'Hidden' : `${difference < 0 ? 'Short ' : difference > 0 ? 'Over ' : ''}${formatTnd(Math.abs(difference) / 1000)} DT`}
          valueClass={blind ? 'text-on-surface-variant' : difference === 0 ? 'text-success-dark' : difference < 0 ? 'text-error-dark' : 'text-warning'}
        />
      </div>
      <Button type="button" className="closed-shift-summary__done" onClick={onDone}>Done</Button>
    </section>
  );
}

function SummaryValue({ icon, label, value, valueClass = 'text-on-surface', detail }: {
  icon: string;
  label: string;
  value: string;
  valueClass?: string;
  detail?: string;
}) {
  return (
    <div className="closed-shift-summary__metric">
      <span className="closed-shift-summary__metric-icon" aria-hidden="true">
        <MaterialIcon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="font-body text-label-sm text-on-surface-variant">{label}</p>
        <p className={`mt-0.5 font-display text-title-md tabular-nums ${valueClass}`}>{value}</p>
        {detail && <p className="closed-shift-summary__detail font-body text-body-sm text-on-surface-variant">{detail}</p>}
      </div>
    </div>
  );
}
