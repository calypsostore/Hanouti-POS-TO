import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent, type TransitionEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageHeader, StatGrid } from '../components/layout';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { Button } from '../components/Button';
import { OverdueCustomerRow } from '../components/OverdueCustomerRow';
import { StatusTag } from '../components/StatusTag';
import { TabStatementView } from '../components/TabStatementView';
import { ownerWorkspaceLinks } from '../app/navigation';
import { getLanguage, localizeErrorMessage, t as baseT, type TranslationKey, type TranslationValues } from '../i18n';
import { enReports } from '../i18n/locales/en/reports';
import { frReports } from '../i18n/locales/fr/reports';
import { arReports } from '../i18n/locales/ar/reports';
import { formatTnd } from '../lib/format';
import { useQueryCacheRefresh } from '../lib/useQueryCacheRefresh';
import { reportService, type ReportDayStatus } from '../services/reportService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { customerService } from '../services/customerService';
import { notificationService, selectOwnerDashboardNotifications } from '../services/notificationService';
import { getNotificationAppearance } from '../lib/notificationAppearance';
import { getNotificationContent } from '../lib/notificationContent';
import { getSubscriptionDaysRemaining } from '../lib/subscriptionExpiry';
import { NotificationTypeIcon } from '../components/NotificationTypeIcon';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { shareCustomerStatement } from '../services/customerStatementShare';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import { createLatestRequestGuard } from '../lib/requestGuard';
import type { CustomerStatementData, OverdueCustomerRecord } from '../services/customerService';
import type { CatalogItemRecord, NotificationRecord, ShiftRecord, StoreRecord } from '../types/domain';

type Period = 'day' | 'week' | 'month' | 'year';
type ReportsKey = keyof typeof enReports;
const reportsLocales = { en: enReports, fr: frReports, ar: arReports };

function t(key: TranslationKey | ReportsKey, values: TranslationValues = {}): string {
  const localized = reportsLocales[getLanguage()][key as ReportsKey];
  if (localized === undefined) return baseT(key as TranslationKey, values);
  return localized.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

const periodLabels: Record<Period, TranslationKey> = {
  day: 'owner.today',
  week: 'owner.week',
  month: 'owner.month',
  year: 'owner.year',
};

type DashboardSummary = Awaited<ReturnType<typeof reportService.getDashboard>>;

const PeakHoursChart = lazy(() => import('../components/PerformanceCharts').then((module) => ({ default: module.PeakHoursChart })));
const DashboardSalesByDateChart = lazy(() => import('../components/PerformanceCharts').then((module) => ({ default: module.DashboardSalesByDateChart })));
const DashboardSalesByStaffChart = lazy(() => import('../components/PerformanceCharts').then((module) => ({ default: module.DashboardSalesByStaffChart })));

const emptySummary: DashboardSummary = {
  salesMillimes: 0,
  salesCollectedMillimes: 0,
  expensesMillimes: 0,
  netProfitMillimes: 0,
  receivableMillimes: 0,
  orderCount: 0,
  cashDifferenceMillimes: 0,
  topItems: {},
  shifts: [],
  tabsOutstandingMillimes: 0,
  salesByCategory: [],
  itemsSold: [],
  voids: { count: 0, totalMillimes: 0, orders: [] },
  pendingVoids: { count: 0, totalMillimes: 0, orders: [] },
  voidAdjustments: [],
  expenseDetails: [],
  comps: { count: 0, quantity: 0, totalMillimes: 0, records: [] },
  shiftLines: [],
  paymentSplit: { cash: 0, card: 0, other: 0, tab: 0 },
  totalExpectedCashMillimes: 0,
  totalCountedMillimes: 0,
  totalDifferenceMillimes: 0,
  cashSalesMillimes: 0,
  tabSalesMillimes: 0,
  tabPaymentsReceivedMillimes: 0,
  cashFloatMillimes: 0,
  expectedCashExFloatMillimes: 0,
  nonCashTabPaymentsMillimes: 0,
  cardTabPaymentsMillimes: 0,
  otherTabPaymentsMillimes: 0,
  cashOuts: [],
  firstTicketNumber: undefined,
  lastTicketNumber: undefined,
  cashInMillimes: 0,
  cashOutMillimes: 0,
  cashRefundsMillimes: 0,
  ambiguousTabReversalIds: [],
  unresolvedTabReversals: [],
  cashMovements: [],
  employeeBreakdown: [],
  salesByDay: [],
  salesByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 })),
  salesTodayMillimes: 0,
  salesLastWeekMillimes: 0,
  recentOrders: [],
  customerTabs: [],
  tabsIssuedMillimes: 0,
  tabsSettledMillimes: 0,
};

