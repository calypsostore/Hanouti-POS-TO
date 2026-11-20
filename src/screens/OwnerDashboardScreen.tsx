import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageHeader, StatGrid } from '../components/layout';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { Button } from '../components/Button';
import { OverdueCustomerRow } from '../components/OverdueCustomerRow';
import { StatusTag } from '../components/StatusTag';
import { TabStatementView } from '../components/TabStatementView';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t, type TranslationKey } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService, type ReportDayStatus } from '../services/reportService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { orderService } from '../services/orderService';
import { customerService } from '../services/customerService';
import { notificationService } from '../services/notificationService';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { shareCustomerStatement } from '../services/customerStatementShare';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import type { CustomerStatementData, OverdueCustomerRecord } from '../services/customerService';
import type { CatalogItemRecord, NotificationRecord, OrderRecord, ShiftRecord, StoreRecord, UserSummary } from '../types/domain';

type Period = 'day' | 'week' | 'month' | 'year';

const periodLabels: Record<Period, TranslationKey> = {
  day: 'owner.today',
  week: 'owner.week',
  month: 'owner.month',
  year: 'owner.year',
};

type DashboardSummary = Awaited<ReturnType<typeof reportService.getDashboard>>;

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
  cashOuts: [],
  firstTicketNumber: undefined,
  lastTicketNumber: undefined,
  cashInMillimes: 0,
  cashOutMillimes: 0,
  cashMovements: [],
  employeeBreakdown: [],
  customerTabs: [],
  tabsIssuedMillimes: 0,
  tabsSettledMillimes: 0,
};

