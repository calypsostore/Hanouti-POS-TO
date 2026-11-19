import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { CardGrid, PageContainer } from '../components/layout';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { TopBar } from '../components/TopBar';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { OrderRecord, ShiftRecord, StoreRecord } from '../types/domain';

export function StaffDashboardScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [openShift, setOpenShift] = useState<ShiftRecord>();
  const [latestShift, setLatestShift] = useState<ShiftRecord>();
  const [cashSales, setCashSales] = useState(0);
  const [expectedCash, setExpectedCash] = useState(0);
  const [todayOrders, setTodayOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalSales, setPersonalSales] = useState(0);
  const [canTakeOrders, setCanTakeOrders] = useState(false);
  const [canManageShift, setCanManageShift] = useState(false);
  const [canViewHistory, setCanViewHistory] = useState(false);
  const [canRequestVoid, setCanRequestVoid] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [nextStore, nextOpenShift, shifts, orders, sales, permissions] = await Promise.all([
        userService.getStore(storeId),
        shiftService.getOpenShiftForUser(storeId, user.id),
        shiftService.listShifts(storeId),
        orderService.listToday(storeId, user.id),
        orderService.getTotalForToday(storeId, user.id),
        Promise.all([
          userService.hasPermission(user.id, 'take_orders'),
          userService.hasPermission(user.id, 'open_close_shift'),
          userService.hasPermission(user.id, 'view_order_history'),
          userService.hasPermission(user.id, 'request_void'),
        ]),
      ]);
      setStore(nextStore);
      setOpenShift(nextOpenShift);
      setLatestShift(shifts.find((shift) => shift.staffId === user.id));
      setTodayOrders(orders);
      setPersonalSales(sales);
      setCanTakeOrders(permissions[0]);
      setCanManageShift(permissions[1]);
      setCanViewHistory(permissions[2]);
      setCanRequestVoid(permissions[3]);
      setError('');
      if (nextOpenShift) {
        const [cashReceived, cashExpected] = await Promise.all([
          orderService.getCashSalesForShift(nextOpenShift.id),
          shiftService.getExpectedCash(nextOpenShift.id),
        ]);
        setCashSales(cashReceived);
        setExpectedCash(cashExpected);
      } else {
        setCashSales(0);
        setExpectedCash(0);
      }
    } catch (loadError) {
      console.error('Unable to load staff dashboard.', loadError);
      setError('Unable to load your dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, onFocus);
    };
  }, [refresh]);

  const completedOrders = todayOrders.filter((order) => order.status === 'done');
  const pendingVoidOrders = todayOrders.filter((order) => order.status === 'pending_void');
  const recentOrders = todayOrders.filter((order) => order.status === 'done').slice(0, 5);
  const displayedSales = canTakeOrders || canViewHistory ? personalSales : null;
  const shiftSummary = openShift ?? latestShift;
  const dateLabel = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  return (
    <div className="min-h-screen bg-surface pb-24">
      <TopBar title="Staff dashboard" storeName={store?.name} onProfileClick={() => navigate('/profile')} />
      <main className="mx-auto w-full p-0">
        <PageContainer className="staff-dashboard-container">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-body text-label-md text-primary">Welcome back</p>
            <h1 className="mt-1 font-display text-headline-lg text-on-surface">{user?.name}</h1>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">{dateLabel}</p>
          </div>
          <StatusTag status={openShift ? 'open' : 'closed'}>{`Shift ${openShift ? 'Open' : 'Closed'}`}</StatusTag>
        </header>

        {error && <p role="alert" className="mb-4 rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

        {canManageShift && (
          <CardGrid className="mb-4 mobile-gap-3">
            {openShift ? (
              <button type="button" onClick={() => navigate('/shift')} className="flex min-h-24 items-center gap-3 rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-container text-error-dark"><MaterialIcon name="lock" /></span>
                <div>
                  <p className="font-display text-headline-sm text-on-surface">Close shift</p>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">Count cash and finish your shift</p>
                </div>
              </button>
            ) : (
              <button type="button" onClick={() => navigate('/shift')} className="flex min-h-24 items-center gap-3 rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name="lock_open" /></span>
                <div>
                  <p className="font-display text-headline-sm text-on-surface">Open shift</p>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">Enter the starting cash amount</p>
                </div>
              </button>
            )}
            {canTakeOrders && (
              <button type="button" onClick={() => navigate('/pos')} className="flex min-h-24 items-center gap-3 rounded-2xl bg-primary p-4 text-left text-on-primary shadow-card transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><MaterialIcon name="point_of_sale" /></span>
                <div>
                  <p className="font-display text-headline-sm">Open POS</p>
                  <p className="mt-1 font-body text-body-sm text-on-primary/80">Take a new counter order</p>
                </div>
              </button>
            )}
          </CardGrid>
        )}

        {canTakeOrders && !canManageShift && (
          <section className="mb-4">
            <button type="button" onClick={() => navigate('/pos')} className="flex min-h-24 w-full items-center gap-3 rounded-2xl bg-primary p-4 text-left text-on-primary shadow-card transition active:scale-[0.99]">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><MaterialIcon name="point_of_sale" /></span>
              <div>
                <p className="font-display text-headline-sm">Open POS</p>
                <p className="mt-1 font-body text-body-sm text-on-primary/80">Take a new counter order</p>
              </div>
            </button>
          </section>
        )}

        {displayedSales !== null && (
          <CardGrid className="mb-4 mobile-gap-3">
            <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fixed/40 text-primary"><MaterialIcon name="payments" /></span>
              <p className="mt-3 font-body text-body-sm text-on-surface-variant">Today's personal sales</p>
              <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{formatTnd(displayedSales / 1000)} DT</p>
            </article>
            <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-container text-on-success-container"><MaterialIcon name="receipt_long" /></span>
              <p className="mt-3 font-body text-body-sm text-on-surface-variant">Completed orders today</p>
              <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{completedOrders.length}</p>
            </article>
          </CardGrid>
        )}

        {canManageShift && shiftSummary && (
          <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-body text-label-sm uppercase text-outline">Personal shift summary</p>
                <h2 className="mt-1 font-display text-headline-md text-on-surface">
                  {openShift ? 'Current shift' : 'Latest shift'}
                </h2>
              </div>
              <StatusTag status={shiftSummary.status}>{shiftSummary.status === 'open' ? 'Open' : 'Closed'}</StatusTag>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Starting cash" value={shiftSummary.startingCashMillimes} />
              {openShift ? (
                <>
                  <Metric label="Cash sales + tab payments" value={cashSales} />
                  <Metric label="Expected cash" value={expectedCash} accent />
                </>
              ) : (
                <>
                  <Metric label="Counted cash" value={shiftSummary.countedCashMillimes ?? 0} />
                  <Metric label="Difference" value={shiftSummary.differenceMillimes ?? 0} accent />
                </>
              )}
            </div>
          </section>
        )}

        {canRequestVoid && pendingVoidOrders.length > 0 && (
          <section className="mb-4 rounded-2xl border border-warning-container bg-warning-container p-4">
            <div className="flex items-start gap-3">
              <MaterialIcon name="notifications_active" className="mt-0.5 text-secondary" />
              <div>
                <h2 className="font-display text-headline-sm text-on-warning-container">Pending actions</h2>
                <p className="mt-1 font-body text-body-sm text-on-warning-container">
                  {pendingVoidOrders.length} void request{pendingVoidOrders.length === 1 ? '' : 's'} awaiting owner review.
                </p>
              </div>
            </div>
          </section>
        )}

        {canViewHistory && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-headline-md text-on-surface">Recent orders</h2>
              <Button variant="secondary" className="min-h-10 px-3" onClick={() => navigate('/orders')}>
                View all
                <MaterialIcon name="arrow_forward" className="text-lg" />
              </Button>
            </div>
            {loading ? <ListSkeleton rows={2} label="Loading recent orders" /> : recentOrders.length > 0 ? (
              <CardGrid className="mobile-gap-2">
                {recentOrders.map((order) => (
                  <button key={order.id} type="button" onClick={() => navigate('/orders')} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 text-left shadow-card">
                    <div className="min-w-0">
                      <p className="font-display text-title-md text-on-surface">#{order.number}</p>
                      <p className="mt-1 truncate font-body text-body-sm text-on-surface-variant">
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-title-md tabular-nums text-primary">{formatTnd(order.totalMillimes / 1000)} DT</p>
                  </button>
                ))}
              </CardGrid>
            ) : (
              <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">No completed orders today.</p>
            )}
          </section>
        )}
        </PageContainer>
      </main>
      <BottomNav />
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-3">
      <p className="font-body text-body-sm text-on-surface-variant">{label}</p>
      <p className={`mt-1 font-display text-title-md tabular-nums ${accent ? 'text-primary' : 'text-on-surface'}`}>
        {formatTnd(value / 1000)} DT
      </p>
    </div>
  );
}