function OwnerDashboardContent() {
  const user = useAuthStore((state) => state.user);
  const refreshGuardRef = useRef(createLatestRequestGuard());
  const navigate = useNavigate();
  const storeId = user?.storeId ?? '';
  const cacheRevision = useQueryCacheRefresh(['catalog_items', 'categories', 'stores', 'store_settings']);
  const [store, setStore] = useState<StoreRecord>();
  const [period, setPeriod] = useState<Period>('day');
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });
  const [runningShifts, setRunningShifts] = useState<ShiftRecord[]>([]);
  const [profileNames, setProfileNames] = useState<Map<string, string>>(() => new Map());
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [overdueCustomers, setOverdueCustomers] = useState<OverdueCustomerRecord[]>([]);
  const [ownerNotifications, setOwnerNotifications] = useState<NotificationRecord[]>([]);
  const [dismissedOwnerNotificationIds, setDismissedOwnerNotificationIds] = useState<Set<string>>(() => new Set());
  const [notificationDismissError, setNotificationDismissError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [overdueStatement, setOverdueStatement] = useState<CustomerStatementData | null>(null);
  const [overdueAction, setOverdueAction] = useState<{ customerId: string; action: 'statement' | 'share' } | null>(null);
  const [overdueActionError, setOverdueActionError] = useState('');
  const [chartsNearViewport, setChartsNearViewport] = useState(false);
  const chartSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDismissedOwnerNotificationIds(new Set());
  }, [user?.id]);

  useEffect(() => {
    if (chartsNearViewport) return;
    const section = chartSectionRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === 'undefined') {
      setChartsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setChartsNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, [chartsNearViewport]);

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      const requestGeneration = refreshGuardRef.current.begin();
      setLoading(true);
      setLoadError('');
      try {
        const critical = await Promise.allSettled([
          reportService.getDashboard(storeId, period),
          userService.listProfileNamesForStore(storeId),
          userService.getStore(storeId),
          catalogService.listItems(storeId),
          reportService.getDayStatus(storeId),
          shiftService.listOpenShifts(storeId),
        ]);
        if (!active || !refreshGuardRef.current.isLatest(requestGeneration)) return;
        const [summaryResult, profileNamesResult, storeResult, catalogResult, dayStatusResult, openShiftsResult] = critical;
        if (!active) return;
        if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
        if (profileNamesResult.status === 'fulfilled') setProfileNames(profileNamesResult.value);
        if (storeResult.status === 'fulfilled') setStore(storeResult.value);
        if (catalogResult.status === 'fulfilled') setCatalogItems(catalogResult.value);
        if (dayStatusResult.status === 'fulfilled') setDayStatus(dayStatusResult.value);
        if (openShiftsResult.status === 'fulfilled') setRunningShifts(openShiftsResult.value);
        const criticalFailure = critical.find((result) =>
          result.status === 'rejected' &&
          (result.reason instanceof Error && /dashboard|report|store|catalog|shift/i.test(result.reason.message)),
        );
        if (criticalFailure) {
          setLoadError(t('reportsPage.dashboardLoadPartial'));
        }

        try {
          const nextOverdueCustomers = await customerService.listOverdueCustomers(storeId);
          if (active && refreshGuardRef.current.isLatest(requestGeneration)) setOverdueCustomers(nextOverdueCustomers);
        } catch (overdueError) {
          console.error('Unable to load overdue customers; dashboard remains available.', overdueError);
        }

        if (user?.role === 'owner') {
          try {
            await notificationService.checkOverdueCustomers(storeId, user.id);
          } catch (notificationError) {
            console.error('Unable to refresh owner notifications.', notificationError);
          }
          try {
            const notifications = await notificationService.listImportantForDashboard(user);
            if (active) {
              setOwnerNotifications(selectOwnerDashboardNotifications(
                notifications,
                catalogResult.status === 'fulfilled' ? catalogResult.value : [],
              ));
            }
          } catch (notificationError) {
            console.error('Unable to load owner notifications.', notificationError);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDashboard().catch((loadError: unknown) => {
      console.error('Unable to load owner dashboard.', loadError);
      if (active) setLoadError(t('reportsPage.dashboardLoadError'));
    });
    const refresh = () => {
      void loadDashboard().catch((loadError: unknown) => {
        console.error('Unable to refresh owner dashboard after a live update.', loadError);
        if (active) setLoadError(t('reportsPage.dashboardRefreshError'));
      });
    };
    window.addEventListener('focus', refresh);
    const unsubscribe = subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications', 'catalog_items', 'categories', 'stores', 'store_settings'], refresh);
    return () => {
      active = false;
      refreshGuardRef.current.begin();
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, [cacheRevision, period, storeId, user]);

  async function openOverdueStatement(customer: OverdueCustomerRecord['customer']) {
    setOverdueAction({ customerId: customer.id, action: 'statement' });
    setOverdueActionError('');
    try {
      setOverdueStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (statementError) {
      console.error('Unable to load the customer statement.', statementError);
      setOverdueActionError(t('reportsPage.statementLoadError'));
    } finally {
      setOverdueAction(null);
    }
  }

  async function shareOverdueStatement(customer: OverdueCustomerRecord['customer']) {
    setOverdueAction({ customerId: customer.id, action: 'share' });
    setOverdueActionError('');
    try {
      await shareCustomerStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (shareError) {
      if (!(shareError instanceof Error && shareError.name === 'AbortError')) {
        setOverdueActionError(localizeErrorMessage(shareError, t('reportsPage.statementShareError')));
      }
    } finally {
      setOverdueAction(null);
    }
  }

  async function selectPeriod(nextPeriod: Period) {
    try {
      const nextSummary = await reportService.getDashboard(storeId, nextPeriod);
      setSummary(nextSummary);
      setPeriod(nextPeriod);
      setOverdueActionError('');
    } catch (loadError) {
      console.error('Unable to load the selected dashboard period.', loadError);
      setOverdueActionError(t('reportsPage.periodLoadError'));
    }
  }

  const itemSales = useMemo(
    () => new Map((summary.itemsSold ?? []).map((item) => [item.itemId, item])),
    [summary.itemsSold],
  );
  const rankedItems = useMemo(() => catalogItems.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: itemSales.get(item.id)?.quantity ?? 0,
    totalMillimes: itemSales.get(item.id)?.totalMillimes ?? 0,
  })).sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name)),
  [catalogItems, itemSales]);
  const bestSellers = useMemo(() => rankedItems.filter((item) => item.quantity > 0).slice(0, 5), [rankedItems]);
  const bestSellerIds = useMemo(() => new Set(bestSellers.map((item) => item.id)), [bestSellers]);
  const slowSellers = useMemo(() => rankedItems
    .filter((item) => !bestSellerIds.has(item.id))
    .sort((left, right) => left.quantity - right.quantity || left.name.localeCompare(right.name))
    .slice(0, 5), [bestSellerIds, rankedItems]);
  const lowStockItems = useMemo(() => catalogItems.filter((item) =>
    item.stockCount !== null && item.stockCount <= (item.lowStockThreshold ?? 5),
  ).sort((left, right) => (left.stockCount ?? 0) - (right.stockCount ?? 0)), [catalogItems]);
  const openShifts = useMemo(
    () => summary.shifts.filter((shift) => shift.status === 'open'),
    [summary.shifts],
  );
  const currentlyWorking = useMemo(() => {
    const seenStaff = new Set<string>();
    return openShifts.filter((shift) => {
      if (seenStaff.has(shift.staffId)) return false;
      seenStaff.add(shift.staffId);
      return true;
    });
  }, [openShifts]);
  const salesByStaff = useMemo(() => {
    return summary.employeeBreakdown
      .map((employee) => ({
        name: employee.name,
        sales: employee.salesMillimes / 1000,
        orders: employee.orderCount,
      }))
      .sort((left, right) => right.sales - left.sales);
  }, [summary.employeeBreakdown]);
  const salesByDate = useMemo(() => summary.salesByDay.map(({ date, salesMillimes }) => ({
    date,
    label: new Date(`${date}T00:00:00`).toLocaleDateString(getLanguage(), { month: 'short', day: 'numeric' }),
    sales: salesMillimes / 1000,
  })), [summary.salesByDay]);
  const recentOrders = summary.recentOrders;
  const peakHours = summary.salesByHour;
  const todaySalesMillimes = summary.salesTodayMillimes;
  const lastWeekSalesMillimes = summary.salesLastWeekMillimes;
  const pendingVoidOrders = summary.pendingVoids.orders;
  const targetMillimes = store?.dailySalesTargetMillimes ?? 0;
  const targetProgress = targetMillimes > 0 ? Math.round(todaySalesMillimes / targetMillimes * 100) : 0;
  const targetProgressWidth = Math.min(100, targetProgress);
  const salesDifference = todaySalesMillimes - lastWeekSalesMillimes;
  const salesDifferencePercent = lastWeekSalesMillimes > 0
    ? Math.round(salesDifference / lastWeekSalesMillimes * 100)
    : undefined;
  const salesComparisonLabel = salesDifferencePercent === undefined
    ? (todaySalesMillimes > 0 ? t('owner.newSalesLastWeek') : t('owner.noSalesLastWeek'))
    : `${salesDifference >= 0 ? '+' : '-'}${formatTnd(Math.abs(salesDifference) / 1000)} DT (${salesDifferencePercent > 0 ? '+' : ''}${salesDifferencePercent}%) ${t('owner.vsLastWeek')}`;
  const renderTargetCard = (className: string) => (
    <article className={`dashboard-target-card dashboard-glass dashboard-glass-tint--amber rounded-3xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.salesTarget')}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">
            {t('reportsPage.todayLabel', { sales: formatTnd(todaySalesMillimes / 1000) })}
            {targetMillimes > 0 && ` / ${formatTnd(targetMillimes / 1000)} DT`}
          </p>
        </div>
        <MaterialIcon name="flag" className="shrink-0 text-2xl text-primary" />
      </div>
      {targetMillimes > 0 ? (
        <>
          <div
            role="progressbar"
            aria-label={t('owner.salesTarget')}
            aria-valuemin={0}
            aria-valuemax={targetMillimes}
            aria-valuenow={Math.min(todaySalesMillimes, targetMillimes)}
            className="mt-4 h-3 overflow-hidden rounded-full bg-surface-container"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${targetProgressWidth}%` }} />
          </div>
          <p className="mt-2 font-body text-label-md text-on-surface">{t('owner.salesProgress', { progress: targetProgress })}</p>
        </>
      ) : (
        <button type="button" onClick={() => navigate('/owner/settings')} className="mt-3 min-h-12 text-left font-body text-label-md text-primary underline">
          {t('owner.targetNotSet')}
        </button>
      )}
      <p className="mt-2 font-body text-body-sm text-on-surface-variant">{salesComparisonLabel}</p>
    </article>
  );
  const dayStatusMessage = dayStatus.openShiftCount > 0
    ? t('reportsPage.dayOpenShifts', {
      count: dayStatus.openShiftCount,
      shiftLabel: t(dayStatus.openShiftCount === 1 ? 'reportsPage.shift' : 'reportsPage.shifts'),
      staff: runningShifts.map((shift) =>
        shift.staffId === user?.id ? user?.name ?? t('reportsPage.owner') : profileNames.get(shift.staffId) ?? t('reportsPage.fallbackStaff'),
      ).join(', '),
    })
    : dayStatus.dayIsClosed
      ? t('reportsPage.dayClosed', { report: dayStatus.lastZ?.reportNumber ?? t('reportsPage.zReport'), time: dayStatus.lastZ ? new Date(dayStatus.lastZ.createdAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' }) : '--:--' })
      : dayStatus.hasActivity
        ? t('reportsPage.dayOpenNoShifts')
        : t('reportsPage.noShiftToday');
  const reportDisabledReason = dayStatus.dayIsClosed
    ? t('reportsPage.businessDayClosedBlock')
    : !dayStatus.hasActivity
      ? t('reportsPage.noShiftTodayBlock')
      : '';
  const zDisabledReason = reportDisabledReason ||
    (dayStatus.openShiftCount > 0 ? t('reportsPage.closeAllShiftsBlock') : '');
  const visibleOwnerNotifications = ownerNotifications
    .filter((notification) => !notification.readAt && !dismissedOwnerNotificationIds.has(notification.id))
    .slice(0, 5);
  const subscriptionDaysRemaining = store?.subscription?.paidUntil
    ? getSubscriptionDaysRemaining(store.subscription.paidUntil)
    : null;

  async function dismissOwnerNotification(notificationId: string): Promise<boolean> {
    setNotificationDismissError('');
    if (!user) {
      setNotificationDismissError(t('notification.dismissFailed'));
      return false;
    }
    try {
      await notificationService.markRead(user, notificationId);
      setDismissedOwnerNotificationIds((current) => new Set([...current, notificationId]));
      return true;
    } catch (error) {
      console.error('Unable to dismiss owner dashboard notification.', error);
      setNotificationDismissError(t('notification.dismissFailed'));
      return false;
    }
  }

  return (
    <>
    <WorkspaceLayout title={t('owner.dashboard')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <div className="role-dashboard owner-dashboard">
      <PageHeader title={t('owner.dashboard')} subtitle={store?.name} className="dashboard-welcome" actions={
        <div className="dashboard-period-switcher dashboard-segmented-control flex gap-1 rounded-xl bg-surface-container-high p-1">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} type="button" onClick={() => selectPeriod(value)} className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${period === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}>
              {t(periodLabels[value])}
            </button>
          ))}
        </div>
      } />
      {subscriptionDaysRemaining !== null && subscriptionDaysRemaining <= 7 && (
        <section
          role="alert"
          aria-live="assertive"
          className="owner-subscription-warning mt-4 flex items-center gap-3 rounded-xl p-4"
        >
          <MaterialIcon name="warning" className="owner-subscription-warning-icon shrink-0 text-2xl" />
          <div>
            <p className="font-display text-title-md">
              {subscriptionDaysRemaining < 0
                ? t('owner.subscriptionExpired')
                : t('owner.subscriptionWarningTitle')}
            </p>
            <p className="mt-1 font-body text-body-sm">
              {subscriptionDaysRemaining < 0
                ? t('owner.subscriptionExpiredMessage')
                : subscriptionDaysRemaining === 0
                  ? t('owner.subscriptionExpiresToday')
                  : t('owner.subscriptionExpiresInDays', { days: subscriptionDaysRemaining })}
            </p>
          </div>
        </section>
      )}
      {visibleOwnerNotifications.length > 0 && (
        <section aria-label={t('reportsPage.ownerNotifications')} className="mt-4 mb-4 flex flex-col gap-2">
          {notificationDismissError && (
            <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">
              {notificationDismissError}
            </p>
          )}
          {visibleOwnerNotifications.map((notification) => (
            <DismissibleOwnerNotification
              key={notification.id}
              notification={notification}
              onDismiss={dismissOwnerNotification}
            />
          ))}
        </section>
      )}
      <p role="status" className={`dashboard-status mb-4 rounded-xl p-3 font-body text-body-sm ${dayStatus.dayIsClosed ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-low text-on-surface-variant'}`}>
        {dayStatusMessage}
      </p>

      <StatGrid className="owner-kpi-grid mt-4">
        <SummaryCard icon="payments" label={`${t('finance.sales')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.salesCollectedMillimes / 1000)} DT`} tone="blue" showSalesHelp />
        <SummaryCard icon="request_quote" label={`${t('finance.expenses')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.expensesMillimes / 1000)} DT`} tone="amber" />
        <SummaryCard icon="account_balance" label={`${t('finance.netProfit')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.netProfitMillimes / 1000)} DT`} tone={summary.netProfitMillimes < 0 ? 'rose' : 'green'} />
        <SummaryCard icon="account_balance_wallet" label={t('finance.receivable')} value={`${formatTnd(summary.receivableMillimes / 1000)} DT`} tone="violet" />
        <SummaryCard icon="receipt_long" label={t('reportsPage.ordersPeriod', { period: t(periodLabels[period]) })} value={String(summary.orderCount)} tone="teal" />
        <SummaryCard icon="price_change" label={`${t('owner.cashDifferences')} · ${t(periodLabels[period])}`} value={formatSignedAmount(summary.cashDifferenceMillimes)} tone={summary.cashDifferenceMillimes === 0 ? 'green' : 'amber'} />
      </StatGrid>
      {summary.unresolvedTabReversals && summary.unresolvedTabReversals.length > 0 && (
        <section role="alert" className="mt-4 rounded-2xl bg-warning-container p-4 text-on-warning-container">
          <h2 className="font-display text-headline-sm">{t('reportsPage.unresolvedReversals')}</h2>
          <div className="mt-2 flex flex-col gap-1">
            {summary.unresolvedTabReversals.map((reversal) => (
              <p key={reversal.reversalId} className="font-body text-body-sm">
                {t('reportsPage.reversalDetails', { method: reversal.paymentMethod.toUpperCase(), amount: formatTnd(reversal.amountMillimes / 1000), reversal: reversal.reversalId, settlement: reversal.originalSettlementId })}
              </p>
            ))}
          </div>
        </section>
      )}

      {renderTargetCard('lg:hidden')}

      <CardGrid className="owner-alert-grid mobile-card-list mobile-gap-3 mt-4">
        <button type="button" onClick={() => navigate('/owner/voids')} className="dashboard-glass dashboard-glass-tint--rose w-full rounded-3xl p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="pending_actions" className="dashboard-tone-icon dashboard-tone-icon--rose" />{t('owner.pendingVoidRequests')}</h2>
            <strong className="font-display text-headline-md tabular-nums text-error-dark">{pendingVoidOrders.length}</strong>
          </div>
          {pendingVoidOrders.length > 0 ? (
            <p className="mt-2 font-body text-body-sm text-on-surface-variant">
              {pendingVoidOrders.slice(0, 3).map((order) =>
                `#${order.ticketNumber} · ${formatTnd(order.amountMillimes / 1000)} DT${order.reason ? ` · ${order.reason}` : ''}`,
              ).join(' · ')}
            </p>
          ) : <p className="mt-2 font-body text-body-sm text-on-surface-variant">{t('reportsPage.noPendingRequests')}</p>}
        </button>

        <button type="button" onClick={() => navigate('/owner/inventory')} className="dashboard-glass dashboard-glass-tint--amber w-full rounded-3xl p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="inventory_2" className="dashboard-tone-icon dashboard-tone-icon--amber" />{t('owner.lowStockItems')}</h2>
            <strong className="font-display text-headline-md tabular-nums text-warning-dark">{lowStockItems.length}</strong>
          </div>
          {lowStockItems.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {lowStockItems.slice(0, 4).map((item) => (
                <li key={item.id} className="flex min-w-0 justify-between gap-3 font-body text-body-sm text-on-surface-variant">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums">{item.stockCount ?? 0} / {item.lowStockThreshold ?? 5}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 font-body text-body-sm text-on-surface-variant">{t('reportsPage.noLowStock')}</p>}
        </button>

        <article className="dashboard-glass dashboard-glass-tint--green rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="groups" className="dashboard-tone-icon dashboard-tone-icon--green" />{t('owner.staffOnShift')}</h2>
            <strong className="font-display text-headline-md tabular-nums text-primary">{currentlyWorking.length}</strong>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {currentlyWorking.map((shift) => (
              <p key={shift.id} className="flex justify-between gap-3 font-body text-body-sm text-on-surface-variant">
                <span>{profileNames.get(shift.staffId) ?? t('reportsPage.fallbackStaff')}</span>
                <span className="shrink-0">{new Date(shift.openedAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })}</span>
              </p>
            ))}
            {currentlyWorking.length === 0 && <p className="font-body text-body-sm text-on-surface-variant">{t('owner.noStaffOnShift')}</p>}
          </div>
        </article>
      </CardGrid>

      <section aria-label={t('owner.overdueTabs')} className="dashboard-glass mt-4 rounded-2xl p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface">
              <MaterialIcon name="event_busy" className="text-error-dark" />{t('owner.overdueTabs')}
            </h2>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {t('reportsPage.overdueCustomerCount', { count: overdueCustomers.length, plural: overdueCustomers.length === 1 ? '' : t('reportsPage.customerPlural') })}
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/customers?filter=overdue')}>
            {t('reportsPage.viewAll')}
          </Button>
        </div>
          {loadError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{loadError}</p>}
          {overdueActionError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{overdueActionError}</p>}
          {loading && <ListSkeleton rows={3} label={t('reportsPage.loadingDashboardLists')} />}
        <CardGrid className="mobile-gap-2 overdue-tabs-grid">
          {overdueCustomers.map((entry) => (
            <OverdueCustomerRow
              key={entry.customer.id}
              entry={entry}
              busyAction={overdueAction?.customerId === entry.customer.id ? overdueAction.action : null}
              onStatement={() => { void openOverdueStatement(entry.customer); }}
              onShare={() => { void shareOverdueStatement(entry.customer); }}
            />
          ))}
          {overdueCustomers.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('reportsPage.noOverdueAccounts')}</p>}
        </CardGrid>
        <p className="mt-3 font-body text-body-xs text-on-surface-variant">{t('reportsPage.shareSheetHelp')}</p>
      </section>

      <section ref={chartSectionRef} className="owner-chart-grid mobile-gap-3 mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {renderTargetCard('hidden lg:block dashboard-target-card--desktop')}

        <article className="dashboard-peak-chart dashboard-glass dashboard-glass-tint--blue rounded-2xl p-4 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.peakHours')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('reportsPage.completedOrdersByHour')}</p>
          <div className="mt-3 h-64 min-w-0">
            {chartsNearViewport && (
              <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
                <PeakHoursChart data={peakHours} />
              </Suspense>
            )}
          </div>
        </article>

        <article className="dashboard-sales-chart dashboard-glass dashboard-glass-tint--amber rounded-2xl p-4 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('reportsPage.salesOverTime', { period: t(periodLabels[period]) })}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('reportsPage.completedSalesByDay')}</p>
          {salesByDate.length ? (
            <div className="mt-3 h-64 min-w-0">
              {chartsNearViewport && (
                <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
                  <DashboardSalesByDateChart data={salesByDate} />
                </Suspense>
              )}
            </div>
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>

        <article className="dashboard-list-card dashboard-glass dashboard-glass-tint--green rounded-2xl p-5 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.bestSellers')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('reportsPage.completedProductSales')}</p>
          {bestSellers.length ? (
            <ItemRankingList items={bestSellers} />
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('owner.noItemsSold')}</p>}
        </article>

        <article className="dashboard-list-card dashboard-glass dashboard-glass-tint--violet rounded-2xl p-5 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.slowSellers')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('reportsPage.fewestSalesProducts')}</p>
          {slowSellers.length ? (
            <ItemRankingList items={slowSellers} />
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('owner.noItemsSold')}</p>}
        </article>

        <article className="dashboard-staff-chart dashboard-glass dashboard-glass-tint--teal rounded-2xl p-4 shadow-card">
          <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="group" className="text-primary" />{t('reportsPage.salesByStaffMember', { period: t(periodLabels[period]) })}</h2>
          {salesByStaff.length ? (
            <div className="h-64">
              {chartsNearViewport && (
                <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
                  <DashboardSalesByStaffChart data={salesByStaff} />
                </Suspense>
              )}
            </div>
          ) : <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>
      </section>

      <CardGrid className="mobile-gap-3 mt-4">
        <article className="dashboard-glass rounded-2xl p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="receipt_long" className="text-primary" />{t('reportsPage.recentOrders')}</h2>
          <div className="flex flex-col gap-2">
            {recentOrders.map((order) => {
              const staffName = order.staffName ?? t('reportsPage.fallbackStaff');
              return (
                <button key={order.id} type="button" onClick={() => navigate('/orders')} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 text-left">
                  <div className="min-w-0">
                    <p className="font-body text-label-md text-on-surface">#{order.number} <span className="ml-1 text-on-surface-variant">• {staffName}</span></p>
                    <p className="mt-1 truncate font-body text-body-sm text-outline">{new Date(order.createdAt).toLocaleString(getLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-label-lg tabular-nums text-on-surface">{formatTnd(order.totalMillimes / 1000)} DT</p>
                    <StatusTag status={order.status === 'done' ? 'done' : order.status === 'pending_void' ? 'pending' : 'voided'}>{order.status === 'done' ? t('reportsPage.completed') : order.status === 'pending_void' ? t('reportsPage.pendingVoid') : t('reportsPage.voided')}</StatusTag>
                  </div>
                </button>
              );
            })}
            {recentOrders.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </article>

        <article className="dashboard-glass rounded-2xl p-4 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="schedule" className="text-primary" />{t('reportsPage.shiftOverview')}</h2>
            <div className="flex gap-2">
              <Button disabled={Boolean(reportDisabledReason)} variant="secondary" onClick={() => navigate('/owner/shifts?tab=reports')}><MaterialIcon name="summarize" />{t('reportsPage.xReport')}</Button>
              <Button disabled={Boolean(zDisabledReason)} variant="secondary" onClick={() => navigate('/owner/shifts?tab=reports')}><MaterialIcon name="lock" />{t('reportsPage.zReport')}</Button>
            </div>
          </div>
          {(reportDisabledReason || zDisabledReason) && (
            <p className="mb-3 font-body text-body-sm text-outline">{reportDisabledReason || zDisabledReason}</p>
          )}
          <div className="flex flex-col gap-2">
            {summary.shifts.map((shift) => (
              <ShiftSummary key={shift.id} shift={shift} staffName={profileNames.get(shift.staffId) ?? t('reportsPage.fallbackStaff')} />
            ))}
            {summary.shifts.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </article>
      </CardGrid>

      <section className="mt-4">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{t('reportsPage.quickAccess')}</h2>
        <CardGrid columns={4} className="mobile-gap-3 quick-access-grid">
          {[
            { label: t('reportsPage.orders'), icon: 'receipt_long', to: '/orders', tone: 'blue' },
            { label: t('reportsPage.staff'), icon: 'groups', to: '/owner/staff', tone: 'violet' },
            { label: t('reportsPage.products'), icon: 'inventory_2', to: '/owner/catalog', tone: 'amber' },
            { label: t('reportsPage.inventory'), icon: 'inventory', to: '/owner/inventory', tone: 'green' },
            { label: t('reportsPage.reports'), icon: 'analytics', to: '/owner/reports', tone: 'teal' },
          ].map((item) => (
            <button key={item.label} type="button" onClick={() => navigate(item.to)} className={`quick-glass-tile dashboard-quick-tile dashboard-quick-tile--${item.tone} flex min-h-24 w-full items-center gap-3 rounded-2xl p-5 text-left`}>
              <span className="dashboard-quick-tile__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"><MaterialIcon name={item.icon} /></span>
              <span className="font-body text-label-lg text-on-surface">{item.label}</span>
            </button>
          ))}
        </CardGrid>
      </section>
      </div>
    </WorkspaceLayout>
    {overdueStatement && (
      <TabStatementView
        customer={overdueStatement.customer}
        storeName={store?.name ?? ''}
        balanceMillimes={overdueStatement.balanceMillimes}
        transactions={overdueStatement.transactions}
        orders={overdueStatement.orders}
        onClose={() => setOverdueStatement(null)}
      />
    )}
    </>
  );
}

function DismissibleOwnerNotification({ notification, onDismiss }: {
  notification: NotificationRecord;
  onDismiss: (notificationId: string) => Promise<boolean>;
}) {
  const swipeStartRef = useRef<{ x: number; y: number; offset: number } | null>(null);
  const dismissalInFlightRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const revealOffset = 72;
  const dismissOffset = 148;
  const maxDragOffset = 184;
  const content = getNotificationContent(notification);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || isDismissing || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY, offset: dragX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const start = swipeStartRef.current;
    if (!start || isDismissing) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (deltaX >= 0 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    setIsDragging(true);
    setDragX(Math.max(-maxDragOffset, Math.min(0, start.offset + deltaX)));
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setIsDragging(false);
    if (!start || isDismissing) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) {
      setDragX(start.offset);
      return;
    }

    const nextOffset = Math.max(-maxDragOffset, Math.min(0, start.offset + deltaX));
    if (nextOffset <= -dismissOffset) {
      setIsDismissing(true);
    } else if (nextOffset <= -32) {
      setDragX(-revealOffset);
    } else {
      setDragX(0);
    }
  }

  function handlePointerCancel() {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setIsDragging(false);
    setDragX(start?.offset ?? 0);
  }

  function handleTransitionEnd(event: TransitionEvent<HTMLElement>) {
    if (
      isDismissing &&
      !dismissalInFlightRef.current &&
      event.target === event.currentTarget &&
      event.propertyName === 'transform'
    ) {
      dismissalInFlightRef.current = true;
      void onDismiss(notification.id).then((dismissed) => {
        if (dismissed) return;
        dismissalInFlightRef.current = false;
        setIsDismissing(false);
        setDragX(0);
      });
    }
  }

  return (
    <div className="owner-dashboard-notification-shell">
      <button
        type="button"
        aria-label={`${t('common.dismiss')}: ${content.title}`}
        aria-hidden={dragX > -32 || isDismissing}
        tabIndex={dragX <= -32 && !isDismissing ? 0 : -1}
        onClick={() => setIsDismissing(true)}
        className="owner-dashboard-notification-delete"
      >
        <MaterialIcon name="delete" className="text-white" />
      </button>
      <article
        role="status"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onTransitionEnd={handleTransitionEnd}
        style={isDismissing ? undefined : { transform: `translateX(${dragX}px)` }}
        className={`owner-dashboard-notification notification-type-card notification-type-card--${getNotificationAppearance(notification.type).tone} flex items-center gap-3 rounded-xl p-3${isDragging ? ' is-dragging' : ''}${isDismissing ? ' is-dismissing' : ''}`}
      >
        <NotificationTypeIcon type={notification.type} />
        <span className="min-w-0 flex-1 font-body text-body-sm text-on-surface"><strong>{content.title}:</strong> {content.body}</span>
        <button
          type="button"
          aria-label={`${t('common.dismiss')}: ${content.title}`}
          onClick={() => setIsDismissing(true)}
          className="owner-dashboard-notification-dismiss"
        >
          <MaterialIcon name="close" />
        </button>
      </article>
    </div>
  );
}

function SummaryCard({ icon, label, value, tone, showSalesHelp = false }: {
  icon: string;
  label: string;
  value: string;
  tone: 'blue' | 'amber' | 'green' | 'rose' | 'teal' | 'violet';
  showSalesHelp?: boolean;
}) {
  return (
    <article className={`stat-card dashboard-glass dashboard-glass-kpi dashboard-glass-tint--${tone} relative flex h-full min-w-0 flex-col rounded-3xl p-4`}>
      <span className={`dashboard-icon-tile dashboard-icon-tile--${tone} flex h-10 w-10 items-center justify-center rounded-xl`}><MaterialIcon name={icon} className="text-lg" /></span>
      <p className="mt-3 flex items-center gap-1 font-body text-body-sm text-on-surface-variant">
        {label}
        {showSalesHelp && <span className="sales-help-tooltip">
          <button type="button" aria-label={`${t('finance.salesHelp')} ${t('finance.receivableHelp')}`} className="flex h-6 w-6 items-center justify-center rounded-full text-outline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <MaterialIcon name="info" className="text-base" />
          </button>
          <span role="tooltip">{t('finance.salesHelp')} {t('finance.receivableHelp')}</span>
        </span>}
      </p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{value}</p>
    </article>
  );
}

function ShiftSummary({ shift, staffName }: { shift: ShiftRecord; staffName: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3">
      <div>
        <p className="font-body text-label-md text-on-surface">{staffName}</p>
        <p className="mt-1 font-body text-body-sm text-outline">{new Date(shift.openedAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="text-right">
        <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? t('reportsPage.started') : t('reportsPage.closed')}</StatusTag>
        {shift.differenceMillimes !== undefined && <p className="mt-1 font-body text-label-sm tabular-nums text-on-surface-variant">{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
      </div>
    </div>
  );
}

function formatSignedAmount(amountMillimes: number) {
  const sign = amountMillimes > 0 ? '+' : amountMillimes < 0 ? '-' : '';
  return `${sign}${formatTnd(Math.abs(amountMillimes) / 1000)} DT`;
}

function ItemRankingList({ items }: {
  items: { id: string; name: string; quantity: number; totalMillimes: number }[];
}) {
  return (
    <ol className="mt-3 flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3">
          <span className="flex min-w-0 items-center gap-3">
            <strong className="font-display text-title-md text-primary">{index + 1}</strong>
            <span className="truncate font-body text-label-md text-on-surface">{item.name}</span>
          </span>
          <span className="shrink-0 text-right">
            <strong className="block font-body text-label-md tabular-nums text-on-surface">{t('owner.unitsSold', { count: item.quantity })}</strong>
            <span className="font-body text-body-xs tabular-nums text-on-surface-variant">{formatTnd(item.totalMillimes / 1000)} DT</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OwnerDashboardScreen() {
  return <OwnerDashboardContent />;
}
