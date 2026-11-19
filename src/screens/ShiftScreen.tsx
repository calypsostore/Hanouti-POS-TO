import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Keypad } from '../components/Keypad';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { CashMovementNotificationError, shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CashMovementReason, CashMovementRecord, ShiftRecord } from '../types/domain';
import { t } from '../i18n/translations';
import { ownerWorkspaceLinks } from '../app/navigation';
import { updateService } from '../services/updateService';

function parseTnd(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  const millimes = Math.round(parsed * 1000);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(millimes)) throw new Error('Enter a non-negative cash amount.');
  return millimes;
}

const cashMovementReasons: { reason: CashMovementReason; label: string }[] = [
  { reason: 'supplier', label: 'Bought milk' },
  { reason: 'change', label: 'Change float' },
  { reason: 'expense', label: 'Expense' },
  { reason: 'other', label: 'Other' },
];

function ShiftContent({ ownerMode }: { ownerMode: boolean }) {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [ownOpenShift, setOwnOpenShift] = useState<ShiftRecord>();
  const [startingCash, setStartingCash] = useState('50.000');
  const [startingCashEdited, setStartingCashEdited] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [cashSales, setCashSales] = useState(0);
  const [expectedCash, setExpectedCash] = useState(0);
  const [pendingVoidCount, setPendingVoidCount] = useState(0);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [forceCountedCash, setForceCountedCash] = useState<Record<string, string>>({});
  const [expectedCashByShift, setExpectedCashByShift] = useState<Record<string, number>>({});
  const [cashMovements, setCashMovements] = useState<CashMovementRecord[]>([]);
  const [canCashInOut, setCanCashInOut] = useState(false);
  const [movementSheetOpen, setMovementSheetOpen] = useState(false);
  const [movementShiftId, setMovementShiftId] = useState('');
  const [movementKind, setMovementKind] = useState<'in' | 'out'>('in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState<CashMovementReason>('supplier');
  const [movementNote, setMovementNote] = useState('');
  const [movementBusy, setMovementBusy] = useState(false);

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);

  const refresh = useCallback(async () => {
    const [nextShifts, nextOpenShift, nextStore, nextMovements, users, cashPermission] = await Promise.all([
      shiftService.listShifts(storeId),
      user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
      userService.getStore(storeId),
      shiftService.listCashMovements(storeId),
      userService.listUsers(storeId),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'cash_in_out') : Promise.resolve(false),
    ]);
    setShifts(nextShifts);
    setOwnOpenShift(nextOpenShift);
    setStore(nextStore);
    setCashMovements(nextMovements);
    setStaffNames(Object.fromEntries(users.map((member) => [member.id, member.name])));
    setCanCashInOut(cashPermission);
    if (nextOpenShift) {
      const [sales, pendingCount, expected] = await Promise.all([
        orderService.getCashSalesForShift(nextOpenShift.id),
        orderService.getPendingVoidCountForShift(nextOpenShift.id),
        shiftService.getExpectedCash(nextOpenShift.id),
      ]);
      setCashSales(sales);
      setPendingVoidCount(pendingCount);
      setExpectedCash(expected);
    } else {
      setCashSales(0);
      setPendingVoidCount(0);
      setExpectedCash(0);
    }
    const expectedByShift = await Promise.all(nextShifts.filter((shift) => shift.status === 'open')
      .map(async (shift) => [shift.id, await shiftService.getExpectedCash(shift.id)] as const));
    setExpectedCashByShift(Object.fromEntries(expectedByShift));
  }, [storeId, user]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
  }, [refresh]);

  async function openShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !storeId) return;
    setError('');
    setNotice('');
    try {
      await shiftService.openShift(storeId, user.id, parseTnd(startingCash));
      setStartingCashEdited(false);
      await refresh();
      setNotice('Shift opened.');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open the shift.');
    }
  }

  async function closeShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownOpenShift) return;
    setError('');
    setNotice('');
    try {
      const shift = await shiftService.closeShift(
        ownOpenShift.id,
        parseTnd(countedCash),
      );
      await refresh();
      setCountedCash('');
      setNotice(shift.differenceMillimes === 0 ? t('shift.zeroDifference') : t('shift.cashDifferenceRecorded'));
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Unable to close the shift.');
    }
  }

  async function forceCloseShift(event: FormEvent<HTMLFormElement>, shift: ShiftRecord) {
    event.preventDefault();
    if (!user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    try {
      await shiftService.forceCloseShift(shift.id, user.id, parseTnd(forceCountedCash[shift.id] ?? ''));
      setForceCountedCash((current) => ({ ...current, [shift.id]: '' }));
      await refresh();
      setNotice(`${staffNames[shift.staffId] ?? 'Staff'}'s shift was force-closed by the owner.`);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Unable to force-close this shift.');
    }
  }

  function openCashMovement(kind: 'in' | 'out', shiftId: string) {
    setMovementKind(kind);
    setMovementShiftId(shiftId);
    setMovementAmount('');
    setMovementReason('supplier');
    setMovementNote('');
    setError('');
    setMovementSheetOpen(true);
  }

  function pressMovementAmount(value: string) {
    setMovementAmount((current) => {
      if (value === '.') {
        if (current.includes('.')) return current;
        return current ? `${current}.` : '0.';
      }
      const [whole, fraction] = current.split('.');
      if (whole.length >= 9 || (fraction !== undefined && fraction.length >= 3)) return current;
      return current + value;
    });
  }

  async function submitCashMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !movementShiftId) return;
    setError('');
    setNotice('');
    setMovementBusy(true);
    let recorded = false;
    try {
      await shiftService.recordCashMovement({
        shiftId: movementShiftId,
        actorId: user.id,
        kind: movementKind,
        amountMillimes: parseTnd(movementAmount),
        reason: movementReason,
        note: movementNote,
      });
      recorded = true;
      setNotice(movementKind === 'in' ? 'Cash in recorded.' : 'Cash out recorded.');
      setMovementSheetOpen(false);
    } catch (movementError) {
      if (movementError instanceof CashMovementNotificationError) {
        recorded = true;
        setMovementSheetOpen(false);
      }
      setError(movementError instanceof Error ? movementError.message : 'Unable to record the cash movement.');
    } finally {
      if (recorded) {
        try {
          await refresh();
        } catch (refreshError) {
          setError(`Cash movement was recorded, but the shift could not refresh: ${refreshError instanceof Error ? refreshError.message : t('common.refreshFailed')}`);
        }
      }
      setMovementBusy(false);
    }
  }

  const openCount = shifts.filter((shift) => shift.status === 'open').length;
  const enteredMovementMillimes = Math.round(Number(movementAmount.replace(',', '.')) * 1000);
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('shift.title')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        {ownerMode && <StatusTag status="started">{`${openCount} open`}</StatusTag>}
      </div>

      {ownOpenShift ? (
        <div className="grid gap-4 tablet:grid-cols-2">
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-body text-label-sm uppercase text-outline">{t('shift.openSince', { time: new Date(ownOpenShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
                <h2 className="mt-1 font-display text-headline-md text-primary">{t('shift.title')}</h2>
              </div>
              <StatusTag status="open">Open</StatusTag>
            </div>
            <div className="space-y-3">
              <Metric label={t('shift.startingCash')} amount={ownOpenShift.startingCashMillimes} />
              <Metric label="Cash sales + tab payments" amount={cashSales} />
              <Metric label={t('shift.expectedCash')} amount={expectedCash} prominent />
            </div>
            {canCashInOut && !ownerMode && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => openCashMovement('in', ownOpenShift.id)}><MaterialIcon name="add" />Cash in</Button>
                <Button type="button" variant="secondary" onClick={() => openCashMovement('out', ownOpenShift.id)}><MaterialIcon name="remove" />Cash out</Button>
              </div>
            )}
            <CashMovementList movements={cashMovements.filter((movement) => movement.shiftId === ownOpenShift.id)} staffNames={staffNames} />
          </section>
          <form onSubmit={(event) => { void closeShift(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md text-on-surface">{t('shift.closeShift')}</h2>
            <label htmlFor="counted-cash" className="font-body text-label-md">{t('shift.countedCash')} (TND)</label>
            <input id="counted-cash" inputMode="decimal" required value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="50.000" className="h-14 rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
            {pendingVoidCount > 0 && <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">{t('shift.pendingVoidWarning', { count: pendingVoidCount })}</p>}
            {countedCash && Number.isFinite(Number(countedCash.replace(',', '.'))) && (
              <Metric label={t('shift.difference')} amount={Math.round(Number(countedCash.replace(',', '.')) * 1000) - expectedCash} signed />
            )}
            <p className="font-body text-body-sm text-on-surface-variant">{t('shift.cashDifferenceRecorded')}</p>
            <Button type="submit" variant="danger" className="w-full"><MaterialIcon name="lock" />{t('shift.closeShift')}</Button>
          </form>
        </div>
      ) : (
        <form onSubmit={(event) => { void openShift(event); }} className="max-w-xl rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name="payments" /></span>
            <div>
              <h2 className="font-display text-headline-md text-on-surface">{t('shift.openShift')}</h2>
              <p className="font-body text-body-sm text-on-surface-variant">Count the cash drawer before taking orders.</p>
            </div>
          </div>
          <label htmlFor="starting-cash" className="mb-1.5 block font-body text-label-md">{t('shift.startingCash')} (TND)</label>
          <input id="starting-cash" inputMode="decimal" required value={startingCash} onChange={(event) => { setStartingCash(event.target.value); setStartingCashEdited(true); }} className="mb-4 h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
          <Button type="submit" className="w-full"><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
        </form>
      )}

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <section className="mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{t('shift.history')}</h2>
        <div className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <article key={shift.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
              <div>
                <p className="font-body text-label-lg text-on-surface">{staffNames[shift.staffId] ?? 'Staff'}</p>
                <p className="mt-1 font-body text-body-sm text-outline">
                  {new Date(shift.openedAt).toLocaleString()} {shift.closedAt ? ` • Closed ${new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
                {shift.forceClosedByOwner && <p className="mt-1 font-body text-label-sm text-warning">Force closed by owner</p>}
              </div>
              <div className="text-right">
                <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
                {shift.differenceMillimes !== undefined && <p className={`mt-1 font-body text-label-sm tabular-nums ${shift.differenceMillimes === 0 ? 'text-success-dark' : 'text-error-dark'}`}>{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
              </div>
              {ownerMode && canCashInOut && shift.status === 'open' && user?.role === 'owner' && (
                <div className="flex w-full gap-2">
                  <Button type="button" variant="secondary" onClick={() => openCashMovement('in', shift.id)}><MaterialIcon name="add" />Cash in</Button>
                  <Button type="button" variant="secondary" onClick={() => openCashMovement('out', shift.id)}><MaterialIcon name="remove" />Cash out</Button>
                </div>
              )}
              <CashMovementList movements={cashMovements.filter((movement) => movement.shiftId === shift.id)} staffNames={staffNames} />
              {ownerMode && shift.status === 'open' && user?.role === 'owner' && (
                <form onSubmit={(event) => { void forceCloseShift(event, shift); }} className="mt-3 flex w-full flex-wrap items-end gap-2 border-t border-outline-variant pt-3">
                  <p className="w-full font-body text-body-sm text-on-surface-variant">Expected cash: {formatTnd((expectedCashByShift[shift.id] ?? shift.startingCashMillimes) / 1000)} DT. Enter the drawer count you verified.</p>
                  <label className="min-w-40 flex-1 font-body text-label-sm">Owner-counted cash (TND)
                    <input required inputMode="decimal" value={forceCountedCash[shift.id] ?? ''} onChange={(event) => setForceCountedCash((current) => ({ ...current, [shift.id]: event.target.value }))} placeholder="0.000" className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3" />
                  </label>
                  <Button type="submit" variant="danger"><MaterialIcon name="lock" />Force close</Button>
                </form>
              )}
            </article>
          ))}
          {shifts.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
      <BottomSheet
        open={movementSheetOpen}
        onClose={() => setMovementSheetOpen(false)}
        title={movementKind === 'in' ? 'Cash in' : 'Cash out'}
      >
        <form onSubmit={(event) => { void submitCashMovement(event); }} className="flex flex-col gap-3">
          <label htmlFor="cash-movement-amount" className="font-body text-label-md text-on-surface">Amount (TND)</label>
          <input
            id="cash-movement-amount"
            readOnly
            inputMode="none"
            value={movementAmount}
            placeholder="0.000"
            className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-display text-title-md tabular-nums"
          />
          <Keypad
            decimal
            disabled={movementBusy}
            onPress={pressMovementAmount}
            onClear={() => setMovementAmount('')}
            onBackspace={() => setMovementAmount((value) => value.slice(0, -1))}
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
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setMovementSheetOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={movementBusy || !movementShiftId || !Number.isSafeInteger(enteredMovementMillimes) || enteredMovementMillimes <= 0}>
              <MaterialIcon name={movementKind === 'in' ? 'add' : 'remove'} />Record {movementKind === 'in' ? 'cash in' : 'cash out'}
            </Button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}

function Metric({ label, amount, prominent = false, signed = false }: { label: string; amount: number; prominent?: boolean; signed?: boolean }) {
  const formatted = formatTnd(Math.abs(amount) / 1000);
  const prefix = signed && amount > 0 ? '+' : signed && amount < 0 ? '−' : '';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-body text-body-sm text-on-surface-variant">{label}</span>
      <span className={`font-display tabular-nums ${prominent ? 'text-headline-md text-primary' : 'text-title-md text-on-surface'} ${signed && amount !== 0 ? 'text-error-dark' : ''}`}>{prefix}{formatted} DT</span>
    </div>
  );
}

function CashMovementList({ movements, staffNames }: {
  movements: CashMovementRecord[];
  staffNames: Record<string, string>;
}) {
  const reasonLabel = (reason: CashMovementReason) => {
    if (reason === 'supplier') return 'Bought milk';
    if (reason === 'change') return 'Change float';
    if (reason === 'expense') return 'Expense';
    return 'Other';
  };
  return (
    <section className="mt-4 border-t border-outline-variant pt-3">
      <h3 className="mb-2 font-body text-label-md text-on-surface">Cash movements</h3>
      {movements.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {movements.map((movement) => (
            <li key={movement.id} className="flex items-start justify-between gap-3 rounded-lg bg-surface-container-low p-3">
              <div className="min-w-0">
                <p className="font-body text-label-md text-on-surface">
                  {movement.kind === 'in' ? 'Cash in' : 'Cash out'} · {reasonLabel(movement.reason)}
                </p>
                <p className="mt-0.5 font-body text-body-sm text-outline">
                  {staffNames[movement.staffId] ?? 'Staff'} · {new Date(movement.createdAt).toLocaleString()}
                </p>
                {movement.note && <p className="mt-0.5 break-words font-body text-body-sm text-on-surface-variant">{movement.note}</p>}
              </div>
              <strong className={`shrink-0 font-display tabular-nums ${movement.kind === 'in' ? 'text-success-dark' : 'text-error-dark'}`}>
                {movement.kind === 'in' ? '+' : '−'}{formatTnd(movement.amountMillimes / 1000)} DT
              </strong>
            </li>
          ))}
        </ul>
      ) : <p className="font-body text-body-sm text-outline">No cash movements for this shift.</p>}
    </section>
  );
}

export function ShiftScreen({ ownerMode = false }: { ownerMode?: boolean }) {
  const storeId = useAuthStore((state) => state.user?.storeId);
  const [storeName, setStoreName] = useState<string>();
  useEffect(() => {
    if (storeId) void userService.getStore(storeId).then((store) => setStoreName(store?.name));
  }, [storeId]);
  const content = <ShiftContent ownerMode={ownerMode} />;
  if (ownerMode) return <WorkspaceLayout title={t('shift.title')} storeName={storeName} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>;
  return <div className="min-h-screen bg-surface px-4 pb-24 pt-5"><div className="mx-auto max-w-3xl">{content}</div><BottomNav /></div>;
}
