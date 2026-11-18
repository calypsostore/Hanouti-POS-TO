import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { ShiftRecord } from '../types/domain';
import { t } from '../i18n/translations';
import { ownerWorkspaceLinks } from '../app/navigation';
import { updateService } from '../services/updateService';

function parseTnd(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Enter a non-negative cash amount.');
  return Math.round(parsed * 1000);
}

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
  const [pendingVoidCount, setPendingVoidCount] = useState(0);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);

  const refresh = useCallback(async () => {
    const [nextShifts, nextOpenShift, nextStore] = await Promise.all([
      shiftService.listShifts(storeId),
      user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
      userService.getStore(storeId),
    ]);
    setShifts(nextShifts);
    setOwnOpenShift(nextOpenShift);
    setStore(nextStore);
    if (nextOpenShift) {
      const [sales, pendingCount] = await Promise.all([
        orderService.getCashSalesForShift(nextOpenShift.id),
        orderService.getPendingVoidCountForShift(nextOpenShift.id),
      ]);
      setCashSales(sales);
      setPendingVoidCount(pendingCount);
    } else {
      setCashSales(0);
      setPendingVoidCount(0);
    }
    const staffRecords = await Promise.all(nextShifts.map((shift) => userService.getUser(shift.staffId)));
    setStaffNames(Object.fromEntries(nextShifts.map((shift, index) => [shift.staffId, staffRecords[index]?.name ?? 'Staff'])));
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
        cashSales,
      );
      await refresh();
      setCountedCash('');
      setNotice(shift.differenceMillimes === 0 ? t('shift.zeroDifference') : t('shift.cashDifferenceRecorded'));
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Unable to close the shift.');
    }
  }

  const openCount = shifts.filter((shift) => shift.status === 'open').length;
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
              <Metric label={t('shift.cashSales')} amount={cashSales} />
              <Metric label={t('shift.expectedCash')} amount={ownOpenShift.startingCashMillimes + cashSales} prominent />
            </div>
          </section>
          <form onSubmit={(event) => { void closeShift(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md text-on-surface">{t('shift.closeShift')}</h2>
            <label htmlFor="counted-cash" className="font-body text-label-md">{t('shift.countedCash')} (TND)</label>
            <input id="counted-cash" inputMode="decimal" required value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="50.000" className="h-14 rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
            {pendingVoidCount > 0 && <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">{t('shift.pendingVoidWarning', { count: pendingVoidCount })}</p>}
            {countedCash && Number.isFinite(Number(countedCash.replace(',', '.'))) && (
              <Metric label={t('shift.difference')} amount={Math.round(Number(countedCash.replace(',', '.')) * 1000) - (ownOpenShift.startingCashMillimes + cashSales)} signed />
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
            <article key={shift.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
              <div>
                <p className="font-body text-label-lg text-on-surface">{staffNames[shift.staffId] ?? 'Staff'}</p>
                <p className="mt-1 font-body text-body-sm text-outline">
                  {new Date(shift.openedAt).toLocaleString()} {shift.closedAt ? ` • Closed ${new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
              </div>
              <div className="text-right">
                <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
                {shift.differenceMillimes !== undefined && <p className={`mt-1 font-body text-label-sm tabular-nums ${shift.differenceMillimes === 0 ? 'text-success-dark' : 'text-error-dark'}`}>{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
              </div>
            </article>
          ))}
          {shifts.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
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
