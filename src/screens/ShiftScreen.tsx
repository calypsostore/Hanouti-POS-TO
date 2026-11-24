import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Ban,
  Banknote,
  Calculator,
  CreditCard,
  Ellipsis,
  Flag,
  HandCoins,
  ReceiptText,
  Scale,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { DinarInput } from '../components/DinarInput';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { FirstRunHint } from '../components/FirstRunHint';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatTnd } from '../lib/format';
import {
  getShiftOverviewChange,
  getShiftOverviewDateRange,
  getShiftOverviewSeries,
  type ShiftOverviewAnalytics,
  type ShiftOverviewFilter,
  type ShiftOverviewMetricKey,
} from '../lib/shiftOverview';
import { orderService } from '../services/orderService';
import { CashMovementNotificationError, shiftService } from '../services/shiftService';
import { compService } from '../services/compService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { resolveStoreSettings, type CashMovementReason, type CashMovementRecord, type ShiftRecord } from '../types/domain';
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
import type { OrderRecord, ReportRecord, ReportShiftLine, UnresolvedTabReversalRecord } from '../types/domain';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { parseNonNegativeMillimes } from '../lib/millimes';
import { createLatestRequestGuard } from '../lib/requestGuard';
import { ShiftNotificationsButton } from '../components/ShiftNotificationsButton';
import { WorkspaceSearch } from '../components/WorkspaceSearch';
import { getReportCloseDate } from '../lib/reportArchive';
import { dateKeyInTimezone } from '../lib/date';

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
  cardTabPaymentsMillimes: 0,
  otherTabPaymentsMillimes: 0,
  voidsMillimes: 0,
  pendingVoidCount: 0,
  compsMillimes: 0,
};

function parseMillimes(value: string): number {
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined) throw new Error('Enter a valid non-negative TND amount with up to three decimal places.');
  return millimes;
}

const cashMovementReasons: { reason: CashMovementReason; label: string }[] = [
  { reason: 'supplier', label: 'Bought milk' },
  { reason: 'change', label: 'Change float' },
  { reason: 'expense', label: 'Expense' },
  { reason: 'other', label: 'Other' },
];

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

function getSparklinePath(values: number[]): string {
  if (values.length < 2) return '';
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${points.join(' L')}`;
}

function smoothSparklinePath(path: string): string {
  const points = Array.from(
    path.matchAll(/(?:M|L)([\d.]+),([\d.]+)/g),
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  );
  if (points.length < 3) return path;

  let smoothPath = `M${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const nextPoint = points[index + 1];
    smoothPath += ` Q${point.x},${point.y} ${(point.x + nextPoint.x) / 2},${(point.y + nextPoint.y) / 2}`;
  }
  const lastPoint = points[points.length - 1];
  const previousPoint = points[points.length - 2];
  return `${smoothPath} Q${previousPoint.x},${previousPoint.y} ${lastPoint.x},${lastPoint.y}`;
}

function getSparklineAreaPath(values: number[]): string {
  const path = smoothSparklinePath(getSparklinePath(values));
  return path ? `${path} L64,20 L0,20 Z` : '';
}

