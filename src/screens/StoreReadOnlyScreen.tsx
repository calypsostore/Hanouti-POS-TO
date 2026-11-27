import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MaterialIcon } from '../components/MaterialIcon';
import { ItemLogo } from '../components/ItemLogo';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';
import { adminWorkspaceLinks } from '../app/navigation';
import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { getLanguage } from '../i18n';
import { activityService } from '../services/activityService';
import { catalogService } from '../services/catalogService';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { isSubscriptionExpired, type ActivityRecord, type CatalogItemRecord, type OrderRecord, type ShiftRecord, type StoreRecord, type UserSummary } from '../types/domain';

type StoreTab = 'sales' | 'staff' | 'shifts' | 'activity';

const tabs: { id: StoreTab; label: string; icon: string }[] = [
  { id: 'sales', label: 'admin.sales', icon: 'point_of_sale' },
  { id: 'staff', label: 'admin.staff', icon: 'groups' },
  { id: 'shifts', label: 'admin.shifts', icon: 'payments' },
  { id: 'activity', label: 'admin.activity', icon: 'history' },
];

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function effectiveStoreActive(store: StoreRecord): boolean {
  return store.isActive && !store.archivedAt && !isSubscriptionExpired(store);
}

export function StoreReadOnlyScreen() {
  const { storeId = '' } = useParams();
  const refreshKey = useFocusRefreshKey();
  const [store, setStore] = useState<StoreRecord>();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [activeTab, setActiveTab] = useState<StoreTab>('sales');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const today = localDateKey(new Date());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const nextStore = await userService.getStore(storeId);
        if (!nextStore) {
          if (active) {
            setStore(undefined);
            setError(t('admin.storeNotFound'));
            setLoading(false);
          }
          return;
        }
        const [nextOrders, nextStaff, nextShifts, nextActivity, nextCatalogItems] = await Promise.all([
          orderService.listAll(storeId),
          userService.listUsers(storeId),
          shiftService.listShifts(storeId),
          activityService.list(storeId),
          catalogService.listItems(storeId),
        ]);
        if (!active) return;
        setStore(nextStore);
        setOrders(nextOrders);
        setStaff(nextStaff.filter((user) => user.role === 'staff'));
        setShifts(nextShifts);
        setActivity(nextActivity.slice(0, 100));
        setCatalogItems(nextCatalogItems);
        setError('');
      } catch (loadError) {
        console.error('Unable to load the store view.', loadError);
        if (active) setError(t('admin.storeLoadError'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [refreshKey, storeId]);

  const todayOrders = useMemo(() => orders.filter((order) => localDateKey(new Date(order.createdAt)) === today), [orders, today]);
  const completedOrders = todayOrders.filter((order) => order.status === 'done');
  const todaySales = completedOrders.reduce((sum, order) => sum + order.totalMillimes, 0);
  const staffSales = useMemo(() => staff.map((member) => {
    const memberOrders = orders.filter((order) => order.staffId === member.id && order.status === 'done');
    return {
      member,
      orderCount: memberOrders.length,
      sales: memberOrders.reduce((sum, order) => sum + order.totalMillimes, 0),
      openShift: shifts.find((shift) => shift.staffId === member.id && shift.status === 'open'),
    };
  }).sort((left, right) => right.sales - left.sales), [orders, shifts, staff]);

  if (loading) {
    return <main className="mx-auto min-h-screen w-full max-w-3xl bg-surface p-4 pt-8"><ListSkeleton rows={5} label={t('admin.loadingStoreView')} /></main>;
  }
  if (!store) {
    return (
      <main className="min-h-screen bg-surface p-6">
        <Link to="/admin/stores" className="font-body text-primary underline">{t('admin.backToStores')}</Link>
        <p role="alert" className="mt-4 font-body text-body-md text-error-dark">{error || t('admin.storeNotFound')}</p>
      </main>
    );
  }

  return (
    <WorkspaceLayout title={store.name} links={adminWorkspaceLinks}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-headline-lg text-on-surface">{store.name}</h1>
          <p className="mt-1 break-all font-body text-body-sm text-outline">{store.code.toUpperCase()} · {t('admin.plan', { plan: store.subscription?.plan ? t(`admin.${store.subscription.plan}` as 'admin.trial' | 'admin.monthly' | 'admin.yearly') : t('admin.trial') })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusTag status={effectiveStoreActive(store) ? 'open' : 'suspended'}>{effectiveStoreActive(store) ? t('common.active') : store.archivedAt ? t('admin.archived') : t('common.suspended')}</StatusTag>
          {isSubscriptionExpired(store) && <StatusTag status="suspended">{t('admin.subscriptionExpired')}</StatusTag>}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

      <nav aria-label={t('admin.storeSupportTabs')} className="scrollbar-hidden mb-4 flex gap-2 overflow-x-auto rounded-xl bg-surface-container-high p-1">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 font-body text-label-md ${activeTab === tab.id ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}>
            <MaterialIcon name={tab.icon} className="text-lg" />{t(tab.label as 'admin.sales' | 'admin.staff' | 'admin.shifts' | 'admin.activity')}
          </button>
        ))}
      </nav>

      {activeTab === 'sales' && (
        <section>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <InfoCard label={t('admin.todaySales')} value={`${formatTnd(todaySales / 1000)} DT`} />
            <InfoCard label={t('admin.todayOrders')} value={todayOrders.length.toLocaleString(getLanguage())} />
            <InfoCard label={t('admin.completedOrders')} value={completedOrders.length.toLocaleString(getLanguage())} />
          </div>
          <ReadOnlyCard title={t('admin.todayOrders')}>
            <div className="flex flex-col gap-2">
              {todayOrders.map((order) => (
                <article key={order.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
                  <div className="min-w-0">
                    <p className="font-body text-label-md text-on-surface">#{order.number} · {order.staffName ?? t('common.staff')}</p>
                    <p className="mt-1 font-body text-body-sm text-outline">{new Date(order.createdAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })} · {t(order.status === 'done' ? 'common.done' : order.status === 'pending_void' ? 'orders.pendingVoid' : 'orders.voided')}</p>
                  </div>
                  <strong className="shrink-0 font-body text-label-md tabular-nums text-on-surface">{formatTnd(order.totalMillimes / 1000)} DT</strong>
                </article>
              ))}
              {todayOrders.length === 0 && <p className="rounded-lg bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('admin.noOrdersToday')}</p>}
            </div>
          </ReadOnlyCard>
          <ReadOnlyCard title={t('catalog.title')}>
            <div className="flex flex-col gap-2">
              {catalogItems.map((item) => (
                <article key={item.id} className="flex items-center gap-3 rounded-lg bg-surface-container-low p-3">
                  <ItemLogo id={item.icon} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-label-md text-on-surface">{item.name}</p>
                    <p className="mt-1 font-body text-body-sm text-outline">{formatTnd(item.priceMillimes / 1000)} DT</p>
                  </div>
                </article>
              ))}
              {catalogItems.length === 0 && <p className="rounded-lg bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('catalog.noItemsFound')}</p>}
            </div>
          </ReadOnlyCard>
        </section>
      )}

      {activeTab === 'staff' && (
        <ReadOnlyCard title={t('admin.staffPerformance')}>
          <div className="flex flex-col gap-2">
            {staffSales.map(({ member, orderCount, sales, openShift }) => (
              <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
                <div className="min-w-0">
                  <p className="truncate font-body text-label-md text-on-surface">{member.name}</p>
                  <p className="mt-1 font-body text-body-sm text-outline">{t('admin.completedOrdersCount', { count: orderCount })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <strong className="font-body text-label-md tabular-nums text-primary">{formatTnd(sales / 1000)} DT</strong>
                  <StatusTag status={openShift ? 'open' : 'closed'}>{openShift ? t('admin.onShift') : t('admin.offShift')}</StatusTag>
                </div>
              </article>
            ))}
            {staffSales.length === 0 && <p className="rounded-lg bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('admin.noStaffAccounts')}</p>}
          </div>
        </ReadOnlyCard>
      )}

      {activeTab === 'shifts' && (
        <ReadOnlyCard title={t('admin.shifts')}>
          <div className="flex flex-col gap-2">
            {shifts.map((shift) => (
              <article key={shift.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
                <div>
                  <p className="font-body text-label-md text-on-surface">{staff.find((member) => member.id === shift.staffId)?.name ?? t('admin.unknownStaff')}</p>
                  <p className="mt-1 font-body text-body-sm text-outline">{t('admin.openedAt', { date: new Date(shift.openedAt).toLocaleString(getLanguage()) })}{shift.closedAt ? ` · ${t('admin.closedAt', { date: new Date(shift.closedAt).toLocaleString(getLanguage())})}` : ''}</p>
                  {shift.differenceMillimes !== undefined && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('admin.cashDifference', { amount: formatTnd(shift.differenceMillimes / 1000) })}</p>}
                </div>
                <StatusTag status={shift.status === 'open' ? 'open' : 'closed'}>{shift.status === 'open' ? t('admin.open') : t('admin.closed')}</StatusTag>
              </article>
            ))}
            {shifts.length === 0 && <p className="rounded-lg bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('admin.noShifts')}</p>}
          </div>
        </ReadOnlyCard>
      )}

      {activeTab === 'activity' && (
        <ReadOnlyCard title={t('admin.recentActivity')}>
          <div className="flex flex-col gap-2">
            {activity.map((entry) => (
              <article key={entry.id} className="rounded-lg bg-surface-container-low p-3">
                <p className="font-body text-label-md text-on-surface">{entry.summary}</p>
                <p className="mt-1 font-body text-body-sm text-outline">{entry.actorName} · {new Date(entry.createdAt).toLocaleString(getLanguage())}</p>
              </article>
            ))}
            {activity.length === 0 && <p className="rounded-lg bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('admin.noActivity')}</p>}
          </div>
        </ReadOnlyCard>
      )}
    </WorkspaceLayout>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl bg-surface-container-lowest p-4 shadow-card"><p className="font-body text-body-sm text-outline">{label}</p><p className="mt-1 font-display text-headline-md tabular-nums text-primary">{value}</p></article>;
}

function ReadOnlyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card"><h2 className="mb-3 font-display text-headline-md text-on-surface">{title} · {t('admin.readOnlySuffix')}</h2>{children}</section>;
}
