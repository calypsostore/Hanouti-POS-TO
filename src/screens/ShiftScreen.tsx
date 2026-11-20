import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { FirstRunHint } from '../components/FirstRunHint';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { CashMovementNotificationError, shiftService } from '../services/shiftService';
import { compService } from '../services/compService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CashMovementReason, CashMovementRecord, ShiftRecord } from '../types/domain';
import { t } from '../i18n/translations';
import { ownerWorkspaceLinks } from '../app/navigation';
import { DataTable, PageHeader, type DataTableColumn } from '../components/layout';
import { PageContainer } from '../components/layout';
import { updateService } from '../services/updateService';
import type { ShiftSalesBreakdown } from '../services/orderService';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { reportService } from '../services/reportService';
import { ReportView } from '../components/ReportView';
import type { ReportRecord, ReportShiftLine } from '../types/domain';

type ShiftCloseBreakdown = ShiftSalesBreakdown & {
  pendingVoidCount: number;
  compsMillimes: number;
};

const emptyShiftBreakdown: ShiftCloseBreakdown = {
  orderCount: 0,
  cashSalesMillimes: 0,
  tabSalesMillimes: 0,
  tabPaymentsMillimes: 0,
  voidsMillimes: 0,
  pendingVoidCount: 0,
  compsMillimes: 0,
};

function parseTnd(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  const millimes = Math.round(parsed * 1000);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(millimes)) throw new Error('Enter a non-negative cash amount.');
  return millimes;
}

