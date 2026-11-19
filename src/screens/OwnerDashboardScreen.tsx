import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { MaterialIcon } from '../components/MaterialIcon';
import { Button } from '../components/Button';
import { OverdueCustomerRow } from '../components/OverdueCustomerRow';
import { StatusTag } from '../components/StatusTag';
import { TabStatementView } from '../components/TabStatementView';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t, type TranslationKey } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService } from '../services/reportService';
import { userService } from '../services/userService';
import { orderService } from '../services/orderService';
import { customerService } from '../services/customerService';
import { notificationService } from '../services/notificationService';
import { shareCustomerStatement } from '../services/customerStatementShare';
import { useAuthStore } from '../stores/authStore';
import type { CustomerStatementData, OverdueCustomerRecord } from '../services/customerService';
import type { NotificationRecord, OrderRecord, ShiftRecord, StoreRecord, UserSummary } from '../types/domain';

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
  orderCount: 0,
  cashDifferenceMillimes: 0,
  topItems: {},
  shifts: [],
  tabsOutstandingMillimes: 0,
  salesByCategory: [],
  itemsSold: [],
  voids: { count: 0, totalMillimes: 0, orders: [] },
  comps: { count: 0, quantity: 0, totalMillimes: 0, records: [] },
  shiftLines: [],
  paymentSplit: { cash: 0, card: 0, other: 0, tab: 0 },
  totalExpectedCashMillimes: 0,
  totalCountedMillimes: 0,
  totalDifferenceMillimes: 0,
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
  const [todaySummary, setTodaySummary] = useState<DashboardSummary>(emptySummary);
  const [periodOrders, setPeriodOrders] = useState<OrderRecord[]>([]);
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [overdueCustomers, setOverdueCustomers] = useState<OverdueCustomerRecord[]>([]);
  const [ownerNotifications, setOwnerNotifications] = useState<NotificationRecord[]>([]);
  const [overdueStatement, setOverdueStatement] = useState<CustomerStatementData | null>(null);
  const [overdueAction, setOverdueAction] = useState<{ customerId: string; action: 'statement' | 'share' } | null>(null);
  const [overdueActionError, setOverdueActionError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      const [nextSummary, allOrders, allUsers, nextStore, nextOverdueCustomers] = await Promise.all([
        reportService.getDashboard(storeId, 'day'),
        orderService.listAll(storeId),
        userService.listUsers(storeId),
        userService.getStore(storeId),
        customerService.listOverdueCustomers(storeId),
      ]);
      if (!active) return;
      setSummary(nextSummary);
      setTodaySummary(nextSummary);
      setPeriodOrders(filterOrdersForPeriod(allOrders, 'day'));
      setStaff(allUsers.filter((member) => member.role === 'staff'));
      setStore(nextStore);
      setOverdueCustomers(nextOverdueCustomers);

      if (user?.role === 'owner') {
        await notificationService.checkOverdueCustomers(storeId, user.id);
        const notifications = await notificationService.listForStaff(storeId, user.id);
        if (active) {
          setOwnerNotifications(notifications.filter((notification) =>
            notification.type === 'customer_overdue' || notification.type === 'stock_depleted' || notification.type === 'cash_out_alert',
          ));
        }
      }
    }
    void loadDashboard().catch((loadError: unknown) => {
      console.error('Unable to load owner dashboard.', loadError);
      if (active) setOverdueActionError('Unable to load overdue customer information.');
    });
    return () => {
      active = false;
    };
  }, [storeId, user?.id, user?.role]);

  async function openOverdueStatement(customer: OverdueCustomerRecord['customer']) {
    setOverdueAction({ customerId: customer.id, action: 'statement' });
    setOverdueActionError('');
    try {
      setOverdueStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (statementError) {
      setOverdueActionError(statementError instanceof Error ? statementError.message : 'Unable to load the customer statement.');
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
    setPeriod(nextPeriod);
    const [nextSummary, allOrders] = await Promise.all([
      reportService.getDashboard(storeId, nextPeriod),
      orderService.listAll(storeId),
    ]);
    setSummary(nextSummary);
    setPeriodOrders(filterOrdersForPeriod(allOrders, nextPeriod));
  }

  const topItems = summary.itemsSold?.length
    ? summary.itemsSold
      .map((item) => ({ name: item.name, quantity: item.quantity, sales: item.totalMillimes / 1000 }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
    : Object.entries(summary.topItems)
      .map(([name, quantity]) => ({ name, quantity, sales: 0 }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  const closedShifts = summary.shifts.filter((shift) => shift.status === 'closed');
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
  const recentOrders = periodOrders.slice(0, 6);
  const todayKey = toBusinessDate(new Date());
  const dayClosed = store?.dayClosedOn === todayKey && openShifts.length === 0;

  return (
    <>
    <WorkspaceLayout title={t('owner.dashboard')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('owner.dashboard')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-container-high p-1">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} type="button" onClick={() => selectPeriod(value)} className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${period === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}>
              {t(periodLabels[value])}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard icon="payments" label="Today's sales" value={`${formatTnd(todaySummary.salesMillimes / 1000)} DT`} tone="primary" />
        <SummaryCard icon="receipt_long" label="Today's orders" value={String(todaySummary.orderCount)} tone="success" />
        <SummaryCard icon="groups" label="Currently working staff" value={String(currentlyWorking.length)} tone="primary" />
        <SummaryCard icon="schedule" label="Open shifts" value={String(openShifts.length)} tone="warning" />
        <SummaryCard icon="lock_clock" label="Closed shifts" value={String(closedShifts.length)} tone="success" />
        <SummaryCard icon={dayClosed ? 'lock' : 'storefront'} label="Business day" value={dayClosed ? 'Closed' : openShifts.length ? 'Open' : 'No open shift'} tone={dayClosed ? 'error' : openShifts.length ? 'success' : 'warning'} />
      </section>

      {ownerNotifications.length > 0 && (
        <section aria-label="Owner notifications" className="mt-4 flex flex-col gap-2">
          {ownerNotifications.slice(0, 5).map((notification) => (
            <p key={notification.id} role="status" className={`rounded-xl p-3 font-body text-body-sm ${notification.type === 'stock_depleted' || notification.type === 'cash_out_alert' ? 'bg-warning-container text-on-warning-container' : 'bg-error-container text-on-error-container'}`}>
              <strong>{notification.title}:</strong> {notification.message}
            </p>
          ))}
        </section>
      )}

      <section aria-label="Overdue customers" className="mt-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface">
              <MaterialIcon name="event_busy" className="text-error-dark" />Overdue customers
            </h2>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {overdueCustomers.length} customer{overdueCustomers.length === 1 ? '' : 's'} past their settlement due date
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/customers?filter=overdue')}>
            View all
          </Button>
        </div>
        {overdueActionError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{overdueActionError}</p>}
        <div className="flex flex-col gap-2">
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
        </div>
        <p className="mt-3 font-body text-body-xs text-on-surface-variant">Share opens your device or browser share sheet. No message is sent automatically.</p>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="trending_up" className="text-primary" />Best-selling products</h2>
          <p className="mb-3 font-body text-body-sm text-on-surface-variant">Based on completed orders for the selected period</p>
          {topItems.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#E1ECEE" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" name="Units sold" fill="#0F5F6E" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>

        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="group" className="text-primary" />Sales by staff member</h2>
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

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
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
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="schedule" className="text-primary" />Shift overview</h2>
          <div className="flex flex-col gap-2">
            {summary.shifts.map((shift) => <ShiftSummary key={shift.id} shift={shift} />)}
            {summary.shifts.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </article>
      </section>

      <section className="mt-4">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">Quick access</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {[
            { label: 'Orders', icon: 'receipt_long', to: '/orders' },
            { label: 'Staff', icon: 'groups', to: '/owner/staff' },
            { label: 'Products', icon: 'inventory_2', to: '/owner/catalog' },
            { label: 'Inventory', icon: 'inventory', to: '/owner/inventory' },
            { label: 'Reports', icon: 'analytics', to: '/owner/reports' },
          ].map((item) => (
            <button key={item.label} type="button" onClick={() => navigate(item.to)} className="flex min-h-24 items-center gap-3 rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name={item.icon} /></span>
              <span className="font-body text-label-lg text-on-surface">{item.label}</span>
            </button>
          ))}
        </div>
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
    <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><MaterialIcon name={icon} /></span>
      <p className="mt-3 font-body text-body-sm text-on-surface-variant">{label}</p>
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

function toBusinessDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function filterOrdersForPeriod(orders: OrderRecord[], period: Period) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  return orders
    .filter((order) => new Date(order.createdAt).getTime() >= start.getTime())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function OwnerDashboardScreen() {
  return <OwnerDashboardContent />;
}
