import { useEffect, useState, type FormEvent } from 'react';
import { Banknote, Ban, Calculator, CreditCard, Ellipsis, HandCoins, ReceiptText, Scale, UsersRound, WalletCards, type LucideIcon } from 'lucide-react';
import { Button } from '../../../components/Button';
import { DinarInput } from '../../../components/DinarInput';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import { parseNonNegativeMillimes } from '../../../lib/millimes';
import { t } from '../../../i18n/translations';
import type { CashMovementRecord, OrderRecord, ShiftRecord } from '../../../types/domain';
import { shouldRequireShiftReview } from '../../../lib/shiftClosePolicy';
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
  useEffect(() => {
    setReviewed(false);
  }, [countedCash, shift.id]);
  const summaryRows: Array<{ label: string; amount: number; icon: LucideIcon; tone: string }> = [
    { label: t('shift.startingFloat'), amount: shift.startingCashMillimes, icon: Banknote, tone: 'float' },
    { label: t('shift.cashSales'), amount: breakdown.cashSalesMillimes, icon: ReceiptText, tone: 'cash-sales' },
    { label: t('shift.cardSales'), amount: breakdown.cardSalesMillimes, icon: CreditCard, tone: 'card-sales' },
    { label: t('shift.otherSales'), amount: breakdown.otherSalesMillimes, icon: Ellipsis, tone: 'other-sales' },
    { label: t('shift.tabSalesHelp'), amount: breakdown.tabSalesMillimes, icon: UsersRound, tone: 'tab-sales' },
    { label: t('shift.tabPaymentsCash'), amount: breakdown.tabPaymentsMillimes, icon: WalletCards, tone: 'tab-payments' },
    { label: t('shift.cashIn'), amount: movementTotals.cashInMillimes, icon: HandCoins, tone: 'cash-in' },
    { label: t('shift.cashOut'), amount: movementTotals.cashOutMillimes, icon: HandCoins, tone: 'cash-out' },
    { label: t('shift.compsValue'), amount: breakdown.compsMillimes, icon: Scale, tone: 'comps' },
    { label: t('shift.voids'), amount: breakdown.voidsMillimes, icon: Ban, tone: 'voids' },
  ];
  const countExampleId = `counted-cash-example-${shift.id}`;

  function submitOrReview(event: FormEvent<HTMLFormElement>) {
    if (blind) {
      onSubmit(event);
      return;
    }
    if (shouldRequireShiftReview(blind, reviewed)) {
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
          <h3 className="font-body text-label-md">{t('shift.pendingVoidHelp')}</h3>
          {pendingVoidOrders.map((order) => (
            <p key={order.id} className="font-body text-body-sm">
              #{order.number} · {blind ? '*****' : `${formatTnd(order.totalMillimes / 1000)} DT`} · {order.voidReason || t('shift.reasonNotRecorded')}
            </p>
          ))}
        </section>
      )}
      <section className="close-shift-summary" aria-labelledby={`close-shift-summary-${shift.id}`}>
        <h2 id={`close-shift-summary-${shift.id}`} className="close-shift-summary__heading">
          {t('shift.closeSummary')}
        </h2>
        <div className="close-shift-summary__rows">
          {summaryRows.map(({ label, amount, icon: Icon, tone }) => (
            <div className={`close-shift-summary__row close-shift-summary__row--${tone}`} key={label}>
              <span className="close-shift-summary__icon" aria-hidden="true">
                <Icon size={22} strokeWidth={2.2} />
              </span>
              <span className="close-shift-summary__label">{label}</span>
              <span className="close-shift-summary__amount" aria-label={blind ? t('shift.hidden') : undefined}>
                {blind ? '*****' : `${formatTnd(Math.abs(amount) / 1000)} DT`}
              </span>
            </div>
          ))}
        </div>
        {!blind && reviewed && countedCashMillimes !== undefined && (
          <div className="close-shift-summary__review" aria-live="polite">
            <div className="close-shift-summary__review-row">
              <span>{t('shift.countedCash')}</span>
              <strong>{formatTnd(countedCashMillimes / 1000)} DT</strong>
            </div>
            <div className="close-shift-summary__review-row close-shift-summary__review-row--expected">
              <span>{t('shift.expectedCashDrawer')}</span>
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
              placeholder={t('shift.enterCashPlaceholder')}
              aria-describedby={countExampleId}
              className="close-shift-count__input"
            />
            <span className="close-shift-count__unit">DT</span>
          </div>
          <p id={countExampleId} className="close-shift-count__hint">
            {t('shift.enterCashHint')}
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
            ? t('shift.balanced')
            : t(difference < 0 ? 'shift.short' : 'shift.over', { amount: `${formatTnd(Math.abs(difference) / 1000)} DT` })}
        </p>
      )}
      {!blind && reviewed && difference !== undefined && difference !== 0 && (
        <section className="close-shift-count close-shift-note-field">
          <span className="close-shift-count__icon" aria-hidden="true">
            <MaterialIcon name="edit_note" className="text-2xl" />
          </span>
          <div className="close-shift-count__content">
            <label htmlFor={`difference-note-${shift.id}`} className="close-shift-count__label">
              {t('shift.shortNoteRequired')}
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
        <Button type="submit" variant="primary" className="close-shift-submit w-full" disabled={countedCashMillimes === undefined || (!blind && reviewed && difference !== 0 && !differenceNote.trim())}>
          <Calculator size={22} strokeWidth={2.2} aria-hidden="true" />{blind || reviewed ? submitLabel : t('shift.reviewCount')}
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
          <h2 className="font-display text-headline-md text-on-surface">{t('shift.closedTitle')}</h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            {t('shift.durationLabel', { duration: durationMinutes >= 60
              ? t('shift.durationHoursMinutes', { hours: Math.floor(durationMinutes / 60), minutes: durationMinutes % 60 })
              : t('shift.durationMinutes', { minutes: durationMinutes }) })}
          </p>
        </div>
      </div>
      <div className="closed-shift-summary__metrics">
        <SummaryValue icon="receipt_long" label={t('shift.orders')} value={String(breakdown.orderCount)} />
        <SummaryValue
          icon="payments"
          label={t('shift.cash')}
          value={blind
            ? t('shift.hidden')
            : shift.countedCashMillimes === undefined
              ? t('shift.notRecorded')
              : `${formatTnd(shift.countedCashMillimes / 1000)} DT`}
          detail={blind
            ? t('shift.reconciliationOwner')
            : shift.expectedCashMillimes === undefined
              ? t('shift.expectedNotRecorded')
              : t('shift.expected', { amount: `${formatTnd(shift.expectedCashMillimes / 1000)} DT` })}
        />
        <SummaryValue icon="account_balance" label={t('shift.tabs')} value={blind ? '*****' : `${formatTnd(breakdown.tabSalesMillimes / 1000)} DT`} />
        <SummaryValue
          icon="balance"
          label={t('shift.difference')}
          value={blind ? t('shift.hidden') : difference < 0
            ? t('shift.short', { amount: `${formatTnd(Math.abs(difference) / 1000)} DT` })
            : difference > 0
              ? t('shift.over', { amount: `${formatTnd(Math.abs(difference) / 1000)} DT` })
              : `${formatTnd(Math.abs(difference) / 1000)} DT`}
          valueClass={blind ? 'text-on-surface-variant' : difference === 0 ? 'text-success-dark' : difference < 0 ? 'text-error-dark' : 'text-warning'}
        />
      </div>
      <Button type="button" className="closed-shift-summary__done" onClick={onDone}>{t('shift.done')}</Button>
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