function ShiftContent({ ownerMode }: { ownerMode: boolean }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const refreshKey = useFocusRefreshKey();
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<ShiftOverviewFilter>('today');
  const [customOverviewFrom, setCustomOverviewFrom] = useState(() => localDateKey(new Date()));
  const [customOverviewTo, setCustomOverviewTo] = useState(() => localDateKey(new Date()));
  const [overviewAnalytics, setOverviewAnalytics] = useState<ShiftOverviewAnalytics>();
  const [overviewLoading, setOverviewLoading] = useState(ownerMode);
  const [overviewError, setOverviewError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ownOpenShift, setOwnOpenShift] = useState<ShiftRecord>();
  const [startingCash, setStartingCash] = useState('');
  const [startingCashEdited, setStartingCashEdited] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [differenceNote, setDifferenceNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const reportTimeZone = store?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayOverviewDate = dateKeyInTimezone(
    new Date(),
    reportTimeZone,
  );
  const overviewRange = useMemo(
    () => getShiftOverviewDateRange(overviewFilter, todayOverviewDate, customOverviewFrom, customOverviewTo),
    [overviewFilter, todayOverviewDate, customOverviewFrom, customOverviewTo],
  );
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
  const [cashMovementHistoryShift, setCashMovementHistoryShift] = useState<ShiftRecord | null>(null);
  const [cashMovementHistoryClosing, setCashMovementHistoryClosing] = useState(false);
  const cashMovementHistoryCloseTimeoutRef = useRef<number | null>(null);
  const [movementKind, setMovementKind] = useState<'in' | 'out'>('in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState<CashMovementReason>('supplier');
  const [movementNote, setMovementNote] = useState('');
  const [movementBusy, setMovementBusy] = useState(false);
  const [openShiftSheetOpen, setOpenShiftSheetOpen] = useState(false);
  const [closeShiftSheetOpen, setCloseShiftSheetOpen] = useState(false);
  const [forceCloseShiftTarget, setForceCloseShiftTarget] = useState<ShiftRecord | null>(null);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'shifts' | 'reports' | 'archive'>(() => {
    if (!ownerMode) return 'shifts';
    const tab = new URLSearchParams(window.location.search).get('tab');
    return tab === 'reports' || tab === 'archive' ? tab : 'shifts';
  });
  const changeActiveTab = (tab: 'shifts' | 'reports' | 'archive') => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  };
  const [historySearch, setHistorySearch] = useState(() => new URLSearchParams(window.location.search).get('search') ?? '');
  const [historyStatus, setHistoryStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [historyStaff, setHistoryStaff] = useState('all');
  const [historyDate, setHistoryDate] = useState(() => {
    const date = new URLSearchParams(window.location.search).get('date');
    return validDateKey(date) ? date : localDateKey(new Date());
  });
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const tab = query.get('tab');
    if (tab === 'shifts' || tab === 'reports' || tab === 'archive') setActiveTab(tab);
    const search = query.get('search');
    setHistorySearch(search ?? '');
    const date = query.get('date');
    setHistoryDate(validDateKey(date) ? date : localDateKey(new Date()));
  }, [location.search]);
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
  const [zUnresolvedReversals, setZUnresolvedReversals] = useState<UnresolvedTabReversalRecord[]>([]);
  const [zStep, setZStep] = useState<0 | 1 | 2>(1);
  const [zBusy, setZBusy] = useState(false);
  const [zNote, setZNote] = useState('');
  const [zSheetOpen, setZSheetOpen] = useState(false);
  const [reportPreview, setReportPreview] = useState<ReportRecord>();
  const [archivePreviewDismissed, setArchivePreviewDismissed] = useState(false);

  useEffect(() => () => {
    if (cashMovementHistoryCloseTimeoutRef.current !== null) {
      window.clearTimeout(cashMovementHistoryCloseTimeoutRef.current);
    }
  }, []);
  const [archiveReports, setArchiveReports] = useState<ReportRecord[]>([]);
  const [archiveDateOverride, setArchiveDateOverride] = useState<string>();
  const archiveDate = archiveDateOverride ?? todayOverviewDate;
  const [archiveSort, setArchiveSort] = useState<'newest' | 'oldest' | 'amount-desc' | 'amount-asc'>('newest');
  const [previewZoom, setPreviewZoom] = useState(100);
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });
  const [overviewRetry, setOverviewRetry] = useState(0);
  const refreshGuardRef = useRef(createLatestRequestGuard());
  const zSubmissionRef = useRef(false);

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);

  const refresh = useCallback(async () => {
    const generation = refreshGuardRef.current.begin();
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
    if (!refreshGuardRef.current.isLatest(generation)) return;
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
    if (ownerMode) setArchiveReports(nextReports);
    setDayStatus(nextDayStatus);
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
    if (!refreshGuardRef.current.isLatest(generation)) return;
    setBreakdownsByShift(Object.fromEntries(breakdowns));
  }, [storeId, user, ownerMode]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to load shifts.', loadError);
      setError(t('common.loadFailed'));
    }).finally(() => setLoading(false));
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!ownerMode) return;
    let active = true;
    setOverviewAnalytics(undefined);
    setOverviewError('');
    if (!overviewRange) {
      setOverviewError('Choose an end date on or after the start date.');
      setOverviewLoading(false);
      return () => { active = false; };
    }

    setOverviewLoading(true);
    void reportService.getShiftKpiAnalytics(storeId, overviewRange)
      .then((analytics) => {
        if (active) setOverviewAnalytics(analytics);
      })
      .catch((loadError: unknown) => {
        console.error('Unable to load shift KPI analytics.', loadError);
        if (active) setOverviewError(loadError instanceof Error ? loadError.message : 'Unable to load KPI analytics.');
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });
    return () => { active = false; };
  }, [ownerMode, overviewRange, overviewRetry, refreshKey, storeId]);

  useEffect(() => subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications', 'reports', 'stores'], () => {
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
      setStartingCash('');
      setStartingCashEdited(false);
      await refresh();
      setOpenShiftSheetOpen(false);
      setNotice('Shift opened.');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open the shift.');
    }
  }

  function openStartingCashSheet() {
    setStartingCash('');
    setStartingCashEdited(false);
    setOpenShiftSheetOpen(true);
  }

  function closeStartingCashSheet() {
    setStartingCash('');
    setStartingCashEdited(false);
    setOpenShiftSheetOpen(false);
  }

  function openCountedCashSheet() {
    setCountedCash('');
    setDifferenceNote('');
    setCloseShiftSheetOpen(true);
  }

  function closeCountedCashSheet() {
    setCountedCash('');
    setDifferenceNote('');
    setCloseShiftSheetOpen(false);
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
      setNotice(
        shift.differenceMillimes === undefined
          ? 'Cash reconciliation is available to the owner.'
          : shift.differenceMillimes === 0
            ? t('shift.zeroDifference')
            : t('shift.cashDifferenceRecorded'),
      );
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

  function openCashMovementHistory(shift: ShiftRecord) {
    if (cashMovementHistoryCloseTimeoutRef.current !== null) {
      window.clearTimeout(cashMovementHistoryCloseTimeoutRef.current);
      cashMovementHistoryCloseTimeoutRef.current = null;
    }
    setCashMovementHistoryClosing(false);
    setCashMovementHistoryShift(shift);
  }

  function closeCashMovementHistory() {
    if (!cashMovementHistoryShift || cashMovementHistoryClosing) return;
    setCashMovementHistoryClosing(true);
    cashMovementHistoryCloseTimeoutRef.current = window.setTimeout(() => {
      setCashMovementHistoryShift(null);
      setCashMovementHistoryClosing(false);
      cashMovementHistoryCloseTimeoutRef.current = null;
    }, 180);
  }

  function closeCashMovementHistoryAndViewAll() {
    closeCashMovementHistory();
    window.setTimeout(() => {
      document.getElementById('shift-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 180);
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
    try {
      const latestDayStatus = await reportService.getDayStatus(storeId);
      setDayStatus(latestDayStatus);
      if (latestDayStatus.dayIsClosed) {
        setZSheetOpen(false);
        setNotice(latestDayStatus.lastZ
          ? `${latestDayStatus.lastZ.reportNumber} is already closed. Open a new shift to start another period.`
          : 'The Z reporting period is already closed.');
        return;
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to verify whether the Z reporting period is closed.');
      return;
    }
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
    setZUnresolvedReversals([]);
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
      setZUnresolvedReversals(live.unresolvedTabReversals ?? []);
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
    if (zBusy || zSubmissionRef.current) return;
    setError('');
    if (!zReviewed) {
      setZReviewed(true);
      return;
    }
    zSubmissionRef.current = true;
    setZBusy(true);
    try {
      const latestDayStatus = await reportService.getDayStatus(storeId);
      setDayStatus(latestDayStatus);
      if (latestDayStatus.dayIsClosed) {
        throw new Error('This Z reporting period is already closed. A duplicate Z report was not created.');
      }
      if (zUnresolvedReversals.length > 0) {
        throw new Error('Resolve every ambiguous tab reversal before closing the Z report.');
      }
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
      setArchiveDateOverride(getReportCloseDate(report, reportTimeZone));
      setDayStatus({
        dayIsClosed: true,
        hasActivity: false,
        openShiftCount: 0,
        periodFrom: report.periodFrom,
        lastZBoundary: report.periodTo,
        lastZ: {
          reportNumber: report.reportNumber ?? `Z-${String(report.zNumber ?? 0).padStart(6, '0')}`,
          createdAt: report.createdAt,
        },
      });
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Z report was saved, but the screen could not refresh: ${refreshError instanceof Error ? refreshError.message : 'Unknown refresh error'}`);
      }
      setNotice('Z report created and the business day closed.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to close the business day.');
    } finally {
      setZBusy(false);
      zSubmissionRef.current = false;
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
  const filteredHistory = shifts.filter((shift) => {
    const staffName = staffNames[shift.staffId] ?? 'Staff';
    const searchText = `${staffName} ${new Date(shift.openedAt).toLocaleString()} ${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : ''}`.toLocaleLowerCase();
    return (historyStatus === 'all' || shift.status === historyStatus)
      && (historyStaff === 'all' || shift.staffId === historyStaff)
      && (!ownerMode || !historyDate || localDateKey(new Date(shift.openedAt)) === historyDate)
      && (!historySearch.trim() || searchText.includes(historySearch.trim().toLocaleLowerCase()));
  });

  const zReports = archiveReports.filter((report) => report.type === 'Z');
  const filteredArchiveReports = zReports.filter((report) =>
    getReportCloseDate(report, reportTimeZone) === archiveDate).sort((left, right) => {
    if (archiveSort === 'oldest') return left.createdAt.localeCompare(right.createdAt);
    if (archiveSort === 'amount-desc' || archiveSort === 'amount-asc') {
      const leftAmount = left.salesCollectedMillimes ?? left.salesMillimes;
      const rightAmount = right.salesCollectedMillimes ?? right.salesMillimes;
      return archiveSort === 'amount-desc' ? rightAmount - leftAmount : leftAmount - rightAmount;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });

  const isArchivePreview = reportPreview?.type === 'Z' &&
    getReportCloseDate(reportPreview, reportTimeZone) === archiveDate
    ? reportPreview
    : archivePreviewDismissed
      ? undefined
      : filteredArchiveReports[0];
  const liveShiftTotals = openShifts.reduce((totals, shift) => {
    const breakdown = breakdownsByShift[shift.id] ?? emptyShiftBreakdown;
    return {
      transactions: totals.transactions + breakdown.orderCount,
      cash: totals.cash + breakdown.cashSalesMillimes,
      cards: totals.cards + breakdown.cardSalesMillimes,
      sales: totals.sales + breakdown.cashSalesMillimes + breakdown.cardSalesMillimes + breakdown.otherSalesMillimes + breakdown.tabSalesMillimes,
    };
  }, { transactions: 0, cash: 0, cards: 0, sales: 0 });
  const metricAmount = (millimes: number) => `${formatTnd(millimes / 1000)} DT`;
  const overviewMetrics: {
    key: ShiftOverviewMetricKey;
    label: string;
    icon: string;
    tone: string;
    explanation: string;
  }[] = [
    {
      key: 'sales',
      label: 'Total Sales',
      icon: 'shopping_cart',
      tone: 'cyan',
      explanation: 'Completed order totals in the selected period. Cancelled and pending-void orders are excluded.',
    },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: 'receipt_long',
      tone: 'blue',
      explanation: 'Count of completed orders, not individual payment records.',
    },
    {
      key: 'cash',
      label: 'Cash',
      icon: 'payments',
      tone: 'green',
      explanation: 'Cash order payments plus net cash customer-tab settlements and reversals.',
    },
    {
      key: 'cards',
      label: 'Cards',
      icon: 'credit_card',
      tone: 'purple',
      explanation: 'Card order payments plus net card customer-tab settlements and reversals.',
    },
    {
      key: 'expenses',
      label: 'Expenses',
      icon: 'work',
      tone: 'orange',
      explanation: 'Recorded expenses dated within the selected period.',
    },
    {
      key: 'netSales',
      label: 'Net Sales',
      icon: 'trending_up',
      tone: 'cyan',
      explanation: 'Net collections: cash, card, and other payments after valid reversals, minus expenses. Unsettled tabs are excluded.',
    },
  ];
  const summaryMetrics = overviewMetrics.map((metric) => {
    const currentValue = overviewAnalytics?.current[metric.key];
    const previousValue = overviewAnalytics?.previous[metric.key];
    const change = currentValue === undefined || previousValue === undefined || !overviewAnalytics
      ? { direction: 'unavailable' as const }
      : getShiftOverviewChange(currentValue, previousValue, overviewAnalytics.comparisonAvailable);
    const series = overviewAnalytics ? getShiftOverviewSeries(overviewAnalytics, metric.key) : [];
    const changeLabel = change.direction === 'unavailable'
      ? 'Insufficient historical data'
      : change.direction === 'new'
        ? 'New'
        : `${change.percent && change.percent > 0 ? '+' : ''}${Math.round(change.percent ?? 0)}%`;
    const reportParams = new URLSearchParams({
      insightRange: 'custom',
      from: overviewRange?.from ?? todayOverviewDate,
      to: overviewRange?.to ?? todayOverviewDate,
    });
    const to = metric.key === 'transactions'
      ? overviewRange && overviewRange.from === overviewRange.to
        ? `/orders?businessDate=${overviewRange.from}`
        : `/owner/reports?${reportParams.toString()}`
      : metric.key === 'expenses'
        ? `/owner/expenses?month=${(overviewRange?.from ?? todayOverviewDate).slice(0, 7)}`
        : `/owner/reports?${reportParams.toString()}`;
    return {
      ...metric,
      value: currentValue === undefined
        ? overviewLoading ? 'Loading' : '—'
        : metric.key === 'transactions' ? String(currentValue) : metricAmount(currentValue),
      change,
      changeLabel,
      series,
      to,
      tooltip: `${metric.explanation} Compared with ${overviewRange?.previousFrom ?? 'previous period'} through ${overviewRange?.previousTo ?? 'previous period'}.`,
    };
  });
  const shiftOverviewMetrics = ownerMode ? summaryMetrics : [
    { label: 'Open shifts', value: String(openCount), icon: 'schedule', tone: 'primary' },
    { label: 'Transactions', value: String(liveShiftTotals.transactions), icon: 'receipt_long', tone: 'cyan' },
    { label: 'Cash sales', value: metricAmount(liveShiftTotals.cash), icon: 'payments', tone: 'green' },
    { label: 'Card sales', value: metricAmount(liveShiftTotals.cards), icon: 'credit_card', tone: 'blue' },
    { label: 'Pending voids', value: String(pendingVoidOrders.length), icon: 'pending_actions', tone: 'orange' },
  ];
  const cashMovementHistoryEntries = cashMovementHistoryShift
    ? movementsForShift(cashMovementHistoryShift.id)
    : [];

  return (
    <div className={`shift-workspace ${ownerMode ? 'shift-workspace--owner' : ''}`}>
      {ownerMode && (
        <div className="shift-topbar shift-topbar--search">
          <Link to="/owner/dashboard" className="shift-topbar-brand" aria-label="Go to 7anouti-POS dashboard">
            <span className="shift-topbar-logo" aria-hidden="true">
              <img src="/logo1.png" alt="" />
            </span>
            <span className="shift-topbar-brand-copy">
              <strong>7anouti-POS</strong>
              <span>Smart Business</span>
            </span>
          </Link>
          <WorkspaceSearch key={storeId} storeId={storeId} />
          <div className="shift-topbar-actions">
            <ShiftNotificationsButton />
          </div>
        </div>
      )}
      {!ownerMode && <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{pageTitle}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        {ownerMode && !ownOpenShift
          ? <Button className="shift-open-button" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />Open my shift</Button>
          : ownerMode
            ? <StatusTag status="started">{`${openCount} open`}</StatusTag>
            : canOpenCloseShift && !ownOpenShift && (!closedShiftSummary || dayStatus.dayIsClosed)
              ? <Button className="shift-open-button" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
              : null}
      </div>}
      {ownerMode ? (
        <header className="shift-apple-header items-center justify-between gap-4">
          <div className="shift-owner-header-info">
            <span className="shift-header-mark grid size-12 shrink-0 place-items-center rounded-2xl">
              <MaterialIcon name="payments" className="text-2xl" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-headline-md text-on-surface">Shift Management</h1>
              <p className="mt-0.5 truncate font-body text-body-sm text-on-surface-variant">Manage your shifts and view daily reports</p>
            </div>
            <span className="shift-location-chip">
              <MaterialIcon name="location_on" />
              <span>{store?.address || store?.name || 'Your store'}</span>
              <MaterialIcon name="expand_more" />
            </span>
          </div>
          <div className="shift-owner-header-actions">
            {ownOpenShift ? (
              <>
                <span className="shift-open-status" aria-label={`Shift open since ${new Date(ownOpenShift.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}>
                  <span className="shift-open-status__dot" aria-hidden="true" />
                  <span className="shift-open-status__copy">
                    <strong>Shift Open</strong>
                    <small>Since {new Date(ownOpenShift.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                  </span>
                </span>
                {canOpenCloseShift && (
                  <Button className="shift-open-button" onClick={openCountedCashSheet}>
                    <MaterialIcon name="crop_square" />Close Shift
                  </Button>
                )}
              </>
            ) : (
              <StatusTag status="closed">No shift open</StatusTag>
            )}
            {!ownOpenShift && (
              <Button className="shift-open-button" onClick={openStartingCashSheet}>
                <MaterialIcon name="lock_open" />Open Shift
              </Button>
            )}
          </div>
        </header>
      ) : (
        <PageHeader className="hidden lg:flex" title={pageTitle} subtitle={store?.name} actions={
          canOpenCloseShift && !ownOpenShift && (!closedShiftSummary || dayStatus.dayIsClosed)
            ? <Button className="shift-open-button w-full lg:w-auto lg:min-w-[160px]" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
            : undefined
        } />
      )}
      {(ownerMode || (dayStatus.dayIsClosed && !ownOpenShift)) && (
        <p role="status" className={`shift-day-status mb-4 rounded-xl p-3 font-body text-body-sm ${dayStatus.dayIsClosed ? 'shift-day-status--warning' : ''}`}>
          {dayStatusMessage}
        </p>
      )}
      {(error || notice) && (
        <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-xl p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>
          {error || notice}
        </p>
      )}
      {ownerMode && (
        <nav className="shift-section-tabs mb-4 grid grid-cols-3 gap-1 p-1" aria-label="Shift and report sections">
          <span
            className={`shift-section-indicator shift-section-indicator--${activeTab}`}
            aria-hidden="true"
          />
          {([
            ['shifts', 'Shift', 'schedule'],
            ['reports', 'Z Reports', 'analytics'],
            ['archive', 'Daily Reports', 'description'],
          ] as const).map(([tab, label, icon]) => (
            <Button
              key={tab}
              variant="ghost"
              className={`shift-section-tab-button${activeTab === tab ? ' is-active' : ''}`}
              aria-pressed={activeTab === tab}
              onClick={() => changeActiveTab(tab)}
            >
              <MaterialIcon name={icon} className="text-lg" />
              {label}
            </Button>
          ))}
        </nav>
      )}
      {(!ownerMode || activeTab !== 'archive') && (
        <FirstRunHint id={`shift-${user?.id ?? 'guest'}`} title={t('hint.title')} message={t('hint.shift')} />
      )}

      {ownerMode && (
        <div className="shift-overview-toolbar" aria-label="KPI reporting filters">
          <div className="shift-overview-periods" role="group" aria-label="KPI date range">
            {([
              ['today', 'Today'],
              ['yesterday', 'Yesterday'],
              ['last7', 'Last 7 days'],
              ['last30', 'Last 30 days'],
              ['month', 'This month'],
              ['custom', 'Custom'],
            ] as [ShiftOverviewFilter, string][]).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                aria-pressed={overviewFilter === filter}
                onClick={() => setOverviewFilter(filter)}
                className={`shift-overview-period${overviewFilter === filter ? ' is-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          {overviewFilter === 'custom' && (
            <div className="shift-overview-custom-range">
              <label>
                From
                <input
                  type="date"
                  value={customOverviewFrom}
                  max={customOverviewTo}
                  onChange={(event) => setCustomOverviewFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={customOverviewTo}
                  min={customOverviewFrom}
                  onChange={(event) => setCustomOverviewTo(event.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
      {ownerMode && overviewError && (
        <div className="shift-overview-error" role="alert">
          <span>{overviewError}</span>
          <button type="button" onClick={() => setOverviewRetry((retry) => retry + 1)}>Retry</button>
        </div>
      )}
      <section className="shift-overview-grid mb-4" aria-label="Shift overview" aria-busy={ownerMode && overviewLoading}>
        {shiftOverviewMetrics.map((card) => {
          if (!('key' in card)) {
            return (
              <article key={card.label} className={`shift-overview-card shift-overview-card--${card.tone}`}>
                <span className="shift-overview-icon grid size-11 shrink-0 place-items-center rounded-full">
                  <MaterialIcon name={card.icon} className="text-xl" />
                </span>
                <div className="shift-overview-copy min-w-0">
                  <p className="font-body text-label-sm text-on-surface-variant">{card.label}</p>
                  <strong className="mt-1 block truncate font-display text-title-md tabular-nums text-on-surface">{card.value}</strong>
                </div>
              </article>
            );
          }
          const changeArrow = card.change.direction === 'down'
            ? '↓'
            : card.change.direction === 'neutral'
              ? '→'
              : card.change.direction === 'unavailable'
                ? '–'
                : '↑';
          const changeTone = card.change.direction === 'up' || card.change.direction === 'new'
            ? 'is-positive'
            : card.change.direction === 'down'
              ? 'is-negative'
              : card.change.direction === 'neutral'
                ? 'is-neutral'
                : 'is-unavailable';
          return (
            <button
              key={card.key}
              type="button"
              title={card.tooltip}
              aria-label={`${card.label}: ${card.value}. ${card.changeLabel}. ${card.explanation} Open details.`}
              className={`shift-overview-card shift-overview-card--${card.tone} shift-overview-card--interactive`}
              onClick={() => navigate(card.to)}
            >
              <span className="shift-overview-icon grid size-11 shrink-0 place-items-center rounded-full" aria-hidden="true">
                <MaterialIcon name={card.icon} className="text-xl" />
              </span>
              <div className="shift-overview-copy min-w-0">
                <p className="font-body text-label-sm text-on-surface-variant">{card.label}</p>
                <strong className="mt-1 block truncate font-display text-title-md tabular-nums text-on-surface">
                  {overviewLoading && ownerMode
                    ? <span className="shift-overview-skeleton" aria-label="Loading KPI value" />
                    : card.value}
                </strong>
                <div className="shift-overview-trend">
                  <span className={`shift-overview-trend-value ${changeTone}`}>
                    {overviewLoading && ownerMode ? (
                    <span className="shift-overview-skeleton" aria-label="Loading KPI comparison" />
                    ) : card.change.direction === 'unavailable' ? (
                      '----'
                    ) : (
                      <>
                        <span className="shift-overview-trend-arrow" aria-hidden="true">{changeArrow}</span>
                        {card.changeLabel}
                      </>
                    )}
                  </span>
                  <svg
                    className={`shift-overview-sparkline ${card.series.length < 2 ? 'is-empty' : ''}`}
                    viewBox="0 0 64 20"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id={`shift-overview-gradient-${card.key}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <path
                      className="shift-overview-sparkline-area"
                      style={{ fill: `url(#shift-overview-gradient-${card.key})` }}
                      d={getSparklineAreaPath(card.series)}
                    />
                    <path d={smoothSparklinePath(getSparklinePath(card.series)) || 'M0,10 L64,10'} />
                  </svg>
                </div>
              </div>
            </button>
          );
        })}
      </section>
      {ownerMode && overviewAnalytics && !overviewLoading && !overviewError && (
        <p className="shift-overview-reconciliation">
          Collected payments: Cash {metricAmount(overviewAnalytics.current.cash)} + Cards {metricAmount(overviewAnalytics.current.cards)} + Other {metricAmount(overviewAnalytics.current.other)} = {metricAmount(
            overviewAnalytics.current.cash + overviewAnalytics.current.cards + overviewAnalytics.current.other,
          )}
        </p>
      )}

      {ownerMode && activeTab === 'reports' && (
        <section className="shift-tab-panel shift-reports-grid grid gap-4 tablet:grid-cols-2">
          <article className="shift-report-card shift-x-card rounded-2xl p-4">
            <div className="shift-report-card__header flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shift-report-icon grid size-12 shrink-0 place-items-center rounded-2xl">
                  <MaterialIcon name="summarize" className="text-2xl" />
                </span>
                <div className="min-w-0">
                  <p className="font-body text-label-sm text-primary">Live preview</p>
                  <h2 className="font-display text-headline-md text-on-surface">X report</h2>
                </div>
              </div>
              <StatusTag className="shift-report-status" status={reportDisabledReason ? 'closed' : 'started'}>{reportDisabledReason ? 'Unavailable' : 'Live'}</StatusTag>
            </div>
            <p className="mt-3 font-body text-body-sm text-on-surface-variant">A frozen cash snapshot for review. The business day remains open.</p>
            <div className="shift-report-meta mt-4 grid grid-cols-2 gap-2">
              <div><p>Open shifts</p><strong>{openCount}</strong></div>
              <div><p>Pending voids</p><strong>{pendingVoidOrders.length}</strong></div>
            </div>
            {reportDisabledReason && <p className="mt-2 font-body text-body-sm text-outline">{reportDisabledReason}</p>}
            <Button disabled={Boolean(reportDisabledReason)} className="shift-report-action mt-4 w-full" onClick={() => { void createXReport(); }}>
              <MaterialIcon name="summarize" />Print X report
            </Button>
          </article>
          <article className="shift-report-card shift-z-card rounded-2xl p-4">
            <div className="shift-report-card__header flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shift-report-icon shift-report-icon--danger grid size-12 shrink-0 place-items-center rounded-2xl">
                  <MaterialIcon name="lock" className="text-2xl" />
                </span>
                <div className="min-w-0">
                  <p className="font-body text-label-sm text-warning-dark">Final close</p>
                  <h2 className="font-display text-headline-md text-on-surface">Z report</h2>
                </div>
              </div>
              <StatusTag className="shift-report-status" status={zDisabledReason ? 'closed' : 'started'}>{zDisabledReason ? 'Blocked' : 'Ready'}</StatusTag>
            </div>
            <p className="mt-3 font-body text-body-sm text-on-surface-variant">Requires your owner PIN. All shifts and voids must be resolved first.</p>
            {(openShifts.length > 0 || pendingVoidOrders.length > 0) && (
              <div className="shift-resolution-panel mt-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-label-lg text-on-surface">Before closing</h3>
                  <span className="shift-resolution-count">{openShifts.length + pendingVoidOrders.length}</span>
                </div>
                <div className="mt-2 flex max-h-24 flex-col gap-1.5 overflow-y-auto">
                  {openShifts.map((shift) => (
                    <p key={shift.id} className="shift-resolution-row font-body text-body-sm">
                      <MaterialIcon name="schedule" className="text-base" />
                      <span>Open shift · {staffNames[shift.staffId] ?? 'Staff'}</span>
                    </p>
                  ))}
                  {pendingVoidOrders.map((order) => (
                    <p key={order.id} className="shift-resolution-row font-body text-body-sm">
                      <MaterialIcon name="pending_actions" className="text-base" />
                      <span>Void #{order.number} · {formatTnd(order.totalMillimes / 1000)} DT</span>
                    </p>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link to="/owner/voids" className="shift-resolution-link flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 font-body text-label-md">
                    <MaterialIcon name="rule" className="text-lg" />
                    Review voids
                  </Link>
                  <Button variant="danger" className="shift-force-button min-h-11" onClick={() => { void openZCloseDialog(true); }}>
                    Force close everything
                  </Button>
                </div>
              </div>
            )}
            <Button disabled={Boolean(zDisabledReason)} variant="danger" className="shift-report-action shift-z-action mt-4 w-full" onClick={() => { void openZCloseDialog(); }}>
              <MaterialIcon name="lock" />Close day: Z report
            </Button>
          </article>
          {reportPreview && <div className="tablet:col-span-2"><ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} /></div>}
        </section>
      )}

      {ownerMode && activeTab === 'archive' && (
        <section className="shift-tab-panel shift-archive-page">
          <div className="shift-archive-toolbar-panel shift-archive-toolbar-panel--date-only">
            <div className="shift-archive-date-filter">
              <label htmlFor="shift-archive-date">
                <MaterialIcon name="calendar_month" />
                <span>Closed date</span>
              </label>
              <input
                id="shift-archive-date"
                type="date"
                value={archiveDate}
                aria-label="Filter Z reports by close date"
                onChange={(event) => {
                  const nextDate = event.currentTarget.value;
                  if (!nextDate) return;
                  setArchiveDateOverride(nextDate);
                  setReportPreview(undefined);
                  setArchivePreviewDismissed(false);
                }}
              />
              <span className="shift-archive-date-count">
                {filteredArchiveReports.length} Z {filteredArchiveReports.length === 1 ? 'report' : 'reports'}
              </span>
            </div>
          </div>
          <div className="shift-archive-layout">
            <div className="shift-archive-card rounded-2xl p-4">
              <div className="shift-archive-card-heading">
                <h2 className="font-display text-headline-md text-on-surface">
                  <MaterialIcon name="description" />
                  Reports History
                </h2>
                <label className="shift-sort-control">
                  <span>Sort by:</span>
                  <select
                    value={archiveSort}
                    onChange={(event) => setArchiveSort(event.target.value as typeof archiveSort)}
                    aria-label="Sort reports"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="amount-desc">Amount: high to low</option>
                    <option value="amount-asc">Amount: low to high</option>
                  </select>
                </label>
              </div>
            {loading ? <ListSkeleton label="Loading daily reports" /> : (
              <div className="shift-archive-list flex flex-col gap-2">
                {filteredArchiveReports.map((report) => {
                  const selected = isArchivePreview?.id === report.id;
                  const closedDate = getReportCloseDate(report, reportTimeZone);
                  const reportDateLabel = closedDate === todayOverviewDate
                    ? 'Today'
                    : closedDate;
                  const reportTime = new Date(report.createdAt).toLocaleTimeString([], {
                    timeZone: reportTimeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  return (
                    <button
                      key={report.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => { setReportPreview(report); setArchivePreviewDismissed(false); }}
                      className={`shift-archive-row flex items-start justify-between gap-3 rounded-xl p-3 text-left ${selected ? 'shift-archive-row--selected' : ''}`}
                    >
                      <span className="shift-archive-row-icon">
                        <MaterialIcon name="description" />
                      </span>
                      <span className="shift-archive-row-copy">
                        <strong className="text-on-surface">{report.reportNumber ?? `Z-${String(report.zNumber ?? 0).padStart(6, '0')}`}</strong>
                        <span className="font-body text-body-sm text-on-surface-variant">
                          {reportDateLabel} · {reportTime} · Business date {report.businessDate}
                        </span>
                      </span>
                      <span className="shift-archive-row-summary">
                        <strong>{formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT</strong>
                        <StatusTag className="shift-archive-status" status={report.pinVerified === false ? 'pending' : 'started'}>
                          {report.pinVerified === false ? 'PIN unavailable' : 'Verified'}
                        </StatusTag>
                      </span>
                      <MaterialIcon name="chevron_right" className="shift-archive-row-chevron" />
                    </button>
                  );
                })}
                {filteredArchiveReports.length === 0 && (
                  <div className="shift-archive-empty">
                    <MaterialIcon name="event_busy" className="text-2xl text-outline" />
                    <p className="font-body text-body-sm text-on-surface-variant">No Z reports found closed on this date.</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {isArchivePreview ? (
            <div className="shift-archive-preview">
              <ReportView inline report={isArchivePreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} previewZoom={previewZoom} onClose={() => { setReportPreview(undefined); setArchivePreviewDismissed(true); }} />
              <div className="shift-preview-zoom" role="group" aria-label="Report preview zoom">
                <button type="button" aria-label="Zoom out" disabled={previewZoom <= 70} onClick={() => setPreviewZoom((zoom) => Math.max(70, zoom - 10))}>−</button>
                <span>{previewZoom}%</span>
                <button type="button" aria-label="Zoom in" disabled={previewZoom >= 150} onClick={() => setPreviewZoom((zoom) => Math.min(150, zoom + 10))}>+</button>
              </div>
            </div>
          ) : (
            <div className="shift-archive-preview shift-archive-preview--empty">
              <MaterialIcon name="description" className="text-3xl text-outline" />
              <p className="font-body text-body-sm text-on-surface-variant">Select a Z report to preview it.</p>
            </div>
          )}
          </div>
        </section>
      )}

      {closedShiftSummary && (!ownerMode || activeTab === 'shifts') && (
        <ClosedShiftSummary
          shift={closedShiftSummary.shift}
          breakdown={closedShiftSummary.breakdown}
          onDone={() => setClosedShiftSummary(undefined)}
          blind={resolveStoreSettings(store?.settings).blindShiftClosing && !ownerMode}
        />
      )}

      {(!ownerMode || activeTab === 'shifts') && (
        <div className="shift-tab-panel shift-management-layout">
          {ownOpenShift ? (
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
      ) : null}

      {reportPreview && !ownerMode && <div className="mt-4">
        <ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} />
      </div>}

      {(!ownerMode || activeTab === 'shifts') && <section id="shift-history" className="shift-history mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{ownerMode && <span className="shift-history-mark"><MaterialIcon name="history" /></span>}{t('shift.history')}</h2>
        <div className="shift-history-toolbar mb-3 grid gap-2">
          {!ownerMode && (
            <label className="relative">
              <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline" />
              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search staff or date"
                aria-label="Search shift history"
                className="h-11 w-full rounded-lg bg-surface-container-lowest pl-10 pr-3 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}
          <div className="shift-status-filters flex items-center gap-1 rounded-xl bg-surface-container-lowest p-1 shadow-card" role="group" aria-label="Filter shift status">
            {([
              ['all', 'All'],
              ['open', 'Open'],
              ['closed', 'Closed'],
            ] as const).map(([status, label]) => (
              <button
                key={status}
                type="button"
                aria-pressed={historyStatus === status}
                onClick={() => setHistoryStatus(status)}
                className={`min-h-9 shrink-0 rounded-lg px-3 font-body text-label-md transition ${
                  historyStatus === status
                    ? 'bg-primary text-on-primary shadow-card'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="shift-staff-filter">
            <span className="sr-only">Filter by staff</span>
            <select
              value={historyStaff}
              onChange={(event) => setHistoryStaff(event.target.value)}
              aria-label="Filter by staff"
              className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All staff</option>
              {Object.entries(staffNames).map(([staffId, staffName]) => (
                <option key={staffId} value={staffId}>{staffName}</option>
              ))}
            </select>
          </label>
          {ownerMode && (
            <label className="shift-date-filter">
              <span className="sr-only">Filter by date</span>
              <input
                type="date"
                value={historyDate}
                onChange={(event) => setHistoryDate(event.target.value)}
                aria-label="Filter by date"
                className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}
        </div>
        {loading ? <ListSkeleton label="Loading shifts" /> : <DataTable<ShiftRecord>
          rows={filteredHistory}
          getRowKey={(shift) => shift.id}
          columns={[
            { key: 'staff', label: 'Staff', sortValue: (shift) => staffNames[shift.staffId] ?? 'Staff', render: (shift) => staffNames[shift.staffId] ?? 'Staff' },
            { key: 'opened', label: 'Opened', sortValue: (shift) => shift.openedAt, render: (shift) => new Date(shift.openedAt).toLocaleString() },
            { key: 'closed', label: 'Closed', sortValue: (shift) => shift.closedAt ?? '', render: (shift) => shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—' },
            { key: 'duration', label: 'Duration', sortValue: (shift) => new Date(shift.closedAt ?? Date.now()).getTime() - new Date(shift.openedAt).getTime(), render: (shift) => {
              const durationMinutes = Math.max(0, Math.floor((new Date(shift.closedAt ?? Date.now()).getTime() - new Date(shift.openedAt).getTime()) / 60_000));
              return durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` : `${durationMinutes}m`;
            } },
            { key: 'starting', label: 'Starting', sortValue: (shift) => shift.startingCashMillimes, render: (shift) => `${formatTnd(shift.startingCashMillimes / 1000)} DT` },
            { key: 'counted', label: 'Counted', sortValue: (shift) => shift.countedCashMillimes ?? 0, render: (shift) => shift.countedCashMillimes === undefined ? '—' : `${formatTnd(shift.countedCashMillimes / 1000)} DT` },
            { key: 'status', label: 'Status', render: (shift) => (
              <div className="flex flex-col items-start gap-1">
                <StatusTag className="shift-history-status" status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Open' : 'Closed'}</StatusTag>
                {shift.forceClosedByOwner && <span className="font-body text-label-sm text-warning">Closed by force</span>}
                {(shift.voidsAutoApprovedCount ?? 0) > 0 && <span className="font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</span>}
              </div>
            ) },
            { key: 'difference', label: 'Difference', sortValue: (shift) => shift.differenceMillimes ?? 0, render: (shift) => shift.differenceMillimes === undefined ? '—' : `${formatTnd(shift.differenceMillimes / 1000)} DT` },
            { key: 'actions', label: 'Actions', render: (shift) => (
              <button
                type="button"
                className="shift-movements-toggle"
                onClick={() => openCashMovementHistory(shift)}
              >
                <MaterialIcon name="payments" />
                Cash movements
              </button>
            ) },
          ] satisfies DataTableColumn<ShiftRecord>[]}
          mobileCards={(shift) => (
            <article key={shift.id} className={`shift-history-card shift-history-card--${shift.status === 'open' ? 'open' : 'closed'} flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4`}>
              <div className="shift-history-card__identity">
                <span className="shift-history-card__staff-icon" aria-hidden="true">
                  <MaterialIcon name={shift.status === 'open' ? 'schedule' : 'person'} />
                </span>
                <div className="shift-history-card__identity-copy">
                  <p className="font-body text-label-lg text-on-surface">{staffNames[shift.staffId] ?? 'Staff'}</p>
                  <p className="mt-1 font-body text-body-sm text-outline">
                    {new Date(shift.openedAt).toLocaleString()} {shift.closedAt ? ` • Closed ${new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                  {shift.forceClosedByOwner && <p className="mt-1 font-body text-label-sm text-warning">Closed by force</p>}
                  {(shift.voidsAutoApprovedCount ?? 0) > 0 && <p className="mt-1 font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</p>}
                </div>
              </div>
              <div className="shift-history-card__cash-summary">
                <div>
                  <span>Starting cash</span>
                  <strong>{formatTnd(shift.startingCashMillimes / 1000)} DT</strong>
                </div>
                {shift.countedCashMillimes !== undefined && (
                  <div>
                    <span>Counted cash</span>
                    <strong>{formatTnd(shift.countedCashMillimes / 1000)} DT</strong>
                  </div>
                )}
              </div>
              <div className="shift-history-card__status">
                <StatusTag className="shift-history-status" status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
                {shift.differenceMillimes !== undefined && <p className={`mt-1 font-body text-label-sm tabular-nums ${shift.differenceMillimes === 0 ? 'text-success-dark' : 'text-error-dark'}`}>{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
              </div>
              {ownerMode && canCashInOut && shift.status === 'open' && user?.role === 'owner' && (
                <div className="shift-history-card__cash-actions flex w-full gap-2">
                  <Button type="button" variant="secondary" className="shift-cash-in flex-1" onClick={() => openCashMovement('in', shift.id)}><MaterialIcon name="add" />Cash in</Button>
                  <Button type="button" variant="secondary" className="shift-cash-out flex-1" onClick={() => openCashMovement('out', shift.id)}><MaterialIcon name="remove" />Cash out</Button>
                </div>
              )}
              <CashMovementList
                movements={movementsForShift(shift.id)}
                staffNames={staffNames}
                onShowMore={() => openCashMovementHistory(shift)}
              />
              {ownerMode && shift.status === 'open' && user?.role === 'owner' && (
                <Button variant="danger" className="shift-history-force-close-button w-full" onClick={() => {
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
        </div>
      )}
      <BottomSheet open={openShiftSheetOpen} onClose={closeStartingCashSheet} title={t('shift.openShift')}>
        <form onSubmit={(event) => { void openShift(event); }} className="flex flex-col gap-3">
          <p className="font-body text-body-sm text-on-surface-variant">Count the cash drawer before taking orders.</p>
          <label htmlFor="starting-cash" className="block font-body text-label-md">{t('shift.startingCash')} (TND)</label>
          <DinarInput id="starting-cash" required value={startingCash} onChange={(event) => { setStartingCash(event.target.value); setStartingCashEdited(true); }} className="h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={closeStartingCashSheet}>{t('common.cancel')}</Button>
            <Button type="submit"><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
          </div>
        </form>
      </BottomSheet>
      <BottomSheet
        open={zSheetOpen}
        onClose={() => { setZSheetOpen(false); setOwnerPin(''); setZCountedCash(''); setZNote(''); setZStep(1); }}
        title="Close day: Z report"
        icon="receipt_long"
        panelClassName="z-force-close-panel"
      >
        {zStep === 0 ? (
          <form onSubmit={(event) => { event.preventDefault(); void forceCloseEverything(); }} className="z-force-close-form flex flex-col gap-3">
            <p className="z-force-close-description font-body text-body-sm text-on-surface-variant">
              <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
              All pending voids will be approved and all open shifts closed with zero difference
            </p>
            <div className="z-force-close-affected">
              {openShifts.map((shift) => (
                <p key={shift.id} className="z-force-close-affected__item font-body text-body-sm">
                  Open shift · {staffNames[shift.staffId] ?? 'Staff'} · {new Date(shift.openedAt).toLocaleString()}
                </p>
              ))}
              {pendingVoidOrders.map((order) => (
                <p key={order.id} className="z-force-close-affected__item font-body text-body-sm">
                  Void #{order.number} · {staffNames[order.staffId] ?? order.staffName ?? 'Staff'} ·
                  {' '}{formatTnd(order.totalMillimes / 1000)} DT · {order.voidReason || 'Reason not recorded'}
                </p>
              ))}
              <Link to="/owner/voids" className="z-force-close-review inline-flex min-h-10 items-center font-body text-label-md text-primary underline">
                Review voids <MaterialIcon name="chevron_right" />
              </Link>
            </div>
            <label className="z-force-close-confirm flex items-start gap-2 font-body text-body-sm text-on-surface">
              <input
                className="z-force-close-checkbox"
                type="checkbox"
                checked={forceEverythingConfirmed}
                onChange={(event) => setForceEverythingConfirmed(event.target.checked)}
              />
              Confirm: all pending voids will be approved and all open shifts closed with zero difference.
            </label>
            <label className="z-force-close-pin font-body text-label-md">
              <span className="z-force-close-pin__label"><MaterialIcon name="lock" />Owner PIN</span>
              <input readOnly type="password" value={ownerPin} placeholder="••••" className="z-force-close-pin__input mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad className="z-force-close-keypad" onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            {error && <p role="alert" className="z-force-close-error rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            {zUnresolvedReversals.length > 0 && (
              <section role="alert" className="z-force-close-warning rounded-xl bg-warning-container p-3 text-on-warning-container">
                <h3 className="font-display text-title-sm">Unresolved tab reversals — excluded from verified totals</h3>
                {zUnresolvedReversals.map((reversal) => (
                  <p key={reversal.reversalId} className="mt-1 font-body text-body-sm">
                    {reversal.paymentMethod.toUpperCase()} · {formatTnd(reversal.amountMillimes / 1000)} DT · Reversal {reversal.reversalId} · Settlement {reversal.originalSettlementId}
                  </p>
                ))}
              </section>
            )}
            <div className="sheet-action-bar z-force-close-actions">
              <Button type="button" variant="ghost" className="z-force-close-cancel" onClick={() => setZSheetOpen(false)}>Cancel</Button>
              <Button type="submit" variant="danger" className="z-force-close-submit" disabled={zBusy || ownerPin.length !== 4 || !forceEverythingConfirmed}>
                Force close everything
              </Button>
            </div>
          </form>
        ) : zStep === 1 ? (
          <form onSubmit={(event) => { event.preventDefault(); void verifyZOwnerPin(); }} className="z-force-close-form flex flex-col gap-3">
            <p className="z-force-close-description font-body text-body-sm text-on-surface-variant">
              <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
              Verify the owner PIN to continue with the Z close.
            </p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <label className="z-force-close-pin font-body text-label-md">
              <span className="z-force-close-pin__label"><MaterialIcon name="lock" />Owner PIN</span>
              <input readOnly type="password" value={ownerPin} placeholder="••••" className="z-force-close-pin__input mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em]" />
            </label>
            <Keypad className="z-force-close-keypad" onPress={(digit) => setOwnerPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setOwnerPin('')} onBackspace={() => setOwnerPin((current) => current.slice(0, -1))} />
            <div className="sheet-action-bar z-force-close-actions">
              <Button type="button" variant="ghost" className="z-force-close-cancel" onClick={() => { setZSheetOpen(false); setOwnerPin(''); setZStep(1); }}>Cancel</Button>
              <Button type="submit" disabled={zBusy || ownerPin.length !== 4}><MaterialIcon name="lock" />Continue</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void closeDayWithZ(); }} className="z-report-close-form flex flex-col gap-3">
          <p className="z-report-close-description">
            <span className="z-force-close-description__icon" aria-hidden="true"><MaterialIcon name="info" /></span>
            Review the recorded activity, then count the whole-day cash and card totals. Exclude shift opening floats from the cash count; each shift's float is shown separately for reference.
          </p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
          <div className="z-report-summary">
            <section className="z-report-summary__section">
              <h3 className="z-report-summary__heading">Period sales and voids</h3>
              <Metric className="z-report-metric" label="Cash / card / other / tab sales" amount={zPaymentSplit.cash + zPaymentSplit.card + zPaymentSplit.other + zPaymentSplit.tab} />
              <p className="z-report-summary__detail">
                  Cash {formatTnd(zPaymentSplit.cash / 1000)} · Card {formatTnd(zPaymentSplit.card / 1000)} · Other {formatTnd(zPaymentSplit.other / 1000)} · Tab {formatTnd(zPaymentSplit.tab / 1000)}
                </p>
              <p className="z-report-summary__detail">
                  Non-cash tab payments · Card {formatTnd(zCardTabPayments / 1000)} · Other {formatTnd(zOtherTabPayments / 1000)}
                </p>
              <Metric className="z-report-metric" label={`Voided orders (${zVoids.count})`} amount={zVoids.totalMillimes} />
              <Metric className="z-report-metric" label={`Pending void requests (${zPendingVoids.count})`} amount={zPendingVoids.totalMillimes} />
              </section>
            <section className="z-report-summary__section">
              <h3 className="z-report-summary__heading">Day totals</h3>
              <Metric className="z-report-metric" label="Opening floats (excluded from cash count)" amount={zShiftLines.reduce((total, shift) => total + shift.startingCashMillimes, 0)} />
              <Metric className="z-report-metric" label="Cash sales" amount={zPaymentSplit.cash} />
              <Metric className="z-report-metric" label="Cash tab payments" amount={zShiftLines.reduce((total, shift) => total + (shift.tabPaymentsMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label="Cash in" amount={zShiftLines.reduce((total, shift) => total + (shift.cashInMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label="Cash out" amount={zShiftLines.reduce((total, shift) => total + (shift.cashOutMillimes ?? 0), 0)} />
              <Metric className="z-report-metric" label="Card total (sales + tab payments)" amount={zExpectedCard} />
              {store?.allowOtherPayments && <Metric className="z-report-metric" label="Other total (sales + tab payments)" amount={zExpectedOther} />}
              </section>
              {zShiftLines.map((shift) => (
              <section key={shift.shiftId} className="z-report-summary__section">
                <h3 className="z-report-summary__heading">{shift.staffName}</h3>
                <p className="z-report-summary__date">
                    Opened {new Date(shift.openedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} ·
                    {' '}Closed {shift.closedAt ? new Date(shift.closedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </p>
                <Metric className="z-report-metric" label="Float" amount={shift.startingCashMillimes} />
                <Metric className="z-report-metric" label="Cash sales" amount={shift.cashSalesMillimes ?? 0} />
                <Metric className="z-report-metric" label="Card sales" amount={shift.cardSalesMillimes ?? 0} />
                {store?.allowOtherPayments && <Metric className="z-report-metric" label="Other sales" amount={shift.otherSalesMillimes ?? 0} />}
                <Metric className="z-report-metric" label="Tab sales (not cash)" amount={shift.tabSalesMillimes ?? 0} />
                <Metric className="z-report-metric" label="Tab payments in cash" amount={shift.tabPaymentsMillimes ?? 0} />
                <Metric className="z-report-metric" label="Cash in" amount={shift.cashInMillimes ?? 0} />
                <Metric className="z-report-metric" label="Cash out" amount={shift.cashOutMillimes ?? 0} />
                <Metric className="z-report-metric" label="Post-close void adjustments" amount={shift.voidAdjustmentMillimes ?? 0} />
                {shift.forceClosedByOwner && <p className="z-report-summary__warning">Closed by force</p>}
                {shift.forceClosedByOwner && <p className="z-report-summary__warning">Unverified count · auto-approved voids: {shift.voidsAutoApprovedCount ?? 0}</p>}
                </section>
              ))}
            </div>
          <ZReportCountField id="z-counted-cash" label="Total cash for the day, excluding opening floats (TND)" value={zCountedCash} onChange={setZCountedCash} icon={Banknote} />
          <ZReportCountField id="z-counted-card" label="Total card payments in period (TND)" value={zCountedCard} onChange={setZCountedCard} icon={CreditCard} />
          {store?.allowOtherPayments && <ZReportCountField id="z-counted-other" label="Total other payments in period (TND)" value={zCountedOther} onChange={setZCountedOther} icon={Ellipsis} />}
            {zReviewed && zDifference !== undefined && (
            <div className="z-report-review" aria-live="polite">
              <h3 className="z-report-summary__heading">Count review</h3>
              <Metric className="z-report-metric" label="Counted day cash (excluding floats)" amount={parsedZCountedCash ?? 0} />
              <Metric className="z-report-metric" label="Expected day cash (excluding floats)" amount={zExpectedCash} prominent />
              <p className={`z-report-review__status ${
                zDifference < 0 ? 'z-report-review__status--short' : zDifference > 0 ? 'z-report-review__status--over' : 'z-report-review__status--balanced'
              }`}>
                  {zDifference < 0
                    ? `SHORT ${formatTnd(Math.abs(zDifference) / 1000)} DT`
                    : zDifference > 0
                      ? `OVER ${formatTnd(zDifference / 1000)} DT`
                      : 'BALANCED'}
                </p>
              <Metric className="z-report-metric" label="Counted card" amount={parsedZCardMillimes ?? 0} />
              <Metric className="z-report-metric" label="Expected card (sales + tab payments)" amount={zExpectedCard} />
              <p className={`z-report-review__status z-report-review__status--${
                zCardDifference === 0 ? 'balanced' : zCardDifference !== undefined && zCardDifference < 0 ? 'short' : 'over'
              }`}>
                  Card {zCardDifference === 0 ? 'BALANCED' : zCardDifference !== undefined && zCardDifference < 0 ? `SHORT ${formatTnd(Math.abs(zCardDifference) / 1000)} DT` : zCardDifference !== undefined ? `OVER ${formatTnd(zCardDifference / 1000)} DT` : ''}
                </p>
                {store?.allowOtherPayments && <>
                <Metric className="z-report-metric" label="Counted other" amount={parsedZOtherMillimes ?? 0} />
                <Metric className="z-report-metric" label="Expected other (sales + tab payments)" amount={zExpectedOther} />
                <p className={`z-report-review__status z-report-review__status--${
                  zOtherDifference === 0 ? 'balanced' : zOtherDifference !== undefined && zOtherDifference < 0 ? 'short' : 'over'
                }`}>
                    Other {zOtherDifference === 0 ? 'BALANCED' : zOtherDifference !== undefined && zOtherDifference < 0 ? `SHORT ${formatTnd(Math.abs(zOtherDifference) / 1000)} DT` : zOtherDifference !== undefined ? `OVER ${formatTnd(zOtherDifference / 1000)} DT` : ''}
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
                  Note{zReviewed && hasZDifference ? ' (required)' : ' (optional)'}
                </label>
                <div className="close-shift-count__input-wrap close-shift-note-wrap">
                  <textarea
                    id="z-report-note"
                    required={zReviewed && hasZDifference}
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
              <Button type="button" variant="ghost" className="z-report-back" onClick={() => { setError(''); setZStep(1); }}>Back</Button>
              <Button
                type="submit"
                variant={zReviewed ? 'danger' : 'primary'}
                className={`z-report-submit${zReviewed ? ' z-report-submit--final' : ''}`}
                disabled={zBusy || !hasZCountInputs || (zReviewed && hasZDifference && !zNote.trim())}
              >
                <MaterialIcon name="lock" />{zReviewed ? 'Confirm Z close' : 'Review counts'}
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>
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
    </div>
  );
}

function Metric({ label, amount, prominent = false, signed = false, icon, className }: { label: string; amount: number; prominent?: boolean; signed?: boolean; icon?: string; className?: string }) {
  const formatted = formatTnd(Math.abs(amount) / 1000);
  const prefix = signed && amount > 0 ? '+' : signed && amount < 0 ? '−' : '';
  return (
    <div className={icon ? `shift-current-metric${prominent ? ' shift-current-metric--prominent' : ''}` : `flex items-baseline justify-between gap-2${className ? ` ${className}` : ''}`}>
      {icon && <span className="shift-current-metric__icon"><MaterialIcon name={icon} /></span>}
      <span className={`font-body text-body-sm text-on-surface-variant${icon ? ' shift-current-metric__label' : ''}`}>{label}</span>
      <span className={`font-display tabular-nums ${prominent ? 'text-headline-md text-primary' : 'text-title-md text-on-surface'} ${signed && amount !== 0 ? 'text-error-dark' : ''}`}>{prefix}{formatted} DT</span>
    </div>
  );
}

function ZReportCountField({ id, label, value, onChange, icon: Icon }: { id: string; label: string; value: string; onChange: (value: string) => void; icon: LucideIcon }) {
  return (
    <section className="close-shift-count z-report-count">
      <span className="close-shift-count__icon" aria-hidden="true">
        <Icon size={28} strokeWidth={2.1} />
      </span>
      <div className="close-shift-count__content">
        <label htmlFor={id} className="close-shift-count__label">{label}</label>
        <div className="close-shift-count__input-wrap">
          <DinarInput
            id={id}
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. 140.000"
            className="close-shift-count__input"
          />
          <span className="close-shift-count__unit">DT</span>
        </div>
      </div>
    </section>
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

function ClosedShiftSummary({
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

function CashMovementList({ movements, staffNames, className = '', presentation = 'default', onShowMore }: {
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
