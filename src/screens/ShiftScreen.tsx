import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BottomNav } from '../components/BottomNav';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { getShiftOverviewDateRange, type ShiftOverviewAnalytics, type ShiftOverviewFilter } from '../lib/shiftOverview';
import { orderService } from '../services/orderService';
import { CashMovementNotificationError, shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { resolveStoreSettings, type CashMovementReason, type ShiftRecord } from '../types/domain';
import { t } from '../i18n/translations';
import { ownerWorkspaceLinks } from '../app/navigation';
import { PageContainer } from '../components/layout';
import { updateService } from '../services/updateService';
import { reportService } from '../services/reportService';
import { ReportView } from '../components/ReportView';
import type { ReportRecord, ReportShiftLine, UnresolvedTabReversalRecord } from '../types/domain';
import { useLocation } from 'react-router-dom';
import { parseNonNegativeMillimes } from '../lib/millimes';
import { getReportCloseDate } from '../lib/reportArchive';
import { dateKeyInTimezone } from '../lib/date';
import { ClosedShiftSummary } from '../features/shifts/components/ShiftCloseComponents';
import { ShiftOverview } from '../features/shifts/components/ShiftOverview';
import { ShiftHistory } from '../features/shifts/components/ShiftHistory';
import { ShiftArchive, ShiftReports } from '../features/shifts/components/ShiftReportPanels';
import { ShiftDialogs } from '../features/shifts/components/ShiftDialogs';
import { ShiftHeader } from '../features/shifts/components/ShiftHeader';
import { ShiftCurrent } from '../features/shifts/components/ShiftCurrent';
import { useShiftData } from '../features/shifts/hooks/useShiftData';

import { emptyShiftBreakdown, localDateKey, parseMillimes, validDateKey, type ShiftCloseBreakdown } from '../features/shifts/utils/shiftCalculations';



















function ShiftContent({ ownerMode }: { ownerMode: boolean }) {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';


  const [overviewFilter, setOverviewFilter] = useState<ShiftOverviewFilter>('today');
  const [customOverviewFrom, setCustomOverviewFrom] = useState(() => localDateKey(new Date()));
  const [customOverviewTo, setCustomOverviewTo] = useState(() => localDateKey(new Date()));
  const [overviewAnalytics, setOverviewAnalytics] = useState<ShiftOverviewAnalytics>();
  const [overviewLoading, setOverviewLoading] = useState(ownerMode);
  const [overviewError, setOverviewError] = useState('');


  const [startingCash, setStartingCash] = useState('');
  const [startingCashEdited, setStartingCashEdited] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [differenceNote, setDifferenceNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const {
    refreshKey, shifts, setShifts, loading, ownOpenShift, store, breakdownsByShift,
    staffNames, setStaffNames, pendingVoidOrders, setPendingVoidOrders, cashMovements,
    canCashInOut, canOpenCloseShift, canPrintOwnX, archiveReports, dayStatus,
    setDayStatus, refresh,
  } = useShiftData({ storeId, user, ownerMode, setError });

  const reportTimeZone = store?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayOverviewDate = dateKeyInTimezone(
    new Date(),
    reportTimeZone,
  );
  const overviewRange = useMemo(
    () => getShiftOverviewDateRange(overviewFilter, todayOverviewDate, customOverviewFrom, customOverviewTo),
    [overviewFilter, todayOverviewDate, customOverviewFrom, customOverviewTo],
  );



  const [closedShiftSummary, setClosedShiftSummary] = useState<{ shift: ShiftRecord; breakdown: ShiftCloseBreakdown }>();




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

  const [archiveDateOverride, setArchiveDateOverride] = useState<string>();
  const archiveDate = archiveDateOverride ?? todayOverviewDate;
  const [archiveSort, setArchiveSort] = useState<'newest' | 'oldest' | 'amount-desc' | 'amount-asc'>('newest');
  const [previewZoom, setPreviewZoom] = useState(100);

  const [overviewRetry, setOverviewRetry] = useState(0);

  const zSubmissionRef = useRef(false);

  useEffect(() => updateService.registerUnsavedState(() => startingCashEdited || countedCash.length > 0), [startingCashEdited, countedCash.length]);





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

  const pageTitle = t('shift.title');
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



  return (
    <div className={`shift-workspace ${ownerMode ? 'shift-workspace--owner' : ''}`}>
      <ShiftHeader
        ownerMode={ownerMode}
        storeId={storeId}
        store={store}
        pageTitle={pageTitle}
        ownOpenShift={ownOpenShift}
        canOpenCloseShift={canOpenCloseShift}
        mayOpenShift={!closedShiftSummary || dayStatus.dayIsClosed}
        openCount={openCount}
        openStartingCashSheet={openStartingCashSheet}
        openCountedCashSheet={openCountedCashSheet}
        dayStatusMessage={dayStatusMessage}
        dayIsClosed={dayStatus.dayIsClosed}
        error={error}
        notice={notice}
        activeTab={activeTab}
        changeActiveTab={changeActiveTab}
        userId={user?.id}
      />
      <ShiftOverview
        ownerMode={ownerMode}
        overviewFilter={overviewFilter}
        setOverviewFilter={setOverviewFilter}
        customOverviewFrom={customOverviewFrom}
        setCustomOverviewFrom={setCustomOverviewFrom}
        customOverviewTo={customOverviewTo}
        setCustomOverviewTo={setCustomOverviewTo}
        overviewRange={overviewRange}
        todayOverviewDate={todayOverviewDate}
        overviewAnalytics={overviewAnalytics}
        overviewLoading={overviewLoading}
        overviewError={overviewError}
        setOverviewRetry={setOverviewRetry}
        openCount={openCount}
        openShifts={openShifts}
        breakdownsByShift={breakdownsByShift}
        pendingVoidOrders={pendingVoidOrders}
      />






      <ShiftReports
        ownerMode={ownerMode}
        activeTab={activeTab}
        reportDisabledReason={reportDisabledReason}
        zDisabledReason={zDisabledReason}
        openCount={openCount}
        pendingVoidOrders={pendingVoidOrders}
        openShifts={openShifts}
        staffNames={staffNames}
        createXReport={() => { void createXReport(); }}
        openZCloseDialog={(forceEverything) => { void openZCloseDialog(forceEverything); }}
        reportPreview={reportPreview}
        store={store}
        setReportPreview={setReportPreview}
      />

      <ShiftArchive
        ownerMode={ownerMode}
        activeTab={activeTab}
        archiveReports={archiveReports}
        archiveDate={archiveDate}
        reportTimeZone={reportTimeZone}
        archiveSort={archiveSort}
        setArchiveSort={setArchiveSort}
        reportPreview={reportPreview}
        archivePreviewDismissed={archivePreviewDismissed}
        loading={loading}
        todayOverviewDate={todayOverviewDate}
        previewZoom={previewZoom}
        setPreviewZoom={setPreviewZoom}
        store={store}
        setArchiveDateOverride={setArchiveDateOverride}
        setReportPreview={setReportPreview}
        setArchivePreviewDismissed={setArchivePreviewDismissed}
      />

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
        <ShiftCurrent
          ownOpenShift={ownOpenShift}
          ownerMode={ownerMode}
          ownBreakdown={ownBreakdown}
          store={store}
          cashMovements={cashMovements}
          staffNames={staffNames}
          canCashInOut={canCashInOut}
          canOpenCloseShift={canOpenCloseShift}
          canPrintOwnX={canPrintOwnX}
          openCashMovement={openCashMovement}
          openCashMovementHistory={openCashMovementHistory}
          openCountedCashSheet={openCountedCashSheet}
          createXReport={() => { void createXReport(); }}
        />
      ) : null}

      {reportPreview && !ownerMode && <div className="mt-4">
        <ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} />
      </div>}

      {(!ownerMode || activeTab === 'shifts') && <ShiftHistory
          ownerMode={ownerMode}
          isOwnerUser={user?.role === 'owner'}
          loading={loading}
          error={error}
          filteredHistory={filteredHistory}
          staffNames={staffNames}
          cashMovements={cashMovements}
          historySearch={historySearch}
          setHistorySearch={setHistorySearch}
          historyStatus={historyStatus}
          setHistoryStatus={setHistoryStatus}
          historyStaff={historyStaff}
          setHistoryStaff={setHistoryStaff}
          historyDate={historyDate}
          setHistoryDate={setHistoryDate}
          canCashInOut={canCashInOut}
          onOpenMovementHistory={openCashMovementHistory}
          onOpenCashMovement={openCashMovement}
          onRequestForceClose={(shift) => {
            setForceCloseShiftTarget(shift);
            setForceShiftPin('');
            setForceShiftConfirmed(false);
          }}
        />}
        </div>
      )}
      <ShiftDialogs
        ownerMode={ownerMode}
        store={store}
        openShiftSheetOpen={openShiftSheetOpen}
        closeStartingCashSheet={closeStartingCashSheet}
        startingCash={startingCash}
        setStartingCash={setStartingCash}
        setStartingCashEdited={setStartingCashEdited}
        openShift={openShift}
        zSheetOpen={zSheetOpen}
        setZSheetOpen={setZSheetOpen}
        ownerPin={ownerPin}
        setOwnerPin={setOwnerPin}
        zCountedCash={zCountedCash}
        setZCountedCash={setZCountedCash}
        zCountedCard={zCountedCard}
        setZCountedCard={setZCountedCard}
        zCountedOther={zCountedOther}
        setZCountedOther={setZCountedOther}
        zNote={zNote}
        setZNote={setZNote}
        zStep={zStep}
        setZStep={setZStep}
        forceEverythingConfirmed={forceEverythingConfirmed}
        setForceEverythingConfirmed={setForceEverythingConfirmed}
        forceCloseEverything={forceCloseEverything}
        openShifts={openShifts}
        pendingVoidOrders={pendingVoidOrders}
        staffNames={staffNames}
        zUnresolvedReversals={zUnresolvedReversals}
        error={error}
        setError={setError}
        zBusy={zBusy}
        verifyZOwnerPin={verifyZOwnerPin}
        closeDayWithZ={closeDayWithZ}
        zPaymentSplit={zPaymentSplit}
        zCardTabPayments={zCardTabPayments}
        zOtherTabPayments={zOtherTabPayments}
        zVoids={zVoids}
        zPendingVoids={zPendingVoids}
        zShiftLines={zShiftLines}
        zExpectedCash={zExpectedCash}
        zExpectedCard={zExpectedCard}
        zExpectedOther={zExpectedOther}
        zReviewed={zReviewed}
        zDifference={zDifference}
        zCardDifference={zCardDifference}
        zOtherDifference={zOtherDifference}
        parsedZCountedCash={parsedZCountedCash}
        parsedZCardMillimes={parsedZCardMillimes}
        parsedZOtherMillimes={parsedZOtherMillimes}
        hasZDifference={hasZDifference}
        hasZCountInputs={hasZCountInputs}
        closeShiftSheetOpen={closeShiftSheetOpen}
        ownOpenShift={ownOpenShift}
        closeCountedCashSheet={closeCountedCashSheet}
        ownBreakdown={ownBreakdown}
        cashMovements={cashMovements}
        countedCash={countedCash}
        differenceNote={differenceNote}
        setCountedCash={setCountedCash}
        setDifferenceNote={setDifferenceNote}
        closeShift={closeShift}
        forceCloseShiftTarget={forceCloseShiftTarget}
        setForceCloseShiftTarget={setForceCloseShiftTarget}
        forceShiftConfirmed={forceShiftConfirmed}
        setForceShiftConfirmed={setForceShiftConfirmed}
        forceShiftPin={forceShiftPin}
        setForceShiftPin={setForceShiftPin}
        forceCloseShift={forceCloseShift}
        movementSheetOpen={movementSheetOpen}
        setMovementSheetOpen={setMovementSheetOpen}
        movementKind={movementKind}
        movementAmount={movementAmount}
        setMovementAmount={setMovementAmount}
        movementReason={movementReason}
        setMovementReason={setMovementReason}
        movementNote={movementNote}
        setMovementNote={setMovementNote}
        movementBusy={movementBusy}
        movementShiftId={movementShiftId}
        enteredMovementMillimes={enteredMovementMillimes}
        submitCashMovement={submitCashMovement}
        cashMovementHistoryShift={cashMovementHistoryShift}
        cashMovementHistoryClosing={cashMovementHistoryClosing}
        closeCashMovementHistory={closeCashMovementHistory}
        closeCashMovementHistoryAndViewAll={closeCashMovementHistoryAndViewAll}
      />





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
  return <div className="min-h-screen bg-surface pb-24"><main className="p-0"><PageContainer>{content}</PageContainer></main><BottomNav /></div>;
}
