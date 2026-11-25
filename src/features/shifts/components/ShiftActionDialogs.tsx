import { Flag, X } from 'lucide-react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Chip } from '../../../components/Chip';
import { DinarInput } from '../../../components/DinarInput';
import { Keypad } from '../../../components/Keypad';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { resolveStoreSettings, type CashMovementReason } from '../../../types/domain';
import { t } from '../../../i18n/translations';
import { CashMovementList } from './CashMovementList';
import { ShiftCloseForm } from './ShiftCloseComponents';
import type { ShiftDialogsProps } from './ShiftDialogs';

const cashMovementReasons: { reason: CashMovementReason; label: string }[] = [
  { reason: 'supplier', label: 'Bought milk' },
  { reason: 'change', label: 'Change float' },
  { reason: 'expense', label: 'Expense' },
  { reason: 'other', label: 'Other' },
];
export function ShiftActionDialogs({
    ownerMode,
    store,
    error,
    closeShiftSheetOpen,
    ownOpenShift,
    closeCountedCashSheet,
    ownBreakdown,
    pendingVoidOrders,
    cashMovements,
    countedCash,
    differenceNote,
    setCountedCash,
    setDifferenceNote,
    closeShift,
    forceCloseShiftTarget,
    setForceCloseShiftTarget,
    staffNames,
    forceShiftConfirmed,
    setForceShiftConfirmed,
    forceShiftPin,
    setForceShiftPin,
    forceCloseShift,
    movementSheetOpen,
    setMovementSheetOpen,
    movementKind,
    movementAmount,
    setMovementAmount,
    movementReason,
    setMovementReason,
    movementNote,
    setMovementNote,
    movementBusy,
    movementShiftId,
    enteredMovementMillimes,
    submitCashMovement,
    cashMovementHistoryShift,
    cashMovementHistoryClosing,
    closeCashMovementHistory,
    closeCashMovementHistoryAndViewAll,
}: Pick<ShiftDialogsProps, 'ownerMode' | 'store' | 'error' | 'closeShiftSheetOpen' | 'ownOpenShift' | 'closeCountedCashSheet' | 'ownBreakdown' | 'pendingVoidOrders' | 'cashMovements' | 'countedCash' | 'differenceNote' | 'setCountedCash' | 'setDifferenceNote' | 'closeShift' | 'forceCloseShiftTarget' | 'setForceCloseShiftTarget' | 'staffNames' | 'forceShiftConfirmed' | 'setForceShiftConfirmed' | 'forceShiftPin' | 'setForceShiftPin' | 'forceCloseShift' | 'movementSheetOpen' | 'setMovementSheetOpen' | 'movementKind' | 'movementAmount' | 'setMovementAmount' | 'movementReason' | 'setMovementReason' | 'movementNote' | 'setMovementNote' | 'movementBusy' | 'movementShiftId' | 'enteredMovementMillimes' | 'submitCashMovement' | 'cashMovementHistoryShift' | 'cashMovementHistoryClosing' | 'closeCashMovementHistory' | 'closeCashMovementHistoryAndViewAll'>) {
  const cashMovementHistoryEntries = cashMovementHistoryShift
    ? cashMovements.filter((movement) => movement.shiftId === cashMovementHistoryShift.id)
    : [];
  return (
    <>
<BottomSheet
        open={closeShiftSheetOpen && Boolean(ownOpenShift)}
        onClose={closeCountedCashSheet}
        title={t('shift.closeShift')}
        iconElement={<Flag className="close-shift-header-icon" aria-hidden="true" />}
        closeIcon={<X className="close-shift-close-icon" aria-hidden="true" />}
        panelClassName="close-shift-panel"
      >
        {ownOpenShift && <ShiftCloseForm
          shift={ownOpenShift}
          breakdown={ownBreakdown}
          movements={cashMovements}
          countedCash={countedCash}
          differenceNote={differenceNote}
          onCountChange={setCountedCash}
          onNoteChange={setDifferenceNote}
          onSubmit={(event) => { void closeShift(event); }}
          submitLabel={t('shift.closeShift')}
          pendingVoidOrders={pendingVoidOrders.filter((order) => order.shiftId === ownOpenShift.id)}
          blind={resolveStoreSettings(store?.settings).blindShiftClosing && !ownerMode}
        />}
      </BottomSheet>
<BottomSheet
        open={forceCloseShiftTarget !== null}
        onClose={() => { setForceCloseShiftTarget(null); setForceShiftPin(''); setForceShiftConfirmed(false); }}
        title="Force close shift"
      >
        {forceCloseShiftTarget && (
          <form onSubmit={(event) => { void forceCloseShift(event, forceCloseShiftTarget); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">
              Close {staffNames[forceCloseShiftTarget.staffId] ?? 'Staff'}'s shift at zero difference. Pending voids on this shift will be approved.
            </p>
            <label className="flex items-start gap-2 font-body text-body-sm text-on-surface">
              <input type="checkbox" checked={forceShiftConfirmed} onChange={(event) => setForceShiftConfirmed(event.target.checked)} />
              Confirm force close at zero difference.
            </label>
            <label className="font-body text-label-md">Owner PIN
              <input readOnly type="password" value={forceShiftPin} placeholder="••••" className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad onPress={(digit) => setForceShiftPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setForceShiftPin('')} onBackspace={() => setForceShiftPin((current) => current.slice(0, -1))} />
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <div className="sheet-action-bar grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => setForceCloseShiftTarget(null)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={!forceShiftConfirmed || forceShiftPin.length !== 4}>
                Force close
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>
<BottomSheet
        open={movementSheetOpen}
        onClose={() => setMovementSheetOpen(false)}
        title={movementKind === 'in' ? 'Cash in' : 'Cash out'}
        subtitle={movementKind === 'in' ? 'Add cash to the shift' : 'Withdraw cash from the shift'}
        icon="account_balance_wallet"
      >
        <form onSubmit={(event) => { void submitCashMovement(event); }} className="flex flex-col gap-3">
          <label htmlFor="cash-movement-amount" className="font-body text-label-md text-on-surface">Amount (TND)</label>
          <DinarInput
            id="cash-movement-amount"
            required
            value={movementAmount}
            onChange={(event) => setMovementAmount(event.target.value)}
            className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-display text-title-md tabular-nums"
          />
          <div>
            <p className="mb-2 font-body text-label-md text-on-surface">Reason</p>
            <div className="flex flex-wrap gap-2">
              {cashMovementReasons.map(({ reason, label }) => (
                <Chip key={reason} selected={movementReason === reason} onClick={() => setMovementReason(reason)}>{label}</Chip>
              ))}
            </div>
          </div>
          <label className="font-body text-label-md text-on-surface">Note (optional)
            <textarea maxLength={500} rows={2} value={movementNote} onChange={(event) => setMovementNote(event.target.value)} className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3" />
          </label>
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setMovementSheetOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={movementBusy || !movementShiftId || enteredMovementMillimes === undefined || enteredMovementMillimes <= 0}>
              <MaterialIcon name={movementKind === 'in' ? 'add' : 'remove'} />Record {movementKind === 'in' ? 'cash in' : 'cash out'}
            </Button>
          </div>
        </form>
      </BottomSheet>
<BottomSheet
        open={cashMovementHistoryShift !== null}
        onClose={closeCashMovementHistory}
        title="Cash Movements"
        subtitle={cashMovementHistoryShift
          ? `${staffNames[cashMovementHistoryShift.staffId] ?? 'Staff'} · ${new Date(cashMovementHistoryShift.openedAt).toLocaleString()}`
          : undefined}
        icon="account_balance_wallet"
        panelClassName={`cash-movement-history-modal${cashMovementHistoryClosing ? ' is-closing' : ''}`}
      >
        {cashMovementHistoryShift && (
          <div className="cash-movement-history-content">
            <CashMovementList
              className="cash-movement-history-list"
              movements={cashMovementHistoryEntries}
              staffNames={staffNames}
              presentation="modal"
            />
            <footer className="cash-movement-history-footer">
              <div className="cash-movement-history-count">
                <MaterialIcon name="info" />
                <span>Total Transactions:</span>
                <strong>{cashMovementHistoryEntries.length}</strong>
              </div>
              <button type="button" className="cash-movement-history-link" onClick={closeCashMovementHistoryAndViewAll}>
                <MaterialIcon name="description" />
                View Full History
              </button>
            </footer>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
