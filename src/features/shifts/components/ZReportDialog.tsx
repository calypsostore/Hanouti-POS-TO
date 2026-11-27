import { Banknote, CreditCard, Ellipsis } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Keypad } from '../../../components/Keypad';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import { formatTicketDateTime, ticketT } from '../../../i18n/tickets';
import { useAuthStore } from '../../../stores/authStore';
import { Metric, ZReportCountField } from './ShiftMetrics';
import type { ShiftDialogsProps } from './ShiftDialogs';


export function ZReportDialog({
    zSheetOpen,
    setZSheetOpen,
    ownerPin,
    setOwnerPin,
    zCountedCash,
    setZCountedCash,
    zCountedCard,
    setZCountedCard,
    zCountedOther,
    setZCountedOther,
    zNote,
    setZNote,
    zStep,
    setZStep,
    forceEverythingConfirmed,
    setForceEverythingConfirmed,
    forceCloseEverything,
    openShifts,
    pendingVoidOrders,
    staffNames,
    zUnresolvedReversals,
    error,
    setError,
    zBusy,
    verifyZOwnerPin,
    closeDayWithZ,
    zPaymentSplit,
    zCardTabPayments,
    zOtherTabPayments,
    zVoids,
    zPendingVoids,
    zShiftLines,
    zExpectedCash,
    zExpectedCard,
    zExpectedOther,
    zReviewed,
    zDifference,
    zCardDifference,
    zOtherDifference,
    parsedZCountedCash,
    parsedZCardMillimes,
    parsedZOtherMillimes,
    hasZCountInputs,
    store,
}: Pick<ShiftDialogsProps, 'zSheetOpen' | 'setZSheetOpen' | 'ownerPin' | 'setOwnerPin' | 'zCountedCash' | 'setZCountedCash' | 'zCountedCard' | 'setZCountedCard' | 'zCountedOther' | 'setZCountedOther' | 'zNote' | 'setZNote' | 'zStep' | 'setZStep' | 'forceEverythingConfirmed' | 'setForceEverythingConfirmed' | 'forceCloseEverything' | 'openShifts' | 'pendingVoidOrders' | 'staffNames' | 'zUnresolvedReversals' | 'error' | 'setError' | 'zBusy' | 'verifyZOwnerPin' | 'closeDayWithZ' | 'zPaymentSplit' | 'zCardTabPayments' | 'zOtherTabPayments' | 'zVoids' | 'zPendingVoids' | 'zShiftLines' | 'zExpectedCash' | 'zExpectedCard' | 'zExpectedOther' | 'zReviewed' | 'zDifference' | 'zCardDifference' | 'zOtherDifference' | 'parsedZCountedCash' | 'parsedZCardMillimes' | 'parsedZOtherMillimes' | 'hasZCountInputs' | 'store'>) {
  const user = useAuthStore((state) => state.user);
  const pinLabel = user?.role === 'owner' ? ticketT('Owner PIN') : ticketT('Your staff PIN');
  const pinInstruction = user?.role === 'owner'
    ? ticketT('Verify the owner PIN to continue with the Z close.')
    : ticketT('Verify your staff PIN to continue with the Z close.');
  return (
    <>
<BottomSheet
        open={zSheetOpen}
        onClose={() => { setZSheetOpen(false); setOwnerPin(''); setZCountedCash(''); setZNote(''); setZStep(1); }}
        title={ticketT('Close day: Z report')}
        icon="receipt_long"
        panelClassName="z-force-close-panel"
      >
        {zStep === 0 ? (
          <form onSubmit={(event) => { event.preventDefault(); void forceCloseEverything(); }} className="z-force-close-form flex flex-col gap-3">
            <p className="z-force-close-description font-body text-body-sm text-on-surface-variant">
              <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
              {ticketT('All pending voids will be approved and all open shifts closed with zero difference')}
            </p>
            <div className="z-force-close-affected">
              {openShifts.map((shift) => (
                <p key={shift.id} className="z-force-close-affected__item font-body text-body-sm">
                  {ticketT('Open shift · {staff} · {openedAt}', { staff: staffNames[shift.staffId] ?? ticketT('Staff'), openedAt: formatTicketDateTime(shift.openedAt) })}
                </p>
              ))}
              {pendingVoidOrders.map((order) => (
                <p key={order.id} className="z-force-close-affected__item font-body text-body-sm">
                  {ticketT('Void #{number} · {staff} · {amount} DT · {reason}', {
                    number: order.number,
                    staff: staffNames[order.staffId] ?? order.staffName ?? ticketT('Staff'),
                    amount: formatTnd(order.totalMillimes / 1000),
                    reason: order.voidReason || ticketT('Reason not recorded'),
                  })}
                </p>
              ))}
              <Link to="/owner/voids" className="z-force-close-review inline-flex min-h-10 items-center font-body text-label-md text-primary underline">
                {ticketT('Review voids')} <MaterialIcon name="chevron_right" />
              </Link>
            </div>
            <label className="z-force-close-confirm flex items-start gap-2 font-body text-body-sm text-on-surface">
              <input
                className="z-force-close-checkbox"
                type="checkbox"
                checked={forceEverythingConfirmed}
                onChange={(event) => setForceEverythingConfirmed(event.target.checked)}
              />
              {ticketT('Confirm: all pending voids will be approved and all open shifts closed with zero difference.')}
            </label>
            <label className="z-force-close-pin font-body text-label-md">
              <span className="z-force-close-pin__label"><MaterialIcon name="lock" />{pinLabel}</span>
              <input readOnly type="password" value={ownerPin} placeholder="••••" className="z-force-close-pin__input mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad className="z-force-close-keypad" onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            {error && <p role="alert" className="z-force-close-error rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            {zUnresolvedReversals.length > 0 && (
              <section role="alert" className="z-force-close-warning rounded-xl bg-warning-container p-3 text-on-warning-container">
                <h3 className="font-display text-title-sm">{ticketT('Unresolved tab reversals — excluded from verified totals')}</h3>
                {zUnresolvedReversals.map((reversal) => (
                  <p key={reversal.reversalId} className="mt-1 font-body text-body-sm">
                    {reversal.paymentMethod.toUpperCase()} · {formatTnd(reversal.amountMillimes / 1000)} DT · {ticketT('Reversal {id}', { id: reversal.reversalId })} · {ticketT('Settlement {id}', { id: reversal.originalSettlementId })}
                  </p>
                ))}
              </section>
            )}
            <div className="sheet-action-bar z-force-close-actions">
              <Button type="button" variant="ghost" className="z-force-close-cancel" onClick={() => setZSheetOpen(false)}>{ticketT('Cancel')}</Button>
              <Button type="submit" variant="danger" className="z-force-close-submit" disabled={zBusy || ownerPin.length !== 4 || !forceEverythingConfirmed}>
                {ticketT('Force close everything')}
              </Button>
            </div>
          </form>
        ) : zStep === 1 ? (
          <form onSubmit={(event) => { event.preventDefault(); void verifyZOwnerPin(); }} className="z-force-close-form flex flex-col gap-3">
            <p className="z-force-close-description font-body text-body-sm text-on-surface-variant">
              <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
              {pinInstruction}
            </p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <label className="z-force-close-pin font-body text-label-md">
              <span className="z-force-close-pin__label"><MaterialIcon name="lock" />{pinLabel}</span>
              <input readOnly type="password" value={ownerPin} placeholder="••••" className="z-force-close-pin__input mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad className="z-force-close-keypad" onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            <div className="sheet-action-bar z-force-close-actions">
              <Button type="button" variant="ghost" className="z-force-close-cancel" onClick={() => { setZSheetOpen(false); setOwnerPin(''); setZStep(1); }}>{ticketT('Cancel')}</Button>
              <Button type="submit" disabled={zBusy || ownerPin.length !== 4}><MaterialIcon name="lock" />{ticketT('Continue')}</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void closeDayWithZ(); }} className="z-report-close-form flex flex-col gap-3">
          <p className="z-report-close-description">
            <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
            {ticketT('Review the recorded activity, then count the whole-day cash and card totals. Exclude shift opening floats from the cash count; each shift’s float is shown separately for reference.')}
          </p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
          <div className="z-report-summary">
            <section className="z-report-summary__section">
              <h3 className="z-report-summary__heading">{ticketT('Period sales and voids')}</h3>
              <Metric className="z-report-metric" label={ticketT('Cash / card / other / tab sales')} amount={zPaymentSplit.cash + zPaymentSplit.card + zPaymentSplit.other + zPaymentSplit.tab} />
              <p className="z-report-summary__detail">
                  {ticketT('Cash {cash} DT · Card {card} DT · Other {other} DT · Tab {tab} DT', {
                    cash: formatTnd(zPaymentSplit.cash / 1000),
                    card: formatTnd(zPaymentSplit.card / 1000),
                    other: formatTnd(zPaymentSplit.other / 1000),
                    tab: formatTnd(zPaymentSplit.tab / 1000),
                  })}
                </p>
              <p className="z-report-summary__detail">
                  {ticketT('Non-cash tab payments · Card {card} DT · Other {other} DT', {
                    card: formatTnd(zCardTabPayments / 1000),
                    other: formatTnd(zOtherTabPayments / 1000),
                  })}
                </p>
              <Metric className="z-report-metric" label={ticketT('Voided orders ({count})', { count: zVoids.count })} amount={zVoids.totalMillimes} />
              <Metric className="z-report-metric" label={ticketT('Pending void requests ({count})', { count: zPendingVoids.count })} amount={zPendingVoids.totalMillimes} />
              </section>
            <section className="z-report-summary__section">
              <h3 className="z-report-summary__heading">{ticketT('Day totals')}</h3>
              <Metric className="z-report-metric" label={ticketT('Opening floats (excluded from cash count)')} amount={zShiftLines.reduce((total, shift) => total + shift.startingCashMillimes, 0)} />
              <Metric className="z-report-metric" label={ticketT('Cash sales')} amount={zPaymentSplit.cash} />
              <Metric className="z-report-metric" label={ticketT('Cash tab payments')} amount={zShiftLines.reduce((total, shift) => total + (shift.tabPaymentsMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label={ticketT('Cash in')} amount={zShiftLines.reduce((total, shift) => total + (shift.cashInMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label={ticketT('Cash out')} amount={zShiftLines.reduce((total, shift) => total + (shift.cashOutMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label={ticketT('Card total (sales + tab payments)')} amount={zExpectedCard} />
              {store?.allowOtherPayments && <Metric className="z-report-metric" label={ticketT('Other total (sales + tab payments)')} amount={zExpectedOther} />}
              </section>
              {zShiftLines.map((shift) => (
              <section key={shift.shiftId} className="z-report-summary__section">
                <h3 className="z-report-summary__heading">{shift.staffName}</h3>
                <p className="z-report-summary__date">
                    {ticketT('Opened')} {formatTicketDateTime(shift.openedAt)} ·
                    {' '}{ticketT('Closed')} {shift.closedAt ? formatTicketDateTime(shift.closedAt) : '—'}
                  </p>
                <Metric className="z-report-metric" label={ticketT('Float')} amount={shift.startingCashMillimes} />
                <Metric className="z-report-metric" label={ticketT('Cash sales')} amount={shift.cashSalesMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Card sales')} amount={shift.cardSalesMillimes ?? 0} />
                {store?.allowOtherPayments && <Metric className="z-report-metric" label={ticketT('Other sales')} amount={shift.otherSalesMillimes ?? 0} />}
                <Metric className="z-report-metric" label={ticketT('Tab sales (not cash)')} amount={shift.tabSalesMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Tab payments in cash')} amount={shift.tabPaymentsMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Cash in')} amount={shift.cashInMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Cash out')} amount={shift.cashOutMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Post-close void adjustments')} amount={shift.voidAdjustmentMillimes ?? 0} />
                {shift.forceClosedByOwner && <p className="z-report-summary__warning">{ticketT('Closed by force')}</p>}
                {shift.forceClosedByOwner && <p className="z-report-summary__warning">{ticketT('Unverified count · auto-approved voids: {count}', { count: shift.voidsAutoApprovedCount ?? 0 })}</p>}
                </section>
              ))}
            </div>
          <ZReportCountField id="z-counted-cash" label={ticketT('Total cash for the day, excluding opening floats (TND)')} value={zCountedCash} onChange={setZCountedCash} icon={Banknote} />
            {zExpectedCard > 0 && <ZReportCountField id="z-counted-card" label={ticketT('Total card payments in period (TND)')} value={zCountedCard} onChange={setZCountedCard} icon={CreditCard} />}
            {store?.allowOtherPayments && zExpectedOther > 0 && <ZReportCountField id="z-counted-other" label={ticketT('Total other payments in period (TND)')} value={zCountedOther} onChange={setZCountedOther} icon={Ellipsis} />}
            {zReviewed && zDifference !== undefined && (
            <div className="z-report-review" aria-live="polite">
              <h3 className="z-report-summary__heading">{ticketT('Count review')}</h3>
              <Metric className="z-report-metric" label={ticketT('Counted day cash (excluding floats)')} amount={parsedZCountedCash ?? 0} />
              <Metric className="z-report-metric" label={ticketT('Expected day cash (excluding floats)')} amount={zExpectedCash} prominent />
              <p className={`z-report-review__status ${
                zDifference < 0 ? 'z-report-review__status--short' : zDifference > 0 ? 'z-report-review__status--over' : 'z-report-review__status--balanced'
              }`}>
                  {zDifference < 0
                    ? ticketT('SHORT {amount}', { amount: `${formatTnd(Math.abs(zDifference) / 1000)} DT` })
                    : zDifference > 0
                      ? ticketT('OVER {amount}', { amount: `${formatTnd(zDifference / 1000)} DT` })
                      : ticketT('BALANCED')}
                </p>
              {zCardDifference !== undefined && <>
                <Metric className="z-report-metric" label={ticketT('Counted card')} amount={parsedZCardMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Expected card (sales + tab payments)')} amount={zExpectedCard} />
                <p className={`z-report-review__status z-report-review__status--${
                zCardDifference === 0 ? 'balanced' : zCardDifference !== undefined && zCardDifference < 0 ? 'short' : 'over'
              }`}>
                  {ticketT('Card {status}', { status: zCardDifference === 0
                    ? ticketT('BALANCED')
                    : zCardDifference !== undefined && zCardDifference < 0
                      ? ticketT('SHORT {amount}', { amount: `${formatTnd(Math.abs(zCardDifference) / 1000)} DT` })
                      : zCardDifference !== undefined
                        ? ticketT('OVER {amount}', { amount: `${formatTnd(zCardDifference / 1000)} DT` })
                        : '' })}
                </p>
              </>}
                {zOtherDifference !== undefined && <>
                <Metric className="z-report-metric" label={ticketT('Counted other')} amount={parsedZOtherMillimes ?? 0} />
                <Metric className="z-report-metric" label={ticketT('Expected other (sales + tab payments)')} amount={zExpectedOther} />
                <p className={`z-report-review__status z-report-review__status--${
                  zOtherDifference === 0 ? 'balanced' : zOtherDifference !== undefined && zOtherDifference < 0 ? 'short' : 'over'
                }`}>
                    {ticketT('Other {status}', { status: zOtherDifference === 0
                      ? ticketT('BALANCED')
                      : zOtherDifference !== undefined && zOtherDifference < 0
                        ? ticketT('SHORT {amount}', { amount: `${formatTnd(Math.abs(zOtherDifference) / 1000)} DT` })
                        : zOtherDifference !== undefined
                          ? ticketT('OVER {amount}', { amount: `${formatTnd(zOtherDifference / 1000)} DT` })
                          : '' })}
                  </p>
                </>}
              </div>
            )}
            <section className="close-shift-count close-shift-note-field">
              <span className="close-shift-count__icon" aria-hidden="true">
                <MaterialIcon name="edit_note" className="text-2xl" />
              </span>
              <div className="close-shift-count__content">
                <label htmlFor="z-report-note" className="close-shift-count__label">
                  {ticketT('Note (optional)')}
                </label>
                <div className="close-shift-count__input-wrap close-shift-note-wrap">
                  <textarea
                    id="z-report-note"
                    maxLength={500}
                    rows={2}
                    value={zNote}
                    onChange={(event) => setZNote(event.target.value)}
                    className="close-shift-note"
                  />
                </div>
              </div>
            </section>
            <div className="sheet-action-bar z-report-actions grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" className="z-report-back" onClick={() => { setError(''); setZStep(1); }}>{ticketT('Back')}</Button>
              <Button
                type="submit"
                variant={zReviewed ? 'danger' : 'primary'}
                className={`z-report-submit${zReviewed ? ' z-report-submit--final' : ''}`}
                disabled={zBusy || !hasZCountInputs}
              >
                <MaterialIcon name="lock" />{ticketT(zReviewed ? 'Confirm Z close' : 'Review counts')}
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>
    </>
  );
}