function reportDrawerAmounts(report: ReportRecord) {
  const cashFloat = report.cashFloatMillimes ??
    (report.shifts ?? []).reduce((sum, shift) => sum + shift.startingCashMillimes, 0);
  const expected = report.expectedCashExFloatMillimes ??
    (report.totalExpectedCashMillimes ?? 0) - cashFloat;
  const counted = report.countedCashMillimes === undefined
    ? 0
    : report.expectedCashExFloatMillimes === undefined
      ? report.countedCashMillimes - cashFloat
      : report.countedCashMillimes;
  const difference = report.countedCashMillimes === undefined
    ? report.cashDifference ?? report.cashDifferenceMillimes ?? 0
    : counted - expected;
  return { expected, counted, difference };
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
  const [loading, setLoading] = useState(true);
  const [ownOpenShift, setOwnOpenShift] = useState<ShiftRecord>();
  const [startingCash, setStartingCash] = useState('50.000');
  const [startingCashEdited, setStartingCashEdited] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [differenceNote, setDifferenceNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [breakdownsByShift, setBreakdownsByShift] = useState<Record<string, ShiftCloseBreakdown>>({});
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [forceCountedCash, setForceCountedCash] = useState<Record<string, string>>({});
  const [forceDifferenceNotes, setForceDifferenceNotes] = useState<Record<string, string>>({});
  const [closedShiftSummary, setClosedShiftSummary] = useState<{ shift: ShiftRecord; breakdown: ShiftCloseBreakdown }>();
  const [cashMovements, setCashMovements] = useState<CashMovementRecord[]>([]);
  const [canCashInOut, setCanCashInOut] = useState(false);
  const [movementSheetOpen, setMovementSheetOpen] = useState(false);
  const [movementShiftId, setMovementShiftId] = useState('');
  const [movementKind, setMovementKind] = useState<'in' | 'out'>('in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState<CashMovementReason>('supplier');
  const [movementNote, setMovementNote] = useState('');
  const [movementBusy, setMovementBusy] = useState(false);
  const [openShiftSheetOpen, setOpenShiftSheetOpen] = useState(false);
  const [closeShiftSheetOpen, setCloseShiftSheetOpen] = useState(false);
  const [forceCloseShiftTarget, setForceCloseShiftTarget] = useState<ShiftRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'shifts' | 'reports' | 'archive'>(() =>
    ownerMode && new URLSearchParams(window.location.search).get('tab') === 'reports' ? 'reports' : 'shifts',
  );
  const [ownerPin, setOwnerPin] = useState('');
  const [zCountedCash, setZCountedCash] = useState('');
  const [zExpectedCash, setZExpectedCash] = useState(0);
  const [zShiftLines, setZShiftLines] = useState<ReportShiftLine[]>([]);
  const [zStep, setZStep] = useState<1 | 2>(1);
  const [zBusy, setZBusy] = useState(false);
  const [zNote, setZNote] = useState('');
  const [zSheetOpen, setZSheetOpen] = useState(false);
  const [reportPreview, setReportPreview] = useState<ReportRecord>();
  const [archiveReports, setArchiveReports] = useState<ReportRecord[]>([]);

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);

  const refresh = useCallback(async () => {
    const [nextShifts, nextOpenShift, nextStore, nextMovements, users, cashPermission, comps, nextReports] = await Promise.all([
      shiftService.listShifts(storeId),
      user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
      userService.getStore(storeId),
      shiftService.listCashMovements(storeId),
      userService.listUsers(storeId),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'cash_in_out') : Promise.resolve(false),
      compService.listComps(storeId),
      ownerMode ? reportService.listReports(storeId) : Promise.resolve([]),
    ]);
    setShifts(nextShifts);
    setOwnOpenShift(nextOpenShift);
    setStore(nextStore);
    setCashMovements(nextMovements);
    setStaffNames(Object.fromEntries(users.map((member) => [member.id, member.name])));
    setCanCashInOut(cashPermission);
    if (ownerMode) setArchiveReports(nextReports);
    const breakdowns = await Promise.all(nextShifts.filter((shift) => shift.status === 'open')
      .map(async (shift) => {
        const [sales, pendingVoidCount] = await Promise.all([
          orderService.getShiftSalesBreakdown(shift.id),
          orderService.getPendingVoidCountForShift(shift.id),
        ]);
        const compsMillimes = comps
          .filter((comp) => comp.shiftId === shift.id)
          .reduce((sum, comp) => sum + comp.valueMillimes, 0);
        return [shift.id, { ...sales, pendingVoidCount, compsMillimes }] as const;
      }));
    setBreakdownsByShift(Object.fromEntries(breakdowns));
  }, [storeId, user, ownerMode]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to load shifts.', loadError);
      setError(t('common.loadFailed'));
    }).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications'], () => {
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to refresh shifts after a live update.', loadError);
      setError(t('common.refreshFailed'));
    });
  }), [refresh, storeId]);

  async function openShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !storeId) return;
    setError('');
    setNotice('');
    try {
      await shiftService.openShift(storeId, user.id, parseTnd(startingCash));
      setStartingCashEdited(false);
      await refresh();
      setOpenShiftSheetOpen(false);
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
        differenceNote,
      );
      setClosedShiftSummary({ shift, breakdown: breakdownsByShift[shift.id] ?? emptyShiftBreakdown });
      setCountedCash('');
      setDifferenceNote('');
      await refresh();
      setCloseShiftSheetOpen(false);
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
      const closedShift = await shiftService.forceCloseShift(
        shift.id,
        user.id,
        parseTnd(forceCountedCash[shift.id] ?? ''),
        forceDifferenceNotes[shift.id],
      );
      setClosedShiftSummary({ shift: closedShift, breakdown: breakdownsByShift[shift.id] ?? emptyShiftBreakdown });
      setForceCountedCash((current) => ({ ...current, [shift.id]: '' }));
      setForceDifferenceNotes((current) => ({ ...current, [shift.id]: '' }));
      await refresh();
      setForceCloseShiftTarget(null);
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
    setMovementAmount((current) => appendDecimalAmount(current, value));
  }

  function pressCountedCash(value: string) {
    setCountedCash((current) => appendDecimalAmount(current, value));
  }

  function pressForceCountedCash(shiftId: string, value: string) {
    setForceCountedCash((current) => ({
      ...current,
      [shiftId]: appendDecimalAmount(current[shiftId] ?? '', value),
    }));
  }

  async function createXReport() {
    if (!user) return;
    setError('');
    try {
      const report = await reportService.createXReport(storeId, user.name);
      setReportPreview(report);
      setNotice('X report created. The day remains open.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to create the X report.');
    }
  }

  function openZCloseDialog() {
    setError('');
    setOwnerPin('');
    setZCountedCash('');
    setZExpectedCash(0);
    setZShiftLines([]);
    setZStep(1);
    setZNote('');
    setZSheetOpen(true);
  }

  async function verifyZOwnerPin() {
    setError('');
    if (!/^\d{4}$/.test(ownerPin)) {
      setError('Enter the 4-digit owner PIN.');
      return;
    }
    setZBusy(true);
    try {
      if (!await userService.verifyStorePin(storeId, ownerPin, 'z_report')) {
        throw new Error('The owner PIN is incorrect.');
      }
      const live = await reportService.getCurrentPeriodSummary(storeId);
      setZExpectedCash(live.expectedCashExFloatMillimes);
      setZShiftLines(live.shiftLines.filter((shift) => shift.status === 'closed'));
      setZStep(2);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Unable to verify the owner PIN.');
    } finally {
      setZBusy(false);
    }
  }

  async function closeDayWithZ() {
    if (!user) return;
    setError('');
    setZBusy(true);
    try {
      if (!ownerPin || !/^\d{4}$/.test(ownerPin)) throw new Error('Owner PIN is required for every Z report.');
      const countedCashMillimes = parseTnd(zCountedCash);
      const differenceMillimes = countedCashMillimes - zExpectedCash;
      if (differenceMillimes !== 0 && !zNote.trim()) throw new Error('A note is required for a cash difference.');
      const report = await reportService.closeDayWithZReport(storeId, user.name, ownerPin, {
        countedCashMillimes,
        note: zNote.trim() || undefined,
      });
      setOwnerPin('');
      setZCountedCash('');
      setZNote('');
      setZSheetOpen(false);
      setReportPreview(report);
      await refresh();
      setNotice('Z report created and the business day closed.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to close the business day.');
    } finally {
      setZBusy(false);
    }
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
  const ownBreakdown = ownOpenShift ? breakdownsByShift[ownOpenShift.id] ?? emptyShiftBreakdown : emptyShiftBreakdown;
  const pageTitle = t('shift.title');
  const movementsForShift = (shiftId: string) => cashMovements.filter((movement) => movement.shiftId === shiftId);
  const parsedZAmount = Number(zCountedCash.replace(',', '.'));
  const parsedZMillimes = Math.round(parsedZAmount * 1000);
  const parsedZCountedCash = zCountedCash.trim() && Number.isFinite(parsedZAmount) &&
    parsedZAmount >= 0 && Number.isSafeInteger(parsedZMillimes)
    ? parsedZMillimes
    : undefined;
  const zDifference = parsedZCountedCash === undefined ? undefined : parsedZCountedCash - zExpectedCash;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{pageTitle}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        {ownerMode && <StatusTag status="started">{`${openCount} open`}</StatusTag>}
      </div>
      <PageHeader className="hidden lg:flex" title={pageTitle} subtitle={store?.name} actions={
        ownerMode
          ? <StatusTag status="started">{`${openCount} open`}</StatusTag>
          : !ownOpenShift && !closedShiftSummary
            ? <Button className="w-full lg:w-auto lg:min-w-[160px]" onClick={() => setOpenShiftSheetOpen(true)}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
            : undefined
      } />
      <FirstRunHint id={`shift-${user?.id ?? 'guest'}`} title={t('hint.title')} message={t('hint.shift')} />

      {ownerMode && (
        <nav className="mb-4 grid grid-cols-3 gap-2" aria-label="Shift and report sections">
          {([
            ['shifts', 'Shifts'],
            ['reports', 'X / Z'],
            ['archive', 'Daily reports'],
          ] as const).map(([tab, label]) => (
            <Button key={tab} variant={activeTab === tab ? 'primary' : 'secondary'} onClick={() => setActiveTab(tab)}>{label}</Button>
          ))}
        </nav>
      )}

      {ownerMode && activeTab === 'reports' && (
        <section className="grid gap-4 tablet:grid-cols-2">
          <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md">Live X report</h2>
            <p className="mt-2 font-body text-body-sm text-outline">A frozen snapshot for review. The day stays open.</p>
            <Button className="mt-4 w-full" onClick={() => { void createXReport(); }}><MaterialIcon name="summarize" />Print X report</Button>
          </article>
          <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md">Close day: Z report</h2>
            <p className="mt-2 font-body text-body-sm text-outline">Every Z requires the owner PIN and every shift must be closed.</p>
            {openCount > 0 && <p role="alert" className="mt-3 rounded-lg bg-warning-container p-3 text-on-warning-container">Open shifts remain: use Force close shift in the Shifts tab.</p>}
            <Button disabled={openCount > 0} variant="danger" className="mt-4 w-full" onClick={() => { void openZCloseDialog(); }}><MaterialIcon name="lock" />Close day: Z report</Button>
          </article>
          {reportPreview && <div className="tablet:col-span-2"><ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} /></div>}
        </section>
      )}

      {ownerMode && activeTab === 'archive' && (
        <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-3 font-display text-headline-md">Daily reports</h2>
          {loading ? <ListSkeleton label="Loading daily reports" /> : (
            <div className="flex flex-col gap-2">
              {archiveReports.filter((report) => report.type === 'Z').map((report) => {
                const amounts = reportDrawerAmounts(report);
                return (
                  <button key={report.id} type="button" onClick={() => setReportPreview(report)} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 text-left">
                    <div>
                      <strong>{report.reportNumber ?? `Z-${String(report.zNumber ?? 0).padStart(6, '0')}`}</strong>
                      <p className="font-body text-body-sm text-outline">{report.businessDate} · Sales {formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT</p>
                      <p className="font-body text-body-sm">
                        Expected ex-float {formatTnd(amounts.expected / 1000)} ·
                        Counted {formatTnd(amounts.counted / 1000)} ·
                        Difference {formatTnd(amounts.difference / 1000)}
                      </p>
                    </div>
                    <StatusTag status="closed">{report.pinVerified === false ? 'PIN unavailable' : 'PIN verified'}</StatusTag>
                  </button>
                );
              })}
              {archiveReports.filter((report) => report.type === 'Z').length === 0 && <p className="font-body text-body-sm text-outline">No Z reports yet.</p>}
            </div>
          )}
          {reportPreview && <div className="mt-4"><ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} /></div>}
        </section>
      )}

      {closedShiftSummary && (!ownerMode || activeTab === 'shifts') && (
        <ClosedShiftSummary
          shift={closedShiftSummary.shift}
          breakdown={closedShiftSummary.breakdown}
          onDone={() => setClosedShiftSummary(undefined)}
        />
      )}

      {(!ownerMode || activeTab === 'shifts') && (ownOpenShift ? (
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
              <Metric label="Cash sales" amount={ownBreakdown.cashSalesMillimes} />
              <Metric label="Tab payments received in cash" amount={ownBreakdown.tabPaymentsMillimes} />
              <Metric label={t('shift.expectedCash')} amount={getExpectedCash(ownOpenShift, ownBreakdown, cashMovements)} prominent />
            </div>
            {canCashInOut && !ownerMode && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => openCashMovement('in', ownOpenShift.id)}><MaterialIcon name="add" />Cash in</Button>
                <Button type="button" variant="secondary" onClick={() => openCashMovement('out', ownOpenShift.id)}><MaterialIcon name="remove" />Cash out</Button>
              </div>
            )}
            <CashMovementList movements={movementsForShift(ownOpenShift.id)} staffNames={staffNames} />
          </section>
          <Button className="w-full lg:w-auto" onClick={() => setCloseShiftSheetOpen(true)}>
            <MaterialIcon name="lock" />{t('shift.closeShift')}
          </Button>
        </div>
      ) : !closedShiftSummary ? (
        <Button className="w-full max-w-xl lg:hidden" onClick={() => setOpenShiftSheetOpen(true)}>
          <MaterialIcon name="lock_open" />{t('shift.openShift')}
        </Button>
      ) : null)}

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      {(!ownerMode || activeTab === 'shifts') && <section className="mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{t('shift.history')}</h2>
        {loading ? <ListSkeleton label="Loading shifts" /> : <DataTable<ShiftRecord>
          rows={shifts}
          getRowKey={(shift) => shift.id}
          columns={[
            { key: 'staff', label: 'Staff', sortValue: (shift) => staffNames[shift.staffId] ?? 'Staff', render: (shift) => staffNames[shift.staffId] ?? 'Staff' },
            { key: 'opened', label: 'Opened', sortValue: (shift) => shift.openedAt, render: (shift) => new Date(shift.openedAt).toLocaleString() },
            { key: 'closed', label: 'Closed', sortValue: (shift) => shift.closedAt ?? '', render: (shift) => shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—' },
            { key: 'status', label: 'Status', render: (shift) => shift.status === 'open' ? 'Open' : 'Closed' },
            { key: 'difference', label: 'Difference', sortValue: (shift) => shift.differenceMillimes ?? 0, render: (shift) => shift.differenceMillimes === undefined ? '—' : `${formatTnd(shift.differenceMillimes / 1000)} DT` },
            { key: 'actions', label: 'Actions', render: (shift) => (
              <details className="shift-movements-disclosure">
                <summary className="cursor-pointer text-primary">Cash movements</summary>
                <CashMovementList movements={movementsForShift(shift.id)} staffNames={staffNames} />
              </details>
            ) },
          ] satisfies DataTableColumn<ShiftRecord>[]}
          mobileCards={(shift) => (
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
              <CashMovementList movements={movementsForShift(shift.id)} staffNames={staffNames} />
              {ownerMode && shift.status === 'open' && user?.role === 'owner' && (
                <Button variant="danger" className="w-full" onClick={() => setForceCloseShiftTarget(shift)}>
                  <MaterialIcon name="lock" />Force close shift
                </Button>
              )}
            </article>
          )}
          empty={!loading && !error ? <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p> : undefined}
        />}
      </section>}
      <BottomSheet open={openShiftSheetOpen} onClose={() => setOpenShiftSheetOpen(false)} title={t('shift.openShift')}>
        <form onSubmit={(event) => { void openShift(event); }} className="flex flex-col gap-3">
          <p className="font-body text-body-sm text-on-surface-variant">Count the cash drawer before taking orders.</p>
          <label htmlFor="starting-cash" className="block font-body text-label-md">{t('shift.startingCash')} (TND)</label>
          <input id="starting-cash" inputMode="decimal" required value={startingCash} onChange={(event) => { setStartingCash(event.target.value); setStartingCashEdited(true); }} className="h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
          <Keypad decimal onPress={(value) => { setStartingCash((current) => appendDecimalAmount(current, value)); setStartingCashEdited(true); }} onClear={() => { setStartingCash(''); setStartingCashEdited(true); }} onBackspace={() => { setStartingCash((current) => current.slice(0, -1)); setStartingCashEdited(true); }} />
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpenShiftSheetOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit"><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
          </div>
        </form>
      </BottomSheet>
      <BottomSheet
        open={zSheetOpen}
        onClose={() => { setZSheetOpen(false); setOwnerPin(''); setZCountedCash(''); setZNote(''); setZStep(1); }}
        title="Close day: Z report"
      >
        {zStep === 1 ? (
          <form onSubmit={(event) => { event.preventDefault(); void verifyZOwnerPin(); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">Verify the owner PIN to continue with the Z close.</p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <label className="font-body text-label-md">Owner PIN
              <input readOnly value={ownerPin} placeholder="••••" className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            <div className="sheet-action-bar grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => { setZSheetOpen(false); setOwnerPin(''); setZStep(1); }}>Cancel</Button>
              <Button type="submit" disabled={zBusy || ownerPin.length !== 4}><MaterialIcon name="lock" />Continue</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void closeDayWithZ(); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">Review each closed shift, then count the drawer without its starting floats.</p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <div className="space-y-3 rounded-xl bg-surface-container-low p-3">
              {zShiftLines.map((shift) => (
                <section key={shift.shiftId} className="space-y-1 border-b border-outline-variant pb-3 last:border-0 last:pb-0">
                  <h3 className="font-display text-title-sm">{shift.staffName}</h3>
                  <Metric label="Float - not counted" amount={shift.startingCashMillimes} />
                  <Metric label="Cash sales" amount={shift.cashSalesMillimes ?? 0} />
                  <Metric label="Tab payments in cash" amount={shift.tabPaymentsMillimes ?? 0} />
                  <Metric label="Cash in" amount={shift.cashInMillimes ?? 0} />
                  <Metric label="Cash out" amount={shift.cashOutMillimes ?? 0} />
                  <Metric label="Cash flow ex-float" amount={shift.cashFlowExFloatMillimes ?? 0} />
                </section>
              ))}
            </div>
            <label className="font-body text-label-md">Total cash in drawer WITHOUT the float (TND)
              <input readOnly inputMode="none" value={zCountedCash} placeholder="0.000" className="mt-1.5 h-14 w-full rounded-xl bg-surface-container-low px-4 font-display text-title-md tabular-nums" />
            </label>
            <Keypad decimal onPress={(value) => setZCountedCash((current) => appendDecimalAmount(current, value))} onClear={() => setZCountedCash('')} onBackspace={() => setZCountedCash((current) => current.slice(0, -1))} />
            {zDifference !== undefined && (
              <div className="space-y-2 rounded-xl bg-surface-container-low p-3" aria-live="polite">
                <Metric label="Expected cash ex-float" amount={zExpectedCash} prominent />
                <p className={`text-center font-display text-title-md font-bold ${
                  zDifference < 0 ? 'text-error-dark' : zDifference > 0 ? 'text-warning-dark' : 'text-success-dark'
                }`}>
                  {zDifference < 0
                    ? `SHORT ${formatTnd(Math.abs(zDifference) / 1000)} DT`
                    : zDifference > 0
                      ? `OVER ${formatTnd(zDifference / 1000)} DT`
                      : 'BALANCED'}
                </p>
              </div>
            )}
            <label className="font-body text-label-md">Note{zDifference !== undefined && zDifference !== 0 ? ' (required)' : ' (optional)'}
              <textarea
                required={zDifference !== undefined && zDifference !== 0}
                maxLength={500}
                rows={2}
                value={zNote}
                onChange={(event) => setZNote(event.target.value)}
                className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3"
              />
            </label>
            <div className="sheet-action-bar grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => { setError(''); setZStep(1); }}>Back</Button>
              <Button
                type="submit"
                variant="danger"
                disabled={zBusy || parsedZCountedCash === undefined || (zDifference !== undefined && zDifference !== 0 && !zNote.trim())}
              >
                <MaterialIcon name="lock" />Confirm Z close
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>
      <BottomSheet open={closeShiftSheetOpen && Boolean(ownOpenShift)} onClose={() => setCloseShiftSheetOpen(false)} title={t('shift.closeShift')}>
        {ownOpenShift && <ShiftCloseForm
          shift={ownOpenShift}
          breakdown={ownBreakdown}
          movements={cashMovements}
          countedCash={countedCash}
          differenceNote={differenceNote}
          onCountPress={pressCountedCash}
          onCountClear={() => setCountedCash('')}
          onCountBackspace={() => setCountedCash((value) => value.slice(0, -1))}
          onNoteChange={setDifferenceNote}
          onSubmit={(event) => { void closeShift(event); }}
          submitLabel={t('shift.closeShift')}
        />}
      </BottomSheet>
      <BottomSheet open={forceCloseShiftTarget !== null} onClose={() => setForceCloseShiftTarget(null)} title="Force close shift">
        {forceCloseShiftTarget && <ShiftCloseForm
          key={forceCloseShiftTarget.id}
          shift={forceCloseShiftTarget}
          breakdown={breakdownsByShift[forceCloseShiftTarget.id] ?? emptyShiftBreakdown}
          movements={cashMovements}
          countedCash={forceCountedCash[forceCloseShiftTarget.id] ?? ''}
          differenceNote={forceDifferenceNotes[forceCloseShiftTarget.id] ?? ''}
          onCountPress={(value) => pressForceCountedCash(forceCloseShiftTarget.id, value)}
          onCountClear={() => setForceCountedCash((current) => ({ ...current, [forceCloseShiftTarget.id]: '' }))}
          onCountBackspace={() => setForceCountedCash((current) => ({ ...current, [forceCloseShiftTarget.id]: (current[forceCloseShiftTarget.id] ?? '').slice(0, -1) }))}
          onNoteChange={(value) => setForceDifferenceNotes((current) => ({ ...current, [forceCloseShiftTarget.id]: value }))}
          onSubmit={(event) => { void forceCloseShift(event, forceCloseShiftTarget); }}
          submitLabel="Force close"
          ownerMode
        />}
      </BottomSheet>
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
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
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

function getCashMovementTotals(movements: CashMovementRecord[], shiftId: string) {
  return movements
    .filter((movement) => movement.shiftId === shiftId)
    .reduce((totals, movement) => {
      totals[movement.kind === 'in' ? 'cashInMillimes' : 'cashOutMillimes'] += movement.amountMillimes;
      return totals;
    }, { cashInMillimes: 0, cashOutMillimes: 0 });
}

function getExpectedCash(shift: ShiftRecord, breakdown: ShiftCloseBreakdown, movements: CashMovementRecord[]) {
  const movementTotals = getCashMovementTotals(movements, shift.id);
  return shift.startingCashMillimes + breakdown.cashSalesMillimes + breakdown.tabPaymentsMillimes +
    movementTotals.cashInMillimes - movementTotals.cashOutMillimes;
}

function appendDecimalAmount(current: string, value: string) {
  if (value === '.') {
    if (current.includes('.')) return current;
    return current ? `${current}.` : '0.';
  }
  const [whole, fraction] = current.split('.');
  if (whole.length >= 9 || (fraction !== undefined && fraction.length >= 3)) return current;
  return current + value;
}

function ShiftCloseForm({
  shift,
  breakdown,
  movements,
  countedCash,
  differenceNote,
  onCountPress,
  onCountClear,
  onCountBackspace,
  onNoteChange,
  onSubmit,
  submitLabel,
  ownerMode = false,
}: {
  shift: ShiftRecord;
  breakdown: ShiftCloseBreakdown;
  movements: CashMovementRecord[];
  countedCash: string;
  differenceNote: string;
  onCountPress: (value: string) => void;
  onCountClear: () => void;
  onCountBackspace: () => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  ownerMode?: boolean;
}) {
  const movementTotals = getCashMovementTotals(movements, shift.id);
  const expectedCash = getExpectedCash(shift, breakdown, movements);
  const parsedCount = countedCash.trim() ? Number(countedCash.replace(',', '.')) : Number.NaN;
  const countedCashMillimes = Number.isFinite(parsedCount) && parsedCount >= 0
    ? Math.round(parsedCount * 1000)
    : undefined;
  const difference = countedCashMillimes === undefined ? undefined : countedCashMillimes - expectedCash;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <h2 className="font-display text-headline-md text-on-surface">{ownerMode ? 'Owner force close' : t('shift.closeShift')}</h2>
      {breakdown.pendingVoidCount > 0 && (
        <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">
          {t('shift.pendingVoidWarning', { count: breakdown.pendingVoidCount })}
        </p>
      )}
      <div className="space-y-2 rounded-xl bg-surface-container-low p-3">
        <Metric label="Starting cash (float)" amount={shift.startingCashMillimes} />
        <Metric label="Cash sales" amount={breakdown.cashSalesMillimes} />
        <Metric label="Tab sales (charged to customers; excluded from expected cash)" amount={breakdown.tabSalesMillimes} />
        <Metric label="Tab payments received in cash" amount={breakdown.tabPaymentsMillimes} />
        <Metric label="Cash in" amount={movementTotals.cashInMillimes} />
        <Metric label="Cash out" amount={movementTotals.cashOutMillimes} />
        <Metric label="Comps value" amount={breakdown.compsMillimes} />
        <Metric label="Voids" amount={breakdown.voidsMillimes} />
        <div className="border-t border-outline-variant pt-2">
          <Metric label="Expected cash in drawer" amount={expectedCash} prominent />
        </div>
      </div>
      <label htmlFor={`counted-cash-${shift.id}`} className="font-body text-label-md">{t('shift.countedCash')} (TND)</label>
      <input
        id={`counted-cash-${shift.id}`}
        readOnly
        inputMode="none"
        value={countedCash}
        placeholder="0.000"
        className="h-14 rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary"
      />
      <Keypad
        decimal
        onPress={onCountPress}
        onClear={onCountClear}
        onBackspace={onCountBackspace}
      />
      {difference !== undefined && (
        <p
          aria-live="polite"
          className={`rounded-lg p-3 text-center font-display text-title-md ${
            difference === 0 ? 'bg-success-container text-success-dark' :
              difference < 0 ? 'bg-error-container text-error-dark' : 'bg-warning-container text-on-warning-container'
          }`}
        >
          {difference === 0
            ? 'Balanced'
            : `${difference < 0 ? 'Short' : 'Over'} ${formatTnd(Math.abs(difference) / 1000)} DT`}
        </p>
      )}
      {difference !== undefined && difference !== 0 && (
        <label className="font-body text-label-md text-on-surface">
          Short note (required)
          <textarea
            required
            maxLength={200}
            rows={2}
            value={differenceNote}
            onChange={(event) => onNoteChange(event.target.value)}
            className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3 font-body text-body-md"
          />
        </label>
      )}
      <div className="sheet-action-bar">
        <Button type="submit" variant="danger" className="w-full" disabled={countedCashMillimes === undefined}>
          <MaterialIcon name="lock" />{submitLabel}
        </Button>
      </div>
    </form>
  );
}

function ClosedShiftSummary({
  shift,
  breakdown,
  onDone,
}: {
  shift: ShiftRecord;
  breakdown: ShiftCloseBreakdown;
  onDone: () => void;
}) {
  const closedAt = shift.closedAt ? new Date(shift.closedAt) : new Date(shift.openedAt);
  const durationMs = Math.max(0, closedAt.getTime() - new Date(shift.openedAt).getTime());
  const durationMinutes = Math.floor(durationMs / 60_000);
  const difference = shift.differenceMillimes ?? 0;
  return (
    <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <div className="mb-3">
        <h2 className="font-display text-headline-md text-on-surface">Shift closed</h2>
        <p className="font-body text-body-sm text-on-surface-variant">
          {durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h ` : ''}{durationMinutes % 60}m duration
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-5">
        <SummaryValue label="Orders" value={String(breakdown.orderCount)} />
        <SummaryValue
          label="Cash"
          value={`${formatTnd((shift.countedCashMillimes ?? 0) / 1000)} DT`}
          detail={`Expected ${formatTnd((shift.expectedCashMillimes ?? 0) / 1000)} DT`}
        />
        <SummaryValue label="Tabs" value={`${formatTnd(breakdown.tabSalesMillimes / 1000)} DT`} />
        <SummaryValue
          label="Difference"
          value={`${difference < 0 ? 'Short ' : difference > 0 ? 'Over ' : ''}${formatTnd(Math.abs(difference) / 1000)} DT`}
          valueClass={difference === 0 ? 'text-success-dark' : difference < 0 ? 'text-error-dark' : 'text-warning'}
        />
      </div>
      <Button type="button" className="mt-4 w-full" onClick={onDone}>Done</Button>
    </section>
  );
}

function SummaryValue({ label, value, valueClass = 'text-on-surface', detail }: {
  label: string;
  value: string;
  valueClass?: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-container-low p-3">
      <p className="font-body text-label-sm text-on-surface-variant">{label}</p>
      <p className={`mt-1 font-display text-title-md tabular-nums ${valueClass}`}>{value}</p>
      {detail && <p className="mt-0.5 font-body text-body-sm text-on-surface-variant">{detail}</p>}
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
  return <div className="min-h-screen bg-surface pb-24"><main className="p-0"><PageContainer>{content}</PageContainer></main><BottomNav /></div>;
}