function OwnerDashboardContent() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [period, setPeriod] = useState<Period>('day');
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });
  const [runningShifts, setRunningShifts] = useState<ShiftRecord[]>([]);
  const [periodOrders, setPeriodOrders] = useState<OrderRecord[]>([]);
  const [todaySalesMillimes, setTodaySalesMillimes] = useState(0);
  const [lastWeekSalesMillimes, setLastWeekSalesMillimes] = useState(0);
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [pendingVoidOrders, setPendingVoidOrders] = useState<OrderRecord[]>([]);
  const [overdueCustomers, setOverdueCustomers] = useState<OverdueCustomerRecord[]>([]);
  const [ownerNotifications, setOwnerNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [overdueStatement, setOverdueStatement] = useState<CustomerStatementData | null>(null);
  const [overdueAction, setOverdueAction] = useState<{ customerId: string; action: 'statement' | 'share' } | null>(null);
  const [overdueActionError, setOverdueActionError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      setLoading(true);
      setLoadError('');
      try {
        const [nextSummary, allOrders, allUsers, nextStore, nextOverdueCustomers, nextCatalogItems, nextDayStatus, nextOpenShifts] = await Promise.all([
        reportService.getDashboard(storeId, period),
        orderService.listAll(storeId),
        userService.listUsers(storeId),
        userService.getStore(storeId),
        customerService.listOverdueCustomers(storeId),
        catalogService.listItems(storeId),
        reportService.getDayStatus(storeId),
        shiftService.listOpenShifts(storeId),
        ]);
        if (!active) return;
        setSummary(nextSummary);
        setDayStatus(nextDayStatus);
        setRunningShifts(nextOpenShifts);
        setPeriodOrders(filterOrdersForPeriod(allOrders, period));
        const salesComparison = getTodaySalesComparison(allOrders);
        setTodaySalesMillimes(salesComparison.today);
        setLastWeekSalesMillimes(salesComparison.lastWeek);
        setStaff(allUsers.filter((member) => member.role === 'staff'));
        setCatalogItems(nextCatalogItems);
        setPendingVoidOrders(allOrders.filter((order) => order.status === 'pending_void'));
        setStore(nextStore);
        setOverdueCustomers(nextOverdueCustomers);

        if (user?.role === 'owner') {
          await notificationService.checkOverdueCustomers(storeId, user.id);
          const notifications = await notificationService.listFor(user);
          if (active) {
            setOwnerNotifications(notifications.filter((notification) =>
              notification.type === 'customer_overdue' || notification.type === 'stock_depleted' ||
              notification.type === 'item_86' || notification.type === 'low_stock' ||
              notification.type === 'cash_out_alert' || notification.type === 'cash_difference' ||
              notification.type === 'void_requested' || notification.type === 'subscription_expiring',
            ));
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDashboard().catch((loadError: unknown) => {
      console.error('Unable to load owner dashboard.', loadError);
      if (active) setLoadError('Unable to load dashboard information. Please try again.');
    });
    const refresh = () => {
      void loadDashboard().catch((loadError: unknown) => {
        console.error('Unable to refresh owner dashboard after a live update.', loadError);
        if (active) setLoadError('Unable to refresh dashboard information. Please try again.');
      });
    };
    window.addEventListener('focus', refresh);
    const unsubscribe = subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications', 'catalog_items'], refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, [period, storeId, user]);

  async function openOverdueStatement(customer: OverdueCustomerRecord['customer']) {
    setOverdueAction({ customerId: customer.id, action: 'statement' });
    setOverdueActionError('');
    try {
      setOverdueStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (statementError) {
      console.error('Unable to load the customer statement.', statementError);
      setOverdueActionError('Unable to load the customer statement. Please try again.');
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
        setOverdueActionError(shareError instanceof Error ? shareError.message : 'Unable to share the customer statement.');
      }
    } finally {
      setOverdueAction(null);
    }
  }

  async function selectPeriod(nextPeriod: Period) {
    try {
      const [nextSummary, allOrders] = await Promise.all([
        reportService.getDashboard(storeId, nextPeriod),
        orderService.listAll(storeId),
      ]);
      setSummary(nextSummary);
      setPeriodOrders(filterOrdersForPeriod(allOrders, nextPeriod));
      setPendingVoidOrders(allOrders.filter((order) => order.status === 'pending_void'));
      setPeriod(nextPeriod);
      setOverdueActionError('');
    } catch (loadError) {
      console.error('Unable to load the selected dashboard period.', loadError);
      setOverdueActionError('Unable to load the selected period. Please try again.');
    }
  }

  const itemSales = new Map((summary.itemsSold ?? []).map((item) => [item.itemId, item]));
  const rankedItems = catalogItems.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: itemSales.get(item.id)?.quantity ?? 0,
    totalMillimes: itemSales.get(item.id)?.totalMillimes ?? 0,
  })).sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name));
  const bestSellers = rankedItems.filter((item) => item.quantity > 0).slice(0, 5);
  const bestSellerIds = new Set(bestSellers.map((item) => item.id));
  const slowSellers = rankedItems
    .filter((item) => !bestSellerIds.has(item.id))
    .sort((left, right) => left.quantity - right.quantity || left.name.localeCompare(right.name))
    .slice(0, 5);
  const lowStockItems = catalogItems.filter((item) =>
    item.stockCount !== null && item.stockCount <= (item.lowStockThreshold ?? 5),
  ).sort((left, right) => (left.stockCount ?? 0) - (right.stockCount ?? 0));
  const openShifts = summary.shifts.filter((shift) => shift.status === 'open');
  const currentlyWorking = openShifts.filter((shift, index, all) =>
    all.findIndex((candidate) => candidate.staffId === shift.staffId) === index,
  );
  const salesByStaff = useMemo(() => {
    const totals = new Map<string, { name: string; sales: number; orders: number }>();
    for (const order of periodOrders.filter((candidate) => candidate.status === 'done')) {
      const name = staff.find((member) => member.id === order.staffId)?.name ?? order.staffName ?? 'Staff';
      const current = totals.get(order.staffId) ?? { name, sales: 0, orders: 0 };
      current.sales += order.totalMillimes / 1000;
      current.orders += 1;
      totals.set(order.staffId, current);
    }
    return [...totals.values()].sort((a, b) => b.sales - a.sales);
  }, [periodOrders, staff]);
  const salesByDate = useMemo(() => {
    const totals = new Map<string, number>();
    for (const order of periodOrders) {
      if (order.status !== 'done') continue;
      const date = new Date(order.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      totals.set(key, (totals.get(key) ?? 0) + order.totalMillimes / 1000);
    }
    return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([date, sales]) => ({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      sales,
    }));
  }, [periodOrders]);
  const recentOrders = periodOrders.slice(0, 6);
  const peakHours = useMemo(() => getOrdersPerHour(periodOrders), [periodOrders]);
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
    <article className={`dashboard-target-card rounded-2xl bg-surface-container-lowest p-5 shadow-card ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.salesTarget')}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">
            Today · {formatTnd(todaySalesMillimes / 1000)} DT
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
    ? `Day open - ${dayStatus.openShiftCount} ${dayStatus.openShiftCount === 1 ? 'shift' : 'shifts'} running: ${runningShifts.map((shift) =>
      shift.staffId === user?.id ? user?.name ?? 'Owner' : staff.find((member) => member.id === shift.staffId)?.name ?? 'Staff',
    ).join(', ')}`
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
    (dayStatus.openShiftCount > 0 ? 'Close every open shift before creating a Z report.' : '');

  return (
    <>
    <WorkspaceLayout title={t('owner.dashboard')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <PageHeader title={t('owner.dashboard')} subtitle={store?.name} actions={
        <div className="dashboard-period-switcher flex gap-1 rounded-xl bg-surface-container-high p-1">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} type="button" onClick={() => selectPeriod(value)} className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${period === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}>
              {t(periodLabels[value])}
            </button>
          ))}
        </div>
      } />
      <p role="status" className={`mb-4 rounded-xl p-3 font-body text-body-sm ${dayStatus.dayIsClosed ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-low text-on-surface-variant'}`}>
        {dayStatusMessage}
      </p>

      {renderTargetCard('lg:hidden')}

      <StatGrid className="owner-kpi-grid mt-4">
        <SummaryCard icon="payments" label={`${t('finance.sales')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.salesCollectedMillimes / 1000)} DT`} tone="primary" />
        <SummaryCard icon="request_quote" label={`${t('finance.expenses')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.expensesMillimes / 1000)} DT`} tone="warning" />
        <SummaryCard icon="account_balance" label={`${t('finance.netProfit')} · ${t(periodLabels[period])}`} value={`${formatTnd(summary.netProfitMillimes / 1000)} DT`} tone={summary.netProfitMillimes < 0 ? 'error' : 'success'} />
        <SummaryCard icon="account_balance_wallet" label={t('finance.receivable')} value={`${formatTnd(summary.receivableMillimes / 1000)} DT`} tone="warning" />
        <SummaryCard icon="receipt_long" label={`Orders · ${t(periodLabels[period])}`} value={String(summary.orderCount)} tone="success" />
        <SummaryCard icon="price_change" label={`${t('owner.cashDifferences')} · ${t(periodLabels[period])}`} value={formatSignedAmount(summary.cashDifferenceMillimes)} tone={summary.cashDifferenceMillimes === 0 ? 'success' : 'warning'} />
      </StatGrid>

      <CardGrid className="owner-alert-grid mobile-card-list mobile-gap-3 mt-4">
        <button type="button" onClick={() => navigate('/owner/voids')} className="w-full rounded-2xl bg-surface-container-lowest p-5 text-left shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-headline-md text-on-surface">{t('owner.pendingVoidRequests')}</h2>
            <strong className="font-display text-headline-md tabular-nums text-error-dark">{pendingVoidOrders.length}</strong>
          </div>
          {pendingVoidOrders.length > 0 ? (
            <p className="mt-2 font-body text-body-sm text-on-surface-variant">
              {pendingVoidOrders.slice(0, 3).map((order) => `#${order.number}`).join(' · ')}
            </p>
          ) : <p className="mt-2 font-body text-body-sm text-on-surface-variant">No requests awaiting review.</p>}
        </button>

        <button type="button" onClick={() => navigate('/owner/inventory')} className="w-full rounded-2xl bg-surface-container-lowest p-5 text-left shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-headline-md text-on-surface">{t('owner.lowStockItems')}</h2>
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
          ) : <p className="mt-2 font-body text-body-sm text-on-surface-variant">No items below their stock thresholds.</p>}
        </button>

        <article className="rounded-2xl bg-surface-container-lowest p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-headline-md text-on-surface">{t('owner.staffOnShift')}</h2>
            <strong className="font-display text-headline-md tabular-nums text-primary">{currentlyWorking.length}</strong>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {currentlyWorking.map((shift) => (
              <p key={shift.id} className="flex justify-between gap-3 font-body text-body-sm text-on-surface-variant">
                <span>{staff.find((member) => member.id === shift.staffId)?.name ?? 'Staff'}</span>
                <span className="shrink-0">{new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </p>
            ))}
            {currentlyWorking.length === 0 && <p className="font-body text-body-sm text-on-surface-variant">{t('owner.noStaffOnShift')}</p>}
          </div>
        </article>
      </CardGrid>

      {ownerNotifications.length > 0 && (
        <section aria-label="Owner notifications" className="mt-4 flex flex-col gap-2">
          {ownerNotifications.slice(0, 5).map((notification) => (
            <p key={notification.id} role="status" className={`rounded-xl p-3 font-body text-body-sm ${notification.type === 'stock_depleted' || notification.type === 'low_stock' || notification.type === 'cash_out_alert' ? 'bg-warning-container text-on-warning-container' : 'bg-error-container text-on-error-container'}`}>
              <strong>{notification.title}:</strong> {notification.body}
            </p>
          ))}
        </section>
      )}

      <section aria-label={t('owner.overdueTabs')} className="mt-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface">
              <MaterialIcon name="event_busy" className="text-error-dark" />{t('owner.overdueTabs')}
            </h2>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {overdueCustomers.length} customer{overdueCustomers.length === 1 ? '' : 's'} past their settlement due date
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/customers?filter=overdue')}>
            View all
          </Button>
        </div>
          {loadError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{loadError}</p>}
          {overdueActionError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{overdueActionError}</p>}
          {loading && <ListSkeleton rows={3} label="Loading dashboard lists" />}
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
          {overdueCustomers.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">No overdue customer accounts.</p>}
        </CardGrid>
        <p className="mt-3 font-body text-body-xs text-on-surface-variant">Share opens your device or browser share sheet. No message is sent automatically.</p>
      </section>

      <section className="owner-chart-grid mobile-gap-3 mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {renderTargetCard('hidden lg:block dashboard-target-card--desktop')}

        <article className="dashboard-peak-chart rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.peakHours')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Completed orders by hour of day.</p>
          <div className="mt-3 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="#E1ECEE" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} tickFormatter={formatHour} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(hour) => formatHour(Number(hour))} />
                <Bar dataKey="orders" name="Orders" fill="#0F5F6E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="dashboard-sales-chart rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">Sales over time · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Completed order sales by day.</p>
          {salesByDate.length ? (
            <div className="mt-3 h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByDate} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#E1ECEE" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis width={48} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value) => [`${formatTnd(Number(value))} DT`, 'Sales']} />
                  <Bar dataKey="sales" name="Sales" fill="#0F5F6E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>

        <article className="dashboard-list-card rounded-2xl bg-surface-container-lowest p-5 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.bestSellers')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Completed product sales for the selected period.</p>
          {bestSellers.length ? (
            <ItemRankingList items={bestSellers} />
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('owner.noItemsSold')}</p>}
        </article>

        <article className="dashboard-list-card rounded-2xl bg-surface-container-lowest p-5 shadow-card">
          <h2 className="font-display text-headline-md text-on-surface">{t('owner.slowSellers')} · {t(periodLabels[period])}</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Products with the fewest completed sales, including unsold items.</p>
          {slowSellers.length ? (
            <ItemRankingList items={slowSellers} />
          ) : <p className="mt-3 rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('owner.noItemsSold')}</p>}
        </article>

        <article className="dashboard-staff-chart rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="group" className="text-primary" />Sales by staff member · {t(periodLabels[period])}</h2>
          {salesByStaff.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByStaff} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#E1ECEE" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${formatTnd(Number(value))} DT`, 'Sales']} />
                  <Bar dataKey="sales" name="Sales" fill="#2E7D6A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>
      </section>

      <CardGrid className="mobile-gap-3 mt-4">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="receipt_long" className="text-primary" />Recent orders</h2>
          <div className="flex flex-col gap-2">
            {recentOrders.map((order) => {
              const staffName = staff.find((member) => member.id === order.staffId)?.name ?? order.staffName ?? 'Staff';
              return (
                <button key={order.id} type="button" onClick={() => navigate('/orders')} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 text-left">
                  <div className="min-w-0">
                    <p className="font-body text-label-md text-on-surface">#{order.number} <span className="ml-1 text-on-surface-variant">• {staffName}</span></p>
                    <p className="mt-1 truncate font-body text-body-sm text-outline">{new Date(order.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-label-lg tabular-nums text-on-surface">{formatTnd(order.totalMillimes / 1000)} DT</p>
                    <StatusTag status={order.status === 'done' ? 'done' : order.status === 'pending_void' ? 'pending' : 'voided'}>{order.status === 'done' ? 'Completed' : order.status === 'pending_void' ? 'Pending void' : 'Voided'}</StatusTag>
                  </div>
                </button>
              );
            })}
            {recentOrders.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </article>

        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="schedule" className="text-primary" />Shift overview</h2>
            <div className="flex gap-2">
              <Button disabled={Boolean(reportDisabledReason)} variant="secondary" onClick={() => navigate('/owner/shifts?tab=reports')}><MaterialIcon name="summarize" />X report</Button>
              <Button disabled={Boolean(zDisabledReason)} variant="secondary" onClick={() => navigate('/owner/shifts?tab=reports')}><MaterialIcon name="lock" />Z report</Button>
            </div>
          </div>
          {(reportDisabledReason || zDisabledReason) && (
            <p className="mb-3 font-body text-body-sm text-outline">{reportDisabledReason || zDisabledReason}</p>
          )}
          <div className="flex flex-col gap-2">
            {summary.shifts.map((shift) => <ShiftSummary key={shift.id} shift={shift} />)}
            {summary.shifts.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </article>
      </CardGrid>

      <section className="mt-4">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">Quick access</h2>
        <CardGrid columns={4} className="mobile-gap-3">
          {[
            { label: 'Orders', icon: 'receipt_long', to: '/orders' },
            { label: 'Staff', icon: 'groups', to: '/owner/staff' },
            { label: 'Products', icon: 'inventory_2', to: '/owner/catalog' },
            { label: 'Inventory', icon: 'inventory', to: '/owner/inventory' },
            { label: 'Reports', icon: 'analytics', to: '/owner/reports' },
          ].map((item) => (
            <button key={item.label} type="button" onClick={() => navigate(item.to)} className="flex min-h-24 w-full items-center gap-3 rounded-2xl bg-surface-container-lowest p-5 text-left shadow-card">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name={item.icon} /></span>
              <span className="font-body text-label-lg text-on-surface">{item.label}</span>
            </button>
          ))}
        </CardGrid>
      </section>
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

function SummaryCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'primary' | 'success' | 'warning' | 'error' }) {
  const tones = {
    primary: 'bg-primary-fixed/40 text-primary',
    success: 'bg-success-container text-on-success-container',
    warning: 'bg-warning-container text-on-warning-container',
    error: 'bg-error-container text-on-error-container',
  };
  return (
    <article className="stat-card relative flex h-full min-w-0 flex-col rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><MaterialIcon name={icon} className="text-lg" /></span>
      <p className="mt-3 flex items-center gap-1 font-body text-body-sm text-on-surface-variant">
        {label}
        {label.startsWith('Sales') && <span className="sales-help-tooltip">
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

function ShiftSummary({ shift }: { shift: ShiftRecord }) {
  const [staffName, setStaffName] = useState('Staff');
  useEffect(() => {
    void userService.getUser(shift.staffId).then((staff) => setStaffName(staff?.name ?? 'Staff'));
  }, [shift.staffId]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3">
      <div>
        <p className="font-body text-label-md text-on-surface">{staffName}</p>
        <p className="mt-1 font-body text-body-sm text-outline">{new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="text-right">
        <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
        {shift.differenceMillimes !== undefined && <p className="mt-1 font-body text-label-sm tabular-nums text-on-surface-variant">{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
      </div>
    </div>
  );
}

function getTodaySalesComparison(orders: OrderRecord[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = Date.now();
  const previousWeekStart = new Date(todayStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const previousWeekEnd = new Date(previousWeekStart);
  previousWeekEnd.setDate(previousWeekEnd.getDate() + 1);
  const salesBetween = (start: number, end: number) => orders
    .filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return order.status === 'done' && timestamp >= start && timestamp < end;
    })
    .reduce((sum, order) => sum + order.totalMillimes, 0);
  return {
    today: salesBetween(todayStart.getTime(), todayEnd),
    lastWeek: salesBetween(previousWeekStart.getTime(), previousWeekEnd.getTime()),
  };
}

function getOrdersPerHour(orders: OrderRecord[]) {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const order of orders) {
    if (order.status === 'done') counts[new Date(order.createdAt).getHours()] += 1;
  }
  return counts.map((count, hour) => ({ hour, orders: count }));
}

function formatHour(hour: number) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const clockHour = hour % 12 || 12;
  return `${clockHour} ${suffix}`;
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

function filterOrdersForPeriod(orders: OrderRecord[], period: Period) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  const end = Date.now();
  return orders
    .filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return timestamp >= start.getTime() && timestamp <= end;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function OwnerDashboardScreen() {
  return <OwnerDashboardContent />;
}
