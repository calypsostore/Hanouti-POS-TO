import { Button } from '../../../components/Button';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { StatusTag } from '../../../components/StatusTag';
import { CashMovementList } from './CashMovementList';
import { getCashMovementTotals, getExpectedCash, type ShiftCloseBreakdown } from '../utils/shiftCalculations';
import { resolveStoreSettings, type CashMovementRecord, type ShiftRecord, type StoreRecord } from '../../../types/domain';
import { t } from '../../../i18n/translations';
import { Metric } from './ShiftMetrics';

interface ShiftCurrentProps {
  ownOpenShift: ShiftRecord;
  ownerMode: boolean;
  ownBreakdown: ShiftCloseBreakdown;
  store: StoreRecord | undefined;
  cashMovements: CashMovementRecord[];
  staffNames: Record<string, string>;
  canCashInOut: boolean;
  canOpenCloseShift: boolean;
  canPrintOwnX: boolean;
  openCashMovement: (kind: 'in' | 'out', shiftId: string) => void;
  openCashMovementHistory: (shift: ShiftRecord) => void;
  openCountedCashSheet: () => void;
  createXReport: () => void;
}

export function ShiftCurrent({
  ownOpenShift, ownerMode, ownBreakdown, store, cashMovements, staffNames,
  canCashInOut, canOpenCloseShift, canPrintOwnX, openCashMovement,
  openCashMovementHistory, openCountedCashSheet, createXReport,
}: ShiftCurrentProps) {
  const ownMovementTotals = getCashMovementTotals(cashMovements, ownOpenShift.id);
  const movementsForShift = (shiftId: string) => cashMovements.filter((movement) => movement.shiftId === shiftId);
  return (
<div className="shift-current-layout grid gap-3 tablet:grid-cols-2 lg:grid-cols-1">
          <section className="shift-current-card shift-glass-card rounded-2xl p-4">
            <div className={ownerMode ? 'shift-current-heading' : 'mb-4 flex items-start justify-between gap-3'}>
              {ownerMode ? (
                <>
                  <div className="shift-current-heading__top">
                    <span className="shift-current-clock"><MaterialIcon name="schedule" /></span>
                    <p className="font-body text-label-sm uppercase text-outline">{t('shift.openSince', { time: new Date(ownOpenShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
                    <StatusTag status="open">Open</StatusTag>
                  </div>
                  <h2 className="font-display text-headline-md text-primary">{t('shift.title')}</h2>
                </>
              ) : (
                <>
                  <div>
                    <p className="font-body text-label-sm uppercase text-outline">{t('shift.openSince', { time: new Date(ownOpenShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
                    <h2 className="mt-1 font-display text-headline-md text-primary">{t('shift.title')}</h2>
                  </div>
                  <StatusTag status="open">Open</StatusTag>
                </>
              )}
            </div>
            <div className="space-y-3">
              <Metric icon={ownerMode ? 'account_balance_wallet' : undefined} label={t('shift.startingCash')} amount={ownOpenShift.startingCashMillimes} />
              <Metric icon={ownerMode ? 'payments' : undefined} label="Cash sales" amount={ownBreakdown.cashSalesMillimes} />
              <Metric icon={ownerMode ? 'credit_card' : undefined} label="Card sales" amount={ownBreakdown.cardSalesMillimes} />
              {store?.allowOtherPayments && <Metric icon={ownerMode ? 'currency_exchange' : undefined} label="Other sales" amount={ownBreakdown.otherSalesMillimes} />}
              <Metric icon={ownerMode ? 'receipt_long' : undefined} label="Tab sales" amount={ownBreakdown.tabSalesMillimes} />
              <Metric icon={ownerMode ? 'payments' : undefined} label="Tab payments received in cash" amount={ownBreakdown.tabPaymentsMillimes} />
              <Metric icon={ownerMode ? 'add' : undefined} label="Cash in" amount={ownMovementTotals.cashInMillimes} />
              <Metric icon={ownerMode ? 'remove' : undefined} label="Cash out" amount={ownMovementTotals.cashOutMillimes} />
              {(!resolveStoreSettings(store?.settings).blindShiftClosing || ownerMode) && (
                <Metric icon={ownerMode ? 'calculate' : undefined} label={t('shift.expectedCash')} amount={getExpectedCash(ownOpenShift, ownBreakdown, cashMovements)} prominent />
              )}
            </div>
            {canCashInOut && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" className="shift-cash-in" variant="secondary" onClick={() => openCashMovement('in', ownOpenShift.id)}><MaterialIcon name="add" />Cash in</Button>
                <Button type="button" className="shift-cash-out" variant="secondary" onClick={() => openCashMovement('out', ownOpenShift.id)}><MaterialIcon name="remove" />Cash out</Button>
              </div>
            )}
            <CashMovementList
              className={ownerMode ? 'shift-current-cash-movements' : ''}
              movements={movementsForShift(ownOpenShift.id)}
              staffNames={staffNames}
              onShowMore={() => openCashMovementHistory(ownOpenShift)}
            />
            {ownerMode && canOpenCloseShift && <Button className="shift-current-close-button" onClick={openCountedCashSheet}>
              <MaterialIcon name="lock" />{t('shift.closeShift')}
            </Button>}
          </section>
          {(canPrintOwnX || (!ownerMode && canOpenCloseShift)) && <div className="flex flex-col gap-2">
            {canPrintOwnX && <Button variant="secondary" onClick={() => { void createXReport(); }}>
              <MaterialIcon name="summarize" />Print X for my shift
            </Button>}
            {!ownerMode && canOpenCloseShift && <Button className="w-full lg:w-auto" onClick={openCountedCashSheet}>
              <MaterialIcon name="lock" />{t('shift.closeShift')}
            </Button>}
          </div>}
        </div>
  );
}
