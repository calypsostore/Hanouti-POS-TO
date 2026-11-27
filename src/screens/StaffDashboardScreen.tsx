import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { CardGrid, PageContainer } from '../components/layout';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { TopBar } from '../components/TopBar';
import { getLanguage } from '../i18n';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { resolveStoreSettings, type OrderRecord, type ShiftRecord, type StoreRecord } from '../types/domain';

export function StaffDashboardScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const refreshPermissions = useAuthStore((state) => state.refreshPermissions);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [openShift, setOpenShift] = useState<ShiftRecord>();
  const [latestShift, setLatestShift] = useState<ShiftRecord>();
  const [cashSales, setCashSales] = useState(0);
  const [expectedCash, setExpectedCash] = useState<number | null>(null);
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
      const permissions = await Promise.all([
        userService.hasPermission(user.id, 'take_orders'),
        userService.hasPermission(user.id, 'open_close_shift'),
        userService.hasPermission(user.id, 'view_order_history'),
        userService.hasPermission(user.id, 'request_void'),
        userService.hasPermission(user.id, 'view_own_hours'),
        userService.hasPermission(user.id, 'print_x_report'),
        userService.hasPermission(user.id, 'cash_in_out'),
        userService.hasPermission(user.id, 'settle_tabs'),
      ]);
      const canReadOwnShift = permissions[0] || permissions[1] || permissions[4]
        || permissions[5] || permissions[6] || permissions[7];
      const [nextStore, nextOpenShift, shifts, orders, sales] = await Promise.all([
        userService.getStore(storeId),
        canReadOwnShift ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
        canReadOwnShift ? shiftService.listShifts(storeId) : Promise.resolve([]),
        orderService.listToday(storeId, user.id),
        orderService.getTotalForToday(storeId, user.id),
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
      if (nextOpenShift && permissions[1]) {
        const [cashReceived, cashExpected] = await Promise.all([
          orderService.getCashSalesForShift(nextOpenShift.id),
          shiftService.getExpectedCash(nextOpenShift.id),
        ]);
        setCashSales(cashReceived);
        setExpectedCash(cashExpected);
      } else {
        setCashSales(0);
        setExpectedCash(null);
      }
    } catch (loadError) {
      console.error('Unable to load staff dashboard.', loadError);
      setError(t('staff.dashboard.error.load' as import('../i18n/translations').TranslationKey));
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refreshPermissions();
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, onFocus);
    };
  }, [refresh, refreshPermissions]);

  const completedOrders = todayOrders.filter((order) => order.status === 'done');
  const pendingVoidOrders = todayOrders.filter((order) => order.status === 'pending_void');
  const recentOrders = todayOrders.filter((order) => order.status === 'done').slice(0, 5);
  const displayedSales = canTakeOrders || canViewHistory ? personalSales : null;
  const blind = user?.role === 'staff' && resolveStoreSettings(store?.settings).blindShiftClosing;
  const shiftSummary = openShift ?? latestShift;
  const dateLabel = new Intl.DateTimeFormat(getLanguage(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const operationsTarget = [
    ['view_dashboard', '/owner/dashboard'],
    ['manage_shifts', '/owner/shifts'],
    ['resolve_voids', '/owner/voids'],
    ['manage_catalog', '/owner/catalog'],
    ['manage_inventory', '/owner/inventory'],
    ['manage_waste', '/owner/waste'],
    ['manage_schedule', '/owner/schedule'],
    ['view_reports', '/owner/reports'],
    ['view_fiscal_reports', '/owner/fiscal-reports'],
    ['manage_fiscal', '/owner/fiscal'],
    ['manage_expenses', '/owner/expenses'],
    ['manage_suppliers', '/owner/suppliers'],
    ['view_activity_log', '/owner/activity'],
  ].find(([permissionId]) => permissions.includes(permissionId))?.[1];

  return (
    <div className="store-themed-screen min-h-screen bg-surface pb-24 staff-dashboard">
      <TopBar title={t('staff.dashboard.title' as import('../i18n/translations').TranslationKey)} storeName={store?.name} onProfileClick={() => navigate('/profile')} />
      <main className="mx-auto w-full p-0">
      <PageContainer className="staff-dashboard-container role-dashboard staff-dashboard-content">
        <header className="dashboard-welcome mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-body text-label-md text-primary">{t('staff.dashboard.welcome' as import('../i18n/translations').TranslationKey)}</p>
            <h1 className="mt-1 font-display text-headline-lg text-on-surface">{user?.name}</h1>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">{dateLabel}</p>
          </div>
          <StatusTag status={openShift ? 'open' : 'closed'}>{t('staff.dashboard.shift.status' as import('../i18n/translations').TranslationKey, { status: t(openShift ? 'staff.dashboard.shift.open' as import('../i18n/translations').TranslationKey : 'staff.dashboard.shift.closed' as import('../i18n/translations').TranslationKey) })}</StatusTag>
        </header>

        {operationsTarget && (
          <div className="mb-4">
            <Button type="button" variant="secondary" onClick={() => navigate(operationsTarget)}>
              <MaterialIcon name="storefront" />{t('staff.dashboard.storeTools' as import('../i18n/translations').TranslationKey)}
            </Button>
          </div>
        )}

        {error && <p role="alert" className="mb-4 rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

        {canManageShift && (
          <CardGrid className="mb-4 mobile-gap-3 staff-dashboard-actions">
            {openShift ? (
              <button type="button" onClick={() => navigate('/shift')} className="dashboard-glass dashboard-glass-tint--rose flex min-h-24 items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-container text-error-dark"><MaterialIcon name="lock" /></span>
                <div>
                  <p className="font-display text-headline-sm text-on-surface">{t('staff.dashboard.shift.close' as import('../i18n/translations').TranslationKey)}</p>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('staff.dashboard.shift.closeHelp' as import('../i18n/translations').TranslationKey)}</p>
                </div>
              </button>
            ) : (
              <button type="button" onClick={() => navigate('/shift')} className="dashboard-glass dashboard-glass-tint--green flex min-h-24 items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name="lock_open" /></span>
                <div>
                  <p className="font-display text-headline-sm text-on-surface">{t('staff.dashboard.shift.openAction' as import('../i18n/translations').TranslationKey)}</p>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('staff.dashboard.shift.openHelp' as import('../i18n/translations').TranslationKey)}</p>
                </div>
              </button>
            )}
            {canTakeOrders && (
              <button type="button" onClick={() => navigate('/pos')} className="dashboard-primary-action flex min-h-24 items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99]">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><MaterialIcon name="point_of_sale" /></span>
                <div>
                  <p className="font-display text-headline-sm">{t('staff.dashboard.pos.open' as import('../i18n/translations').TranslationKey)}</p>
                  <p className="mt-1 font-body text-body-sm text-ink/70">{t('staff.dashboard.pos.help' as import('../i18n/translations').TranslationKey)}</p>
                </div>
              </button>
            )}
          </CardGrid>
        )}

        {canTakeOrders && !canManageShift && (
          <section className="mb-4">
            <button type="button" onClick={() => navigate('/pos')} className="dashboard-primary-action flex min-h-24 w-full items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99]">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><MaterialIcon name="point_of_sale" /></span>
              <div>
                <p className="font-display text-headline-sm">{t('staff.dashboard.pos.open' as import('../i18n/translations').TranslationKey)}</p>
                <p className="mt-1 font-body text-body-sm text-ink/70">{t('staff.dashboard.pos.help' as import('../i18n/translations').TranslationKey)}</p>
              </div>
            </button>
          </section>
        )}

        {displayedSales !== null && (
          <CardGrid className="mb-4 mobile-gap-3 staff-dashboard-kpis">
            <article className="dashboard-kpi dashboard-glass dashboard-glass-tint--blue rounded-2xl p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fixed/40 text-primary"><MaterialIcon name="payments" /></span>
              <p className="mt-3 font-body text-body-sm text-on-surface-variant">{t('staff.dashboard.sales.personalToday' as import('../i18n/translations').TranslationKey)}</p>
              <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{blind ? '*****' : `${formatTnd(displayedSales / 1000)} DT`}</p>
            </article>
            <article className="dashboard-kpi dashboard-glass dashboard-glass-tint--green rounded-2xl p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-container text-on-success-container"><MaterialIcon name="receipt_long" /></span>
              <p className="mt-3 font-body text-body-sm text-on-surface-variant">{t('staff.dashboard.orders.completedToday' as import('../i18n/translations').TranslationKey)}</p>
              <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{completedOrders.length}</p>
            </article>
          </CardGrid>
        )}

        {canManageShift && shiftSummary && (
          <section className="staff-shift-summary dashboard-glass mb-4 rounded-2xl p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-body text-label-sm uppercase text-outline">{t('staff.dashboard.shift.summary' as import('../i18n/translations').TranslationKey)}</p>
                <h2 className="mt-1 font-display text-headline-md text-on-surface">
                  {t(openShift ? 'staff.dashboard.shift.current' as import('../i18n/translations').TranslationKey : 'staff.dashboard.shift.latest' as import('../i18n/translations').TranslationKey)}
                </h2>
              </div>
              <StatusTag status={shiftSummary.status}>{t(shiftSummary.status === 'open' ? 'staff.dashboard.shift.open' as import('../i18n/translations').TranslationKey : 'staff.dashboard.shift.closed' as import('../i18n/translations').TranslationKey)}</StatusTag>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label={t('staff.dashboard.shift.startingCash' as import('../i18n/translations').TranslationKey)} value={blind ? '*****' : shiftSummary.startingCashMillimes} />
              {openShift ? (
                <>
                  <Metric label={t('staff.dashboard.shift.cashSalesTabs' as import('../i18n/translations').TranslationKey)} value={blind ? '*****' : cashSales} />
                  <Metric label={t('staff.dashboard.shift.expectedCash' as import('../i18n/translations').TranslationKey)} value={blind || expectedCash === null ? '*****' : expectedCash} accent />
                </>
              ) : (
                <>
                  <Metric label={t('staff.dashboard.shift.countedCash' as import('../i18n/translations').TranslationKey)} value={blind || shiftSummary.countedCashMillimes === undefined ? '*****' : shiftSummary.countedCashMillimes} />
                  <Metric label={t('staff.dashboard.shift.difference' as import('../i18n/translations').TranslationKey)} value={blind || shiftSummary.differenceMillimes === undefined ? '*****' : shiftSummary.differenceMillimes} accent />
                </>
              )}
            </div>
          </section>
        )}

        {canRequestVoid && pendingVoidOrders.length > 0 && (
          <section className="dashboard-glass dashboard-glass-tint--amber mb-4 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <MaterialIcon name="notifications_active" className="mt-0.5 text-secondary" />
              <div>
                <h2 className="font-display text-headline-sm text-on-warning-container">{t('staff.dashboard.pending.title' as import('../i18n/translations').TranslationKey)}</h2>
                <p className="mt-1 font-body text-body-sm text-on-warning-container">
                  {t(pendingVoidOrders.length === 1 ? 'staff.dashboard.pending.one' as import('../i18n/translations').TranslationKey : 'staff.dashboard.pending.many' as import('../i18n/translations').TranslationKey, { count: pendingVoidOrders.length })}
                </p>
              </div>
            </div>
          </section>
        )}

        {canViewHistory && (
          <section className="staff-recent-orders">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-headline-md text-on-surface">{t('staff.dashboard.orders.recent' as import('../i18n/translations').TranslationKey)}</h2>
              <Button variant="secondary" className="min-h-10 px-3" onClick={() => navigate('/orders')}>
                {t('staff.dashboard.orders.viewAll' as import('../i18n/translations').TranslationKey)}
                <MaterialIcon name="arrow_forward" className="text-lg" />
              </Button>
            </div>
            {loading ? <ListSkeleton rows={2} label={t('staff.dashboard.orders.loading' as import('../i18n/translations').TranslationKey)} /> : recentOrders.length > 0 ? (
              <CardGrid className="mobile-gap-2">
                {recentOrders.map((order) => (
                  <button key={order.id} type="button" onClick={() => navigate('/orders')} className="dashboard-glass-row flex items-center justify-between gap-3 rounded-xl p-4 text-left">
                    <div className="min-w-0">
                      <p className="font-display text-title-md text-on-surface">#{order.number}</p>
                      <p className="mt-1 truncate font-body text-body-sm text-on-surface-variant">
                        {new Date(order.createdAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })} • {t('staff.dashboard.orders.items' as import('../i18n/translations').TranslationKey, { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-title-md tabular-nums text-primary">{formatTnd(order.totalMillimes / 1000)} DT</p>
                  </button>
                ))}
              </CardGrid>
            ) : (
              <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('staff.dashboard.orders.noneToday' as import('../i18n/translations').TranslationKey)}</p>
            )}
          </section>
        )}
        </PageContainer>
      </main>
      <BottomNav />
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number | string; accent?: boolean }) {
  const displayValue = typeof value === 'number' ? `${formatTnd(value / 1000)} DT` : value;
  return (
    <div className="rounded-xl bg-surface-container-low p-3">
      <p className="font-body text-body-sm text-on-surface-variant">{label}</p>
      <p className={`mt-1 font-display text-title-md tabular-nums ${accent ? 'text-primary' : 'text-on-surface'}`}>
        {displayValue}
      </p>
    </div>
  );
}
