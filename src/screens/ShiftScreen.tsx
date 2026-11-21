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
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';
import { reportService, type ReportDayStatus } from '../services/reportService';
import { ReportView } from '../components/ReportView';
import type { ReportRecord, ReportShiftLine } from '../types/domain';
import type { OrderRecord } from '../types/domain';
import { Link } from 'react-router-dom';
import { parseNonNegativeMillimes } from '../lib/millimes';

type ShiftCloseBreakdown = ShiftSalesBreakdown & {
  pendingVoidCount: number;
  compsMillimes: number;
};

const emptyShiftBreakdown: ShiftCloseBreakdown = {
  orderCount: 0,
  cashSalesMillimes: 0,
  cardSalesMillimes: 0,
  otherSalesMillimes: 0,
  tabSalesMillimes: 0,
  tabPaymentsMillimes: 0,
  voidsMillimes: 0,
  pendingVoidCount: 0,
  compsMillimes: 0,
};

function parseMillimes(value: string): number {
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined) throw new Error('Enter a non-negative whole number of millimes.');
  return millimes;
}

function reportDrawerAmounts(report: ReportRecord) {
  const cashFloat = report.cashFloatMillimes ??
    (report.shifts ?? []).reduce((sum, shift) => sum + shift.startingCashMillimes, 0);
  const expectedTotal = report.totalExpectedCashMillimes ??
    (report.expectedCashExFloatMillimes ?? 0) + cashFloat;
  const expected = report.countedCashIncludesFloat
    ? expectedTotal
    : report.expectedCashExFloatMillimes ?? expectedTotal - cashFloat;
  const counted = report.countedCashMillimes === undefined
    ? 0
    : report.countedCashIncludesFloat
      ? report.countedCashMillimes
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
  const refreshKey = useFocusRefreshKey();
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownOpenShift, setOwnOpenShift] = useState<ShiftRecord>();
  const [startingCash, setStartingCash] = useState('50000');
  const [startingCashEdited, setStartingCashEdited] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [differenceNote, setDifferenceNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [breakdownsByShift, setBreakdownsByShift] = useState<Record<string, ShiftCloseBreakdown>>({});
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [pendingVoidOrders, setPendingVoidOrders] = useState<OrderRecord[]>([]);
  const [closedShiftSummary, setClosedShiftSummary] = useState<{ shift: ShiftRecord; breakdown: ShiftCloseBreakdown }>();
  const [cashMovements, setCashMovements] = useState<CashMovementRecord[]>([]);
  const [canCashInOut, setCanCashInOut] = useState(false);
  const [canOpenCloseShift, setCanOpenCloseShift] = useState(false);
  const [canPrintOwnX, setCanPrintOwnX] = useState(false);
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
  const [forceShiftPin, setForceShiftPin] = useState('');
  const [forceShiftConfirmed, setForceShiftConfirmed] = useState(false);
  const [forceEverythingConfirmed, setForceEverythingConfirmed] = useState(false);
  const [zCountedCash, setZCountedCash] = useState('');
  const [zExpectedCash, setZExpectedCash] = useState(0);
  const [zCountedCard, setZCountedCard] = useState('');
  const [zCountedOther, setZCountedOther] = useState('');
  const [zExpectedCard, setZExpectedCard] = useState(0);
  const [zExpectedOther, setZExpectedOther] = useState(0);
  const [zPaymentSplit, setZPaymentSplit] = useState({ cash: 0, card: 0, other: 0, tab: 0 });
  const [zCardTabPayments, setZCardTabPayments] = useState(0);
  const [zOtherTabPayments, setZOtherTabPayments] = useState(0);
  const [zVoids, setZVoids] = useState({ count: 0, totalMillimes: 0 });
  const [zPendingVoids, setZPendingVoids] = useState({ count: 0, totalMillimes: 0 });
  const [zReviewed, setZReviewed] = useState(false);
  const [zShiftLines, setZShiftLines] = useState<ReportShiftLine[]>([]);
  const [zStep, setZStep] = useState<0 | 1 | 2>(1);
  const [zBusy, setZBusy] = useState(false);
  const [zNote, setZNote] = useState('');
  const [zSheetOpen, setZSheetOpen] = useState(false);
  const [reportPreview, setReportPreview] = useState<ReportRecord>();
  const [archivePreviewDismissed, setArchivePreviewDismissed] = useState(false);
  const [archiveReports, setArchiveReports] = useState<ReportRecord[]>([]);
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);

  const refresh = useCallback(async () => {
    const [nextShifts, nextOpenShift, nextStore, nextMovements, allOrders, users, cashPermission, shiftPermission, xPermission, comps, nextReports, nextDayStatus] = await Promise.all([
      shiftService.listShifts(storeId),
      user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
      userService.getStore(storeId),
      shiftService.listCashMovements(storeId),
      orderService.listAll(storeId),
      userService.listUsers(storeId),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'cash_in_out') : Promise.resolve(false),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'open_close_shift') : Promise.resolve(false),
      user?.role === 'owner' ? Promise.resolve(false) : user ? userService.hasPermission(user.id, 'print_x_report') : Promise.resolve(false),
      compService.listComps(storeId),
      ownerMode ? reportService.listReports(storeId) : Promise.resolve([]),
      reportService.getDayStatus(storeId),
    ]);
    setShifts(nextShifts);
    setOwnOpenShift(nextOpenShift);
    setStore(nextStore);
    setCashMovements(nextMovements);
    setStaffNames(Object.fromEntries(users.map((member) => [member.id, member.name])));
    setPendingVoidOrders(allOrders.filter((order) => order.status === 'pending_void' &&
      (ownerMode || order.staffId === user?.id)));
    setCanCashInOut(cashPermission);
    setCanOpenCloseShift(shiftPermission);
    setCanPrintOwnX(xPermission);
    setDayStatus(nextDayStatus);
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
  }, [refresh, refreshKey]);

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
      await shiftService.openShift(storeId, user.id, parseMillimes(startingCash));
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
        parseMillimes(countedCash),
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
    if (!forceShiftConfirmed) {
      setError('Confirm the zero-difference force close first.');
      return;
    }
    setError('');
    setNotice('');
    try {
      const closedShift = await shiftService.forceCloseShift(shift.id, forceShiftPin);
      setClosedShiftSummary({ shift: closedShift, breakdown: breakdownsByShift[shift.id] ?? emptyShiftBreakdown });
      setForceShiftPin('');
      setForceShiftConfirmed(false);
      await refresh();
      setForceCloseShiftTarget(null);
      setNotice(`Closed at zero difference, ${closedShift.voidsAutoApprovedCount ?? 0} voids auto-approved.`);
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

  async function createXReport() {
    if (!user) return;
    setError('');
    try {
      const report = ownerMode
        ? await reportService.createXReport(storeId, user.name)
        : await reportService.createOwnShiftXReport(storeId, user.id, user.name);
      setReportPreview(report);
      setNotice(ownerMode ? 'X report created. The day remains open.' : 'Own-shift X preview created. Nothing was recorded as a Z report.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to create the X report.');
    }
  }

  async function openZCloseDialog(forceEverything = false) {
    setError('');
    setOwnerPin('');
    setZCountedCash('');
    setZCountedCard('');
    setZCountedOther('');
    setZExpectedCash(0);
    setZExpectedCard(0);
    setZExpectedOther(0);
    setZPaymentSplit({ cash: 0, card: 0, other: 0, tab: 0 });
    setZCardTabPayments(0);
    setZOtherTabPayments(0);
    setZVoids({ count: 0, totalMillimes: 0 });
    setZPendingVoids({ count: 0, totalMillimes: 0 });
    setZReviewed(false);
    setZShiftLines([]);
    setZStep(1);
    setZNote('');
    if (forceEverything) {
      setZStep(0);
      setForceEverythingConfirmed(false);
      setZSheetOpen(true);
      return;
    }
    try {
      const [nextShifts, allOrders, users] = await Promise.all([
        shiftService.listShifts(storeId),
        orderService.listAll(storeId),
        userService.listUsers(storeId),
      ]);
      const nextOpenShifts = nextShifts.filter((shift) => shift.status === 'open');
      const nextPendingVoids = allOrders.filter((order) => order.status === 'pending_void');
      setShifts(nextShifts);
      setStaffNames(Object.fromEntries(users.map((member) => [member.id, member.name])));
      setPendingVoidOrders(nextPendingVoids);
      if (nextOpenShifts.length || nextPendingVoids.length) {
        setZStep(0);
        setZSheetOpen(true);
        return;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to check open shifts and pending voids.');
      return;
    }
    setZSheetOpen(true);
  }

  async function forceCloseEverything() {
    if (!user || user.role !== 'owner') return;
    if (!forceEverythingConfirmed) {
      setError('Confirm that all pending voids will be approved and open shifts closed at zero difference.');
      return;
    }
    setError('');
    setZBusy(true);
    try {
      const result = await shiftService.forceCloseDay(ownerPin);
      await refresh();
      setOwnerPin('');
      setForceEverythingConfirmed(false);
      setZStep(1);
      setNotice(`Closed ${result.shifts.length} shifts at zero difference; ${result.orders.length} voids auto-approved.`);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Unable to force-close everything.');
    } finally {
      setZBusy(false);
    }
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
      setZExpectedCard(live.paymentSplit.card + live.cardTabPaymentsMillimes);
      setZExpectedOther(live.paymentSplit.other + live.otherTabPaymentsMillimes);
      setZPaymentSplit(live.paymentSplit);
      setZCardTabPayments(live.cardTabPaymentsMillimes);
      setZOtherTabPayments(live.otherTabPaymentsMillimes);
      setZVoids({ count: live.voids.count, totalMillimes: live.voids.totalMillimes });
      setZPendingVoids({ count: live.pendingVoids.count, totalMillimes: live.pendingVoids.totalMillimes });
      setZShiftLines(live.shiftLines.filter((shift) => shift.status === 'closed'));
      setZReviewed(false);
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
    if (!zReviewed) {
      setZReviewed(true);
      return;
    }
    setZBusy(true);
    try {
      if (!ownerPin || !/^\d{4}$/.test(ownerPin)) throw new Error('Owner PIN is required for every Z report.');
      const countedCashMillimes = parseMillimes(zCountedCash);
      const countedCardMillimes = parseMillimes(zCountedCard);
      const countedOtherMillimes = store?.allowOtherPayments ? parseMillimes(zCountedOther) : 0;
      const differenceMillimes = countedCashMillimes - zExpectedCash;
      const cardDifferenceMillimes = countedCardMillimes - zExpectedCard;
      const otherDifferenceMillimes = countedOtherMillimes - zExpectedOther;
      if (differenceMillimes !== 0 && !zNote.trim()) throw new Error('A note is required for a cash difference.');
      if ((cardDifferenceMillimes !== 0 || otherDifferenceMillimes !== 0) && !zNote.trim()) {
        throw new Error('A note is required for a card or other payment difference.');
      }
      const report = await reportService.closeDayWithZReport(storeId, user.name, ownerPin, {
        countedCashMillimes,
        countedCardMillimes,
        countedOtherMillimes,
        note: zNote.trim() || undefined,
      });
      setOwnerPin('');
      setZCountedCash('');
      setZCountedCard('');
      setZCountedOther('');
      setZNote('');
      setZReviewed(false);
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
        amountMillimes: parseMillimes(movementAmount),
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
  const enteredMovementMillimes = parseNonNegativeMillimes(movementAmount);
  const ownBreakdown = ownOpenShift ? breakdownsByShift[ownOpenShift.id] ?? emptyShiftBreakdown : emptyShiftBreakdown;
  const ownMovementTotals = ownOpenShift
    ? getCashMovementTotals(cashMovements, ownOpenShift.id)
    : { cashInMillimes: 0, cashOutMillimes: 0 };
  const pageTitle = t('shift.title');
  const movementsForShift = (shiftId: string) => cashMovements.filter((movement) => movement.shiftId === shiftId);
  const openShifts = shifts.filter((shift) => shift.status === 'open');
  const openStaffNames = openShifts.map((shift) => staffNames[shift.staffId] ?? 'Staff').join(', ');
  const dayStatusMessage = !ownerMode && dayStatus.dayIsClosed
    ? 'Day closed. Open a shift to start a new day.'
    : openCount > 0
    ? `Day open - ${openCount} ${openCount === 1 ? 'shift' : 'shifts'} running${openStaffNames ? `: ${openStaffNames}` : ''}`
    : dayStatus.dayIsClosed
      ? `Day closed - ${dayStatus.lastZ?.reportNumber ?? 'Z report'} at ${dayStatus.lastZ ? new Date(dayStatus.lastZ.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}. Open a shift to start a new day.`
      : dayStatus.hasActivity
        ? 'Day open - no shifts running'
        : 'No shift opened yet today';
  const reportDisabledReason = dayStatus.dayIsClosed
    ? 'The business day is closed. Open a new shift before creating another report.'
    : !dayStatus.hasActivity
      ? 'No shift has been opened yet today.'
      : '';
  const zDisabledReason = reportDisabledReason ||
    (openCount > 0 ? 'Close every open shift before creating a Z report.' : '') ||
    (pendingVoidOrders.length > 0 ? 'Resolve every void request before creating a Z report.' : '');
  const isArchivePreview = reportPreview?.type === 'Z'
    ? reportPreview
    : archivePreviewDismissed
      ? undefined
      : archiveReports.filter((report) => report.type === 'Z')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const parsedZCountedCash = parseNonNegativeMillimes(zCountedCash);
  const zDifference = parsedZCountedCash === undefined ? undefined : parsedZCountedCash - zExpectedCash;
  const parsedZCardMillimes = parseNonNegativeMillimes(zCountedCard);
  const parsedZOtherMillimes = parseNonNegativeMillimes(zCountedOther);
  const zCardDifference = parsedZCardMillimes === undefined ? undefined : parsedZCardMillimes - zExpectedCard;
  const zOtherDifference = store?.allowOtherPayments
    ? parsedZOtherMillimes === undefined ? undefined : parsedZOtherMillimes - zExpectedOther
    : 0;
  const hasZCountInputs = parsedZCountedCash !== undefined &&
    parsedZCardMillimes !== undefined &&
    (!store?.allowOtherPayments || parsedZOtherMillimes !== undefined);
  const hasZDifference = Boolean(zDifference !== undefined && zDifference !== 0 ||
    zCardDifference !== undefined && zCardDifference !== 0 ||
    zOtherDifference !== undefined && zOtherDifference !== 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{pageTitle}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        {ownerMode && !ownOpenShift
          ? <Button onClick={() => setOpenShiftSheetOpen(true)}><MaterialIcon name="lock_open" />Open my shift</Button>
          : ownerMode
            ? <StatusTag status="started">{`${openCount} open`}</StatusTag>
            : canOpenCloseShift && !ownOpenShift && (!closedShiftSummary || dayStatus.dayIsClosed)
              ? <Button onClick={() => setOpenShiftSheetOpen(true)}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
              : null}
      </div>
      <PageHeader className="hidden lg:flex" title={pageTitle} subtitle={store?.name} actions={
        ownerMode
          ? <div className="flex items-center gap-2">
            <StatusTag status="started">{`${openCount} open`}</StatusTag>
            {!ownOpenShift && <Button onClick={() => setOpenShiftSheetOpen(true)}><MaterialIcon name="lock_open" />Open my shift</Button>}
          </div>
          : canOpenCloseShift && !ownOpenShift && (!closedShiftSummary || dayStatus.dayIsClosed)
            ? <Button className="w-full lg:w-auto lg:min-w-[160px]" onClick={() => setOpenShiftSheetOpen(true)}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
            : undefined
      } />
      {(ownerMode || (dayStatus.dayIsClosed && !ownOpenShift)) && (
        <p role="status" className={`mb-4 rounded-xl p-3 font-body text-body-sm ${dayStatus.dayIsClosed ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-low text-on-surface-variant'}`}>
          {dayStatusMessage}
        </p>
      )}
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
            <Button disabled={Boolean(reportDisabledReason)} className="mt-4 w-full" onClick={() => { void createXReport(); }}><MaterialIcon name="summarize" />Print X report</Button>
            {reportDisabledReason && <p className="mt-2 font-body text-body-sm text-outline">{reportDisabledReason}</p>}
          </article>
          <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md">Close day: Z report</h2>
            <p className="mt-2 font-body text-body-sm text-outline">Every Z requires the owner PIN and every shift must be closed.</p>
            {(openShifts.length > 0 || pendingVoidOrders.length > 0) && (
              <div className="mt-4 space-y-3 rounded-xl bg-warning-container p-3 text-on-warning-container">
                <h3 className="font-display text-title-sm">Resolve these before creating a Z report</h3>
                {openShifts.map((shift) => (
                  <p key={shift.id} className="font-body text-body-sm">
                    Open shift · {staffNames[shift.staffId] ?? 'Staff'} · {new Date(shift.openedAt).toLocaleString()}
                  </p>
                ))}
                {pendingVoidOrders.map((order) => (
                  <p key={order.id} className="font-body text-body-sm">
                    Void #{order.number} · {staffNames[order.staffId] ?? order.staffName ?? 'Staff'} ·
                    {' '}{formatTnd(order.totalMillimes / 1000)} DT · {order.voidReason || 'Reason not recorded'}
                  </p>
                ))}
                <div className="grid gap-2 tablet:grid-cols-2">
                  <Link to="/owner/voids" className="flex min-h-12 items-center justify-center rounded-full border border-outline px-4 font-body text-label-md">
                    Review voids
                  </Link>
                  <Button variant="danger" onClick={() => { void openZCloseDialog(true); }}>
                    Force close everything
                  </Button>
                </div>
              </div>
            )}
            <Button disabled={Boolean(zDisabledReason)} variant="danger" className="mt-4 w-full" onClick={() => { void openZCloseDialog(); }}><MaterialIcon name="lock" />Close day: Z report</Button>
            {zDisabledReason && <p role="status" className="mt-2 rounded-lg bg-warning-container p-3 text-on-warning-container">{zDisabledReason}</p>}
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
                  <button key={report.id} type="button" onClick={() => { setReportPreview(report); setArchivePreviewDismissed(false); }} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 text-left">
                    <div>
                      <strong>{report.reportNumber ?? `Z-${String(report.zNumber ?? 0).padStart(6, '0')}`}</strong>
                      <p className="font-body text-body-sm text-outline">{report.businessDate} · Sales {formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT</p>
                      <p className="font-body text-body-sm">
                        Expected {report.countedCashIncludesFloat ? 'total cash' : 'ex-float'} {formatTnd(amounts.expected / 1000)} ·
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
          {isArchivePreview && <div className="mt-4"><ReportView inline report={isArchivePreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => { setReportPreview(undefined); setArchivePreviewDismissed(true); }} /></div>}
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
              <Metric label="Card sales" amount={ownBreakdown.cardSalesMillimes} />
              {store?.allowOtherPayments && <Metric label="Other sales" amount={ownBreakdown.otherSalesMillimes} />}
              <Metric label="Tab sales" amount={ownBreakdown.tabSalesMillimes} />
              <Metric label="Tab payments received in cash" amount={ownBreakdown.tabPaymentsMillimes} />
              <Metric label="Cash in" amount={ownMovementTotals.cashInMillimes} />
              <Metric label="Cash out" amount={ownMovementTotals.cashOutMillimes} />
              <Metric label={t('shift.expectedCash')} amount={getExpectedCash(ownOpenShift, ownBreakdown, cashMovements)} prominent />
            </div>
            {canCashInOut && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => openCashMovement('in', ownOpenShift.id)}><MaterialIcon name="add" />Cash in</Button>
                <Button type="button" variant="secondary" onClick={() => openCashMovement('out', ownOpenShift.id)}><MaterialIcon name="remove" />Cash out</Button>
              </div>
            )}
            <CashMovementList movements={movementsForShift(ownOpenShift.id)} staffNames={staffNames} />
          </section>
          <div className="flex flex-col gap-2">
            {canPrintOwnX && <Button variant="secondary" onClick={() => { void createXReport(); }}>
              <MaterialIcon name="summarize" />Print X for my shift
            </Button>}
            {canOpenCloseShift && <Button className="w-full lg:w-auto" onClick={() => setCloseShiftSheetOpen(true)}>
              <MaterialIcon name="lock" />{t('shift.closeShift')}
            </Button>}
          </div>
        </div>
      ) : canOpenCloseShift && (!closedShiftSummary || ownerMode || dayStatus.dayIsClosed) ? (
        <Button className="w-full max-w-xl" onClick={() => setOpenShiftSheetOpen(true)}>
          <MaterialIcon name="lock_open" />{ownerMode ? 'Open my shift' : t('shift.openShift')}
        </Button>
      ) : null)}

      {reportPreview && !ownerMode && <div className="mt-4">
        <ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} />
      </div>}

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
            { key: 'status', label: 'Status', render: (shift) => (
              <div className="flex flex-col items-start gap-1">
                <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Open' : 'Closed'}</StatusTag>
                {shift.forceClosedByOwner && <span className="font-body text-label-sm text-warning">Closed by force</span>}
                {(shift.voidsAutoApprovedCount ?? 0) > 0 && <span className="font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</span>}
              </div>
            ) },
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
                {shift.forceClosedByOwner && <p className="mt-1 font-body text-label-sm text-warning">Closed by force</p>}
                {(shift.voidsAutoApprovedCount ?? 0) > 0 && <p className="mt-1 font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</p>}
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
                <Button variant="danger" className="w-full" onClick={() => {
                  setForceCloseShiftTarget(shift);
                  setForceShiftPin('');
                  setForceShiftConfirmed(false);
                }}>
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
          <label htmlFor="starting-cash" className="block font-body text-label-md">{t('shift.startingCash')} (millimes)</label>
          <input id="starting-cash" type="number" min="0" step="1" inputMode="numeric" required value={startingCash} onChange={(event) => { setStartingCash(event.target.value); setStartingCashEdited(true); }} className="h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
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
        {zStep === 0 ? (
          <form onSubmit={(event) => { event.preventDefault(); void forceCloseEverything(); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">
              All pending voids will be approved and all open shifts closed with zero difference
            </p>
            <div className="space-y-2 rounded-xl bg-surface-container-low p-3">
              {openShifts.map((shift) => (
                <p key={shift.id} className="font-body text-body-sm">
                  Open shift · {staffNames[shift.staffId] ?? 'Staff'} · {new Date(shift.openedAt).toLocaleString()}
                </p>
              ))}
              {pendingVoidOrders.map((order) => (
                <p key={order.id} className="font-body text-body-sm">
                  Void #{order.number} · {staffNames[order.staffId] ?? order.staffName ?? 'Staff'} ·
                  {' '}{formatTnd(order.totalMillimes / 1000)} DT · {order.voidReason || 'Reason not recorded'}
                </p>
              ))}
              <Link to="/owner/voids" className="inline-flex min-h-10 items-center font-body text-label-md text-primary underline">
                Review voids
              </Link>
            </div>
            <label className="flex items-start gap-2 font-body text-body-sm text-on-surface">
              <input
                type="checkbox"
                checked={forceEverythingConfirmed}
                onChange={(event) => setForceEverythingConfirmed(event.target.checked)}
              />
              Confirm: all pending voids will be approved and all open shifts closed with zero difference.
            </label>
            <label className="font-body text-label-md">Owner PIN
              <input readOnly value={ownerPin} placeholder="••••" className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <div className="sheet-action-bar grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => setZSheetOpen(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={zBusy || ownerPin.length !== 4 || !forceEverythingConfirmed}>
                Force close everything
              </Button>
            </div>
          </form>
        ) : zStep === 1 ? (
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
            <p className="font-body text-body-sm text-on-surface-variant">Review the recorded activity, then count the whole-day cash and card totals. Exclude shift opening floats from the cash count; each shift's float is shown separately for reference. Submit your counts to reveal the differences.</p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <div className="space-y-3 rounded-xl bg-surface-container-low p-3">
              <section className="space-y-1 border-b border-outline-variant pb-3">
                <h3 className="font-display text-title-sm">Period sales and voids</h3>
                <Metric label="Cash / card / other / tab sales" amount={zPaymentSplit.cash + zPaymentSplit.card + zPaymentSplit.other + zPaymentSplit.tab} />
                <p className="font-body text-body-sm text-on-surface-variant">
                  Cash {formatTnd(zPaymentSplit.cash / 1000)} · Card {formatTnd(zPaymentSplit.card / 1000)} · Other {formatTnd(zPaymentSplit.other / 1000)} · Tab {formatTnd(zPaymentSplit.tab / 1000)}
                </p>
                <p className="font-body text-body-sm text-on-surface-variant">
                  Non-cash tab payments · Card {formatTnd(zCardTabPayments / 1000)} · Other {formatTnd(zOtherTabPayments / 1000)}
                </p>
                <Metric label={`Voided orders (${zVoids.count})`} amount={zVoids.totalMillimes} />
                <Metric label={`Pending void requests (${zPendingVoids.count})`} amount={zPendingVoids.totalMillimes} />
              </section>
              <section className="space-y-1 border-b border-outline-variant pb-3">
                <h3 className="font-display text-title-sm">Day totals</h3>
                <Metric label="Opening floats (excluded from cash count)" amount={zShiftLines.reduce((total, shift) => total + shift.startingCashMillimes, 0)} />
                <Metric label="Cash sales" amount={zPaymentSplit.cash} />
                <Metric label="Cash tab payments" amount={zShiftLines.reduce((total, shift) => total + (shift.tabPaymentsMillimes ?? 0), 0)} />
                <Metric label="Cash in" amount={zShiftLines.reduce((total, shift) => total + (shift.cashInMillimes ?? 0), 0)} />
                <Metric label="Cash out" amount={zShiftLines.reduce((total, shift) => total + (shift.cashOutMillimes ?? 0), 0)} />
                <Metric label="Card total (sales + tab payments)" amount={zExpectedCard} />
                {store?.allowOtherPayments && <Metric label="Other total (sales + tab payments)" amount={zExpectedOther} />}
              </section>
              {zShiftLines.map((shift) => (
                <section key={shift.shiftId} className="space-y-1 border-b border-outline-variant pb-3 last:border-0 last:pb-0">
                  <h3 className="font-display text-title-sm">{shift.staffName}</h3>
                  <p className="font-body text-body-xs text-on-surface-variant">
                    Opened {new Date(shift.openedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} ·
                    {' '}Closed {shift.closedAt ? new Date(shift.closedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </p>
                  <Metric label="Float" amount={shift.startingCashMillimes} />
                  <Metric label="Cash sales" amount={shift.cashSalesMillimes ?? 0} />
                  <Metric label="Card sales" amount={shift.cardSalesMillimes ?? 0} />
                  {store?.allowOtherPayments && <Metric label="Other sales" amount={shift.otherSalesMillimes ?? 0} />}
                  <Metric label="Tab sales (not cash)" amount={shift.tabSalesMillimes ?? 0} />
                  <Metric label="Tab payments in cash" amount={shift.tabPaymentsMillimes ?? 0} />
                  <Metric label="Cash in" amount={shift.cashInMillimes ?? 0} />
                  <Metric label="Cash out" amount={shift.cashOutMillimes ?? 0} />
                  <Metric label="Post-close void adjustments" amount={shift.voidAdjustmentMillimes ?? 0} />
                  {shift.forceClosedByOwner && <p className="font-body text-label-sm text-warning">Closed by force</p>}
                  {shift.forceClosedByOwner && <p className="font-body text-label-sm text-warning">Unverified count · auto-approved voids: {shift.voidsAutoApprovedCount ?? 0}</p>}
                </section>
              ))}
            </div>
            <label className="font-body text-label-md">Total cash for the day, excluding opening floats (millimes)
              <input type="number" min="0" step="1" inputMode="numeric" required value={zCountedCash} onChange={(event) => setZCountedCash(event.target.value)} placeholder="0" className="mt-1.5 h-14 w-full rounded-xl bg-surface-container-low px-4 font-display text-title-md tabular-nums" />
            </label>
            <label className="font-body text-label-md">Total card payments in period (millimes)
              <input type="number" min="0" step="1" inputMode="numeric" required value={zCountedCard} onChange={(event) => setZCountedCard(event.target.value)} placeholder="0" className="mt-1.5 h-14 w-full rounded-xl bg-surface-container-low px-4 font-display text-title-md tabular-nums" />
            </label>
            {store?.allowOtherPayments && <>
              <label className="font-body text-label-md">Total other payments in period (millimes)
                <input type="number" min="0" step="1" inputMode="numeric" required value={zCountedOther} onChange={(event) => setZCountedOther(event.target.value)} placeholder="0" className="mt-1.5 h-14 w-full rounded-xl bg-surface-container-low px-4 font-display text-title-md tabular-nums" />
              </label>
            </>}
            {zReviewed && zDifference !== undefined && (
              <div className="space-y-2 rounded-xl bg-surface-container-low p-3" aria-live="polite">
                <Metric label="Counted day cash (excluding floats)" amount={parsedZCountedCash ?? 0} />
                <Metric label="Expected day cash (excluding floats)" amount={zExpectedCash} prominent />
                <p className={`text-center font-display text-title-md font-bold ${
                  zDifference < 0 ? 'text-error-dark' : zDifference > 0 ? 'text-warning-dark' : 'text-success-dark'
                }`}>
                  {zDifference < 0
                    ? `SHORT ${formatTnd(Math.abs(zDifference) / 1000)} DT`
                    : zDifference > 0
                      ? `OVER ${formatTnd(zDifference / 1000)} DT`
                      : 'BALANCED'}
                </p>
                <Metric label="Counted card" amount={parsedZCardMillimes ?? 0} />
                <Metric label="Expected card (sales + tab payments)" amount={zExpectedCard} />
                <p className="text-center font-display text-title-sm font-bold">
                  Card {zCardDifference === 0 ? 'BALANCED' : zCardDifference !== undefined && zCardDifference < 0 ? `SHORT ${formatTnd(Math.abs(zCardDifference) / 1000)} DT` : zCardDifference !== undefined ? `OVER ${formatTnd(zCardDifference / 1000)} DT` : ''}
                </p>
                {store?.allowOtherPayments && <>
                  <Metric label="Counted other" amount={parsedZOtherMillimes ?? 0} />
                  <Metric label="Expected other (sales + tab payments)" amount={zExpectedOther} />
                  <p className="text-center font-display text-title-sm font-bold">
                    Other {zOtherDifference === 0 ? 'BALANCED' : zOtherDifference !== undefined && zOtherDifference < 0 ? `SHORT ${formatTnd(Math.abs(zOtherDifference) / 1000)} DT` : zOtherDifference !== undefined ? `OVER ${formatTnd(zOtherDifference / 1000)} DT` : ''}
                  </p>
                </>}
              </div>
            )}
            <label className="font-body text-label-md">Note{zReviewed && hasZDifference ? ' (required)' : ' (optional)'}
              <textarea
                required={zReviewed && hasZDifference}
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
                disabled={zBusy || !hasZCountInputs || (zReviewed && hasZDifference && !zNote.trim())}
              >
                <MaterialIcon name="lock" />{zReviewed ? 'Confirm Z close' : 'Review counts'}
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
          onCountChange={setCountedCash}
          onNoteChange={setDifferenceNote}
          onSubmit={(event) => { void closeShift(event); }}
          submitLabel={t('shift.closeShift')}
          pendingVoidOrders={pendingVoidOrders.filter((order) => order.shiftId === ownOpenShift.id)}
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
              <input readOnly value={forceShiftPin} placeholder="••••" className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
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
      >
        <form onSubmit={(event) => { void submitCashMovement(event); }} className="flex flex-col gap-3">
          <label htmlFor="cash-movement-amount" className="font-body text-label-md text-on-surface">Amount (millimes)</label>
          <input
            id="cash-movement-amount"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            required
            value={movementAmount}
            onChange={(event) => setMovementAmount(event.target.value)}
            placeholder="0"
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

function ShiftCloseForm({
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
}) {
  const [reviewed, setReviewed] = useState(false);
  const movementTotals = getCashMovementTotals(movements, shift.id);
  const expectedCash = getExpectedCash(shift, breakdown, movements);
  const countedCashMillimes = parseNonNegativeMillimes(countedCash);
  const difference = countedCashMillimes === undefined ? undefined : countedCashMillimes - expectedCash;
  function submitOrReview(event: FormEvent<HTMLFormElement>) {
    if (!reviewed) {
      event.preventDefault();
      setReviewed(true);
      return;
    }
    onSubmit(event);
  }

  return (
    <form onSubmit={submitOrReview} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <h2 className="font-display text-headline-md text-on-surface">{t('shift.closeShift')}</h2>
      {breakdown.pendingVoidCount > 0 && (
        <section className="space-y-2 rounded-lg bg-warning-container p-3 text-on-warning-container">
          <h3 className="font-body text-label-md">Pending voids are treated as voided for sales and cash until rejected. Stock is held until approval.</h3>
          {pendingVoidOrders.map((order) => (
            <p key={order.id} className="font-body text-body-sm">
              #{order.number} · {formatTnd(order.totalMillimes / 1000)} DT · {order.voidReason || 'Reason not recorded'}
            </p>
          ))}
        </section>
      )}
      <div className="space-y-2 rounded-xl bg-surface-container-low p-3">
        <Metric label="Starting cash (float)" amount={shift.startingCashMillimes} />
        <Metric label="Cash sales" amount={breakdown.cashSalesMillimes} />
        <Metric label="Card sales" amount={breakdown.cardSalesMillimes} />
        <Metric label="Other sales" amount={breakdown.otherSalesMillimes} />
        <Metric label="Tab sales (charged to customers; excluded from expected cash)" amount={breakdown.tabSalesMillimes} />
        <Metric label="Tab payments received in cash" amount={breakdown.tabPaymentsMillimes} />
        <Metric label="Cash in" amount={movementTotals.cashInMillimes} />
        <Metric label="Cash out" amount={movementTotals.cashOutMillimes} />
        <Metric label="Comps value" amount={breakdown.compsMillimes} />
        <Metric label="Voids" amount={breakdown.voidsMillimes} />
        {reviewed && countedCashMillimes !== undefined && <>
          <div className="border-t border-outline-variant pt-2">
            <Metric label="Counted cash" amount={countedCashMillimes} />
            <Metric label="Expected cash in drawer" amount={expectedCash} prominent />
          </div>
        </>}
      </div>
      <label htmlFor={`counted-cash-${shift.id}`} className="font-body text-label-md">{t('shift.countedCash')} (millimes)</label>
      <input
        id={`counted-cash-${shift.id}`}
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        required
        value={countedCash}
        onChange={(event) => onCountChange(event.target.value)}
        placeholder="0"
        className="h-14 rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary"
      />
      {reviewed && difference !== undefined && (
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
      {reviewed && difference !== undefined && difference !== 0 && (
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
        <Button type="submit" variant="danger" className="w-full" disabled={countedCashMillimes === undefined || (reviewed && difference !== 0 && !differenceNote.trim())}>
          <MaterialIcon name={reviewed ? 'lock' : 'calculate'} />{reviewed ? submitLabel : 'Review count'}
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
