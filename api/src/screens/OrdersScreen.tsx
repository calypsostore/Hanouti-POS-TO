import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { TopBar } from '../components/TopBar';
import { TicketView } from '../components/TicketView';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { OrderRecord, StoreRecord } from '../types/domain';
import { t, type TranslationKey } from '../i18n/translations';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { DataTable, type DataTableColumn } from '../components/layout';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { getOrderTags, matchesOrderSearch } from '../lib/orderTags';

const ORDER_PAGE_SIZE = 100;

type OrderStatus = 'done' | 'pending' | 'voided';
type OrderFilter = 'all' | 'done' | 'pending' | 'voided';

interface OrderItemView {
  quantity: number;
  name: string;
  total: number;
}

interface OrderView {
  id: string;
  number: number;
  staffId: string;
  time: string;
  status: OrderStatus;
  total: number;
  items: OrderItemView[];
  staff: string;
  reason?: string;
  voidedBy?: string;
  voidRequestedAt?: string;
  record: OrderRecord;
}

function toOrderView(order: OrderRecord, staffName?: string): OrderView {
  return {
    id: order.id,
    number: order.number,
    staffId: order.staffId,
    time: new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    status: order.status === 'pending_void' ? 'pending' : order.status,
    total: order.totalMillimes / 1000,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      total: item.lineTotalMillimes / 1000,
    })),
    staff: order.staffName ?? staffName ?? t('common.staff'),
    reason: order.voidReason,
    voidedBy: order.voidedBy,
    voidRequestedAt: order.voidRequestedAt,
    record: order,
  };
}

const filterOptions: { value: OrderFilter; label: TranslationKey }[] = [
  { value: 'all', label: 'orders.all' },
  { value: 'done', label: 'orders.completed' },
  { value: 'pending', label: 'orders.pendingVoid' },
  { value: 'voided', label: 'orders.voided' },
];

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatBusinessDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function OrdersScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const staffFilter = user?.role === 'staff' ? user.id : undefined;
  const [canRequestVoid, setCanRequestVoid] = useState(false);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [businessDate, setBusinessDate] = useState(() => localDateKey());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [activeOrder, setActiveOrder] = useState<OrderView | null>(null);
  const [pin, setPin] = useState('');
  const [feedback, setFeedback] = useState('');
  const [toast, setToast] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [ticketOrder, setTicketOrder] = useState<OrderView | null>(null);
  const [pinLockedSeconds, setPinLockedSeconds] = useState(0);
  const [verifiedPinForOrderId, setVerifiedPinForOrderId] = useState<string | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const hasLoadedOrdersRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const orderFetchVersionRef = useRef(0);
  const nextOrderOffsetRef = useRef(0);

  const visibleOrders = useMemo(
    () => orders.filter((order) =>
      (filter === 'all' || order.status === filter)
      && (!tagFilter || getOrderTags(order.record).some((tag) => tag.id === tagFilter))
      && matchesOrderSearch(order.record, order.staff, search)),
    [filter, orders, search, tagFilter],
  );
  const availableTags = useMemo(() => {
    const tags = new Map<string, ReturnType<typeof getOrderTags>[number]>();
    for (const order of orders) {
      for (const tag of getOrderTags(order.record)) tags.set(tag.id, tag);
    }
    return [...tags.values()];
  }, [orders]);
  const doneTotal = orders.filter((order) => order.status === 'done').reduce((sum, order) => sum + order.total, 0);
  const pendingCount = orders.filter((order) => order.status === 'pending').length;
  const doneCount = orders.filter((order) => order.status === 'done').length;
  const voidedCount = orders.filter((order) => order.status === 'voided').length;

  const refreshOrders = useCallback(async () => {
    const initialLoad = !hasLoadedOrdersRef.current;
    const fetchVersion = orderFetchVersionRef.current + 1;
    orderFetchVersionRef.current = fetchVersion;
    if (initialLoad) setLoading(true);
    setLoadError('');
    try {
      const records = await orderService.listByBusinessDate(storeId, businessDate, staffFilter, {
        limit: ORDER_PAGE_SIZE,
        offset: 0,
      });
      if (fetchVersion !== orderFetchVersionRef.current) return;
      const staffNames = await userService.listStaffNames(storeId, records.map((order) => order.staffId));
      if (fetchVersion !== orderFetchVersionRef.current) return;
      setOrders(records.map((order) => toOrderView(order, staffNames.get(order.staffId))));
      nextOrderOffsetRef.current = records.length;
      setHasMoreOrders(records.length === ORDER_PAGE_SIZE);
      hasLoadedOrdersRef.current = true;
    } catch (error) {
      if (fetchVersion === orderFetchVersionRef.current) throw error;
    } finally {
      if (initialLoad && fetchVersion === orderFetchVersionRef.current) setLoading(false);
    }
  }, [storeId, staffFilter, businessDate]);

  const loadMoreOrders = useCallback(async () => {
    if (!hasMoreOrders || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const fetchVersion = orderFetchVersionRef.current;
    const offset = nextOrderOffsetRef.current;
    setLoadingMore(true);
    setLoadError('');
    try {
      const records = await orderService.listByBusinessDate(storeId, businessDate, staffFilter, {
        limit: ORDER_PAGE_SIZE,
        offset,
      });
      if (fetchVersion !== orderFetchVersionRef.current) return;
      const staffNames = await userService.listStaffNames(storeId, records.map((order) => order.staffId));
      if (fetchVersion !== orderFetchVersionRef.current) return;
      nextOrderOffsetRef.current = offset + records.length;
      setOrders((current) => {
        const byId = new Map(current.map((order) => [order.id, order]));
        for (const order of records.map((record) => toOrderView(record, staffNames.get(record.staffId)))) byId.set(order.id, order);
        return [...byId.values()].sort((left, right) =>
          right.record.createdAt.localeCompare(left.record.createdAt) || right.id.localeCompare(left.id));
      });
      setHasMoreOrders(records.length === ORDER_PAGE_SIZE);
    } catch (error) {
      if (fetchVersion === orderFetchVersionRef.current) {
        console.error('Unable to load older orders.', error);
        setLoadError(error instanceof Error ? error.message : t('common.loadFailed'));
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [businessDate, hasMoreOrders, staffFilter, storeId]);

  useEffect(() => {
    void refreshOrders().catch(() => setLoadError(t('common.loadFailed')));
    void userService.getStore(storeId).then(setStore).catch(() => setLoadError(t('common.storeLoadFailed')));
  }, [refreshOrders, storeId, user]);

  useEffect(() => {
    const refresh = () => {
      void refreshOrders().catch((loadError: unknown) => {
        console.error('Unable to refresh orders after a live update.', loadError);
        setLoadError(t('common.refreshFailed'));
      });
    };
    const unsubscribe = subscribeToStoreChanges(storeId, ['orders'], refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refreshOrders, storeId]);

  useEffect(() => {
    if (user?.role !== 'staff') return;
    const refreshPermission = () => {
      void userService.hasPermission(user.id, 'request_void').then(setCanRequestVoid)
        .catch((loadError: unknown) => setFeedback(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
    };
    refreshPermission();
    window.addEventListener('focus', refreshPermission);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, refreshPermission);
    return () => {
      window.removeEventListener('focus', refreshPermission);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, refreshPermission);
    };
  }, [user]);

  useEffect(() => {
    if (!activeOrder) {
      setPinLockedSeconds(0);
      return;
    }
    const updateRemaining = () => setPinLockedSeconds(Math.ceil(orderService.getPinLockRemainingMs(storeId) / 1000));
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [activeOrder, storeId]);

  function openVoidSheet(order: OrderView) {
    setActiveOrder(order);
    setPin('');
    setFeedback('');
    setVoidReason('');
    setVerifiedPinForOrderId(null);
    setVoidBusy(false);
  }

  async function submitDirectVoid(pinValue: string) {
    if (!activeOrder || !user || voidBusy) return;
    setVoidBusy(true);
    try {
      await orderService.voidWithPin(activeOrder.id, pinValue, user.id, voidReason);
      await refreshOrders();
      setActiveOrder(null);
      showToast(t('orders.voidedToast', { number: activeOrder.number }));
    } catch (error) {
      setVerifiedPinForOrderId(null);
      setFeedback(error instanceof Error ? error.message : t('orders.unableToVoid'));
      setPinLockedSeconds(Math.ceil(orderService.getPinLockRemainingMs(activeOrder.record.storeId) / 1000));
      window.setTimeout(() => setPin(''), 600);
    } finally {
      setVoidBusy(false);
    }
  }

  async function pressPin(digit: string) {
    if (pinLockedSeconds > 0 || voidBusy || pin.length >= 4) return;
    const nextPin = `${pin}${digit}`;
    setPin(nextPin);
    if (nextPin.length === 4) {
      if (!activeOrder || !user) return;
      if (!voidReason.trim()) {
        setVoidBusy(true);
        try {
          const verified = await orderService.verifyVoidPin(activeOrder.record.storeId, nextPin);
          if (!verified) throw new Error('Incorrect Admin PIN.');
          setVerifiedPinForOrderId(activeOrder.id);
          setFeedback('Admin PIN verified. Enter a reason, then confirm the direct void.');
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : t('orders.unableToVoid'));
          setPinLockedSeconds(Math.ceil(orderService.getPinLockRemainingMs(activeOrder.record.storeId) / 1000));
          window.setTimeout(() => setPin(''), 600);
        } finally {
          setVoidBusy(false);
        }
        return;
      }
      await submitDirectVoid(nextPin);
    }
  }

  async function requestVoid() {
    if (!activeOrder || !user || voidBusy) return;
    setVoidBusy(true);
    try {
      await orderService.requestVoid(activeOrder.id, user.id, voidReason);
      await refreshOrders();
      setActiveOrder(null);
      showToast(t('orders.voidRequestSent'));
    } catch (error) {
      setVerifiedPinForOrderId(null);
      setPin('');
      setFeedback(error instanceof Error ? error.message : t('orders.unableToRequestVoid'));
    } finally {
      setVoidBusy(false);
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  }

  function statusLabel(status: OrderStatus) {
    if (status === 'done') return t('orders.done');
    if (status === 'pending') return t('orders.awaitingOwner');
    return t('orders.voided');
  }

  function statusType(status: OrderStatus) {
    if (status === 'done') return 'done' as const;
    if (status === 'pending') return 'pending' as const;
    return 'voided' as const;
  }

  const content = (
    <div className="min-h-screen bg-surface pb-20">
      {user?.role === 'staff' && <TopBar title={t('orders.title')} storeName={store?.name} />}
      <main className="orders-page-content mx-auto flex w-full max-w-none flex-col">
        <section className="orders-toolbar flex flex-col gap-3 px-4 pb-2 pt-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="flex min-w-0 items-center gap-3 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest px-3 py-2.5 shadow-card">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed/50 text-primary">
                <MaterialIcon name="calendar_month" className="text-xl" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-body text-label-sm text-outline">Business day</span>
                <span className="block truncate font-display text-label-lg text-on-surface">{formatBusinessDate(businessDate)}</span>
              </span>
              <input
                aria-label="Business date"
                type="date"
                value={businessDate}
                max={localDateKey()}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setBusinessDate(event.target.value);
                }}
                className="absolute h-px w-px opacity-0"
              />
              <MaterialIcon name="expand_more" className="shrink-0 text-on-surface-variant" />
            </label>
            <div className="flex min-w-20 flex-col items-center justify-center rounded-2xl border border-outline-variant/70 bg-surface-container-lowest px-3 py-2 shadow-card">
              <span className="font-display text-headline-md text-primary">{doneCount}</span>
              <span className="font-body text-label-sm text-outline">Completed loaded</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <span className="font-body text-label-sm uppercase tracking-wider text-outline">Loaded ticket total</span>
              <p className="mt-0.5 font-display text-currency-display-mobile text-primary">{formatTnd(doneTotal)} <small className="font-body text-label-md">DT</small></p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed/40 text-primary"><MaterialIcon name="coffee" className="text-2xl" /></span>
          </div>
          <div className="scrollbar-hidden -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
            {filterOptions.map((option) => (
              <Chip
                key={option.value}
                selected={filter === option.value}
                onClick={() => setFilter(option.value)}
                className="px-4"
              >
                {t(option.label)}
                {option.value === 'all' && <span className="opacity-80">({orders.length})</span>}
                {option.value === 'done' && <span className="opacity-70">({doneCount})</span>}
                {option.value === 'pending' && <span className="rounded-full bg-secondary-container px-1.5 py-0.5 text-[11px] text-on-surface">{pendingCount}</span>}
                {option.value === 'voided' && <span className="opacity-70">({voidedCount})</span>}
              </Chip>
            ))}
          </div>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-3 shadow-card">
            <MaterialIcon name="search" className="text-xl text-outline" />
            <input
              type="search"
              aria-label="Search tickets"
              placeholder="Search tickets, items, staff, notes, or location"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent font-body text-body-md text-on-surface outline-none placeholder:text-outline"
            />
          </label>
          {availableTags.length > 0 && (
            <div className="scrollbar-hidden -mx-4 flex gap-2 overflow-x-auto px-4 py-1" aria-label="Filter tickets by tag">
              <Chip selected={!tagFilter} onClick={() => setTagFilter('')} className="shrink-0 px-3">All tags</Chip>
              {availableTags.map((tag) => (
                <Chip key={tag.id} selected={tagFilter === tag.id} onClick={() => setTagFilter(tag.id)} className="shrink-0 px-3">
                  {tag.label}
                </Chip>
              ))}
            </div>
          )}
          {hasMoreOrders && (
            <p className="font-body text-body-xs text-on-surface-variant">
              Search and tag filters include loaded tickets only. Load older tickets to search the rest.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3 px-4 pb-8 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 font-body text-label-md uppercase tracking-wider text-outline">
              <MaterialIcon name="schedule" className="text-base" />
              Orders for {businessDate}
            </h2>
            <span className="font-body text-label-sm text-outline">{t('orders.sortedNewest')}</span>
          </div>
          {loadError && <p role="alert" className="rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{loadError}</p>}
          {loading ? <ListSkeleton label="Loading orders" /> : visibleOrders.length === 0 ? (
            <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">
              {search.trim() || tagFilter ? 'No tickets match the current search and tag filters.' : t('orders.emptyFilter')}
            </p>
          ) : <DataTable<OrderView>
            rows={visibleOrders}
            getRowKey={(order) => order.id}
            rowClassName={(order) => order.status === 'voided' ? 'bg-error-container/40 text-error-dark' : ''}
            columns={[
              { key: 'time', label: 'Time', sortValue: (order) => order.record.createdAt, render: (order) => order.time },
              { key: 'number', label: 'Order #', sortValue: (order) => order.number, render: (order) => `#${order.number}` },
              { key: 'staff', label: 'Staff', sortValue: (order) => order.staff, render: (order) => order.staff },
              { key: 'items', label: 'Items', sortValue: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0), render: (order) => `${order.items.reduce((sum, item) => sum + item.quantity, 0)} · ${order.items.map((item) => item.name).join(', ')}` },
              { key: 'payment', label: 'Payment', render: (order) => order.record.paymentMethod },
              { key: 'tags', label: 'Tags', render: (order) => getOrderTags(order.record).map((tag) => tag.label).join(', ') || '—' },
              { key: 'total', label: 'Total', sortValue: (order) => order.total, render: (order) => `${formatTnd(order.status === 'voided' ? 0 : order.total)} DT` },
              { key: 'status', label: 'Status', render: (order) => statusLabel(order.status) },
              { key: 'actions', label: 'Actions', render: (order) => (
                <div className="flex gap-2">
                  {order.status !== 'pending' && <Button variant="secondary" className="min-h-9 px-2 text-label-sm" onClick={() => setTicketOrder(order)}>{t('orders.ticket')}</Button>}
                  {order.status === 'done' && order.staffId === user?.id && <Button variant="danger" className="min-h-9 px-2 text-label-sm" onClick={() => openVoidSheet(order)}>{t('orders.void')}</Button>}
                </div>
              ) },
            ] satisfies DataTableColumn<OrderView>[]}
            mobileCards={(order) => (
            <article key={order.id} className={`flex flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card ${order.status === 'voided' ? 'opacity-90' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${order.status === 'pending' ? 'bg-warning-container text-secondary' : order.status === 'voided' ? 'bg-error-container text-error-dark' : 'bg-surface-container-high text-primary'}`}>
                    <MaterialIcon name={order.status === 'voided' ? 'block' : order.items[0]?.name.includes('Sandwich') ? 'lunch_dining' : 'local_cafe'} className="text-xl" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-display text-headline-sm text-on-surface ${order.status === 'voided' ? 'line-through decoration-error' : ''}`}>#{order.number}</span>
                      <span className="font-body text-label-sm text-outline">{order.time}</span>
                    </div>
                  </div>
                </div>
                <StatusTag status={statusType(order.status)}>{statusLabel(order.status)}</StatusTag>
              </div>

              {getOrderTags(order.record).length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Ticket tags">
                  {getOrderTags(order.record).map((tag) => (
                    <span
                      key={tag.id}
                      className={`rounded-full px-2.5 py-1 font-body text-label-sm ${
                        tag.kind === 'attention'
                          ? 'bg-warning-container text-on-warning-container'
                          : tag.kind === 'location'
                            ? 'bg-tertiary-container text-on-tertiary-container'
                            : tag.kind === 'note'
                              ? 'bg-secondary-container text-on-secondary-container'
                              : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              )}

              <div className={`flex flex-col gap-1 rounded-lg p-3 ${order.status === 'voided' ? 'bg-surface-container-low/50 text-outline' : 'bg-surface-container-low'}`}>
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className={`flex items-center justify-between gap-2 font-body text-body-md ${order.status === 'voided' ? 'line-through' : ''}`}>
                    <span className="truncate">{item.quantity}× {item.name}</span>
                    <span className="shrink-0 font-body text-label-md tabular-nums">{formatTnd(item.total)} DT</span>
                  </div>
                ))}
                {order.record.note && <p className="border-t border-outline-variant pt-2 font-body text-body-sm"><strong>Order note:</strong> {order.record.note}</p>}
                {order.reason && <p className="pt-1 font-body text-body-sm italic text-error-dark">{t('orders.voidReason', { reason: order.reason })}</p>}
              </div>

              {order.status === 'pending' && (
                <div className="flex items-center gap-2 rounded-lg bg-warning-container/70 p-2.5 text-on-warning-container">
                  <MaterialIcon name="notifications_active" className="text-xl text-secondary" />
                  <div>
                    <p className="font-body text-label-sm">Void pending - removed from your totals until the owner decides</p>
                    <p className="font-body text-label-sm">{t('orders.pushRequest')} ({order.voidRequestedAt ? new Date(order.voidRequestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''})</p>
                    <p className="font-body text-body-sm">{t('orders.ownerNotified')}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex flex-col">
                  <span className="font-body text-label-sm text-outline">{t(order.status === 'pending' ? 'orders.requestedVoid' : order.status === 'voided' ? 'orders.voidedTotal' : 'orders.totalTendered')}</span>
                  <span className={`font-display text-headline-md ${order.status === 'voided' ? 'text-error-dark' : 'text-primary'}`}>
                    {formatTnd(order.status === 'voided' ? 0 : order.total)} <small className="font-body text-label-sm">DT</small>
                  </span>
                </div>
                {order.status !== 'pending' && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" className="min-h-10 px-3 text-label-md" onClick={() => setTicketOrder(order)}><MaterialIcon name="receipt" className="text-lg" />{t('orders.ticket')}</Button>
                    {order.status === 'done' && (user?.role === 'owner' || order.staffId === user?.id) && <Button variant="danger" className="min-h-10 px-3 text-label-md" onClick={() => openVoidSheet(order)}><MaterialIcon name="cancel" className="text-lg" />{t('orders.void')}</Button>}
                  </div>
                )}
                {order.status === 'pending' && (
                  <span className="font-body text-label-sm text-on-surface-variant">{t('orders.byStaff', { name: order.staff })}</span>
                )}
                {order.status === 'voided' && (
                  <span className="flex items-center gap-1 font-body text-label-sm text-on-surface-variant"><MaterialIcon name="verified_user" className="text-base text-success-dark" />{t(order.voidedBy === 'pin' ? 'orders.voidedByPin' : 'orders.voidedByOwner')}</span>
                )}
              </div>
            </article>
            )}
            empty={<p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('orders.emptyFilter')}</p>}
          />}
          {hasMoreOrders && (
            <Button variant="secondary" className="w-full" disabled={loadingMore} onClick={() => void loadMoreOrders()}>
              {loadingMore ? 'Loading older tickets…' : 'Load older tickets'}
            </Button>
          )}
        </section>
      </main>

      {user?.role === 'staff' && <BottomNav />}
      <BottomSheet open={activeOrder !== null} onClose={() => setActiveOrder(null)} title={t('orders.authorizeVoid', { number: activeOrder?.number ?? '' })}>
        {activeOrder && (
          <div className="flex flex-col gap-4">
            <p className="text-center font-body text-body-sm text-outline">{t('orders.totalAuthorization', { total: formatTnd(activeOrder.total) })}</p>
            <section className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
              <div>
                <p className="font-body text-label-md text-on-surface">Direct void — Administrator PIN</p>
                <p className="font-body text-body-sm text-outline">Enter the PIN first or enter a reason before the PIN.</p>
              </div>
              <div className="flex justify-center gap-3" aria-label={t('orders.pinDigitsEntered', { count: pin.length })}>
                {[0, 1, 2, 3].map((index) => <span key={index} className={`h-4 w-4 rounded-full ${index < pin.length ? 'bg-primary' : 'bg-surface-container-highest'}`} />)}
              </div>
              <p role={verifiedPinForOrderId === activeOrder.id ? 'status' : 'alert'} className={`min-h-4 text-center font-body text-label-sm ${verifiedPinForOrderId === activeOrder.id ? 'text-success-dark' : 'text-error-dark'}`}>
                {pinLockedSeconds > 0 ? `PIN pad locked for ${pinLockedSeconds} seconds.` : feedback}
              </p>
              <Keypad
                disabled={pinLockedSeconds > 0 || voidBusy}
                onPress={pressPin}
                onClear={() => { setPin(''); setVerifiedPinForOrderId(null); setFeedback(''); }}
                onBackspace={() => { setPin((value) => value.slice(0, -1)); setVerifiedPinForOrderId(null); setFeedback(''); }}
              />
            </section>
            <label className="font-body text-label-md">Void reason
              <textarea required maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg bg-surface-container-low p-3 outline-none focus:ring-2 focus:ring-primary" />
            </label>
            {verifiedPinForOrderId === activeOrder.id && pin.length === 4 && (
              <Button className="w-full" disabled={!voidReason.trim() || voidBusy} onClick={() => void submitDirectVoid(pin)}>
                <MaterialIcon name="verified_user" className="text-lg" />
                {voidBusy ? 'Processing…' : 'Confirm Direct Void'}
              </Button>
            )}
            <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-3">
              <div className="flex items-center gap-2">
                <MaterialIcon name="wifi_tethering" className="text-xl text-secondary" />
                <div>
                  <p className="font-body text-label-sm text-on-surface">{t('orders.ownerNotAtCounter')}</p>
                  <p className="font-body text-body-sm text-outline">{t('orders.sendApproval')}</p>
                </div>
              </div>
              {canRequestVoid && <Button className="w-full" disabled={!voidReason.trim() || voidBusy} onClick={requestVoid}><MaterialIcon name="send_to_mobile" className="text-lg" />Request Void — Owner Approval</Button>}
            </div>
          </div>
        )}
      </BottomSheet>
      {ticketOrder && <TicketView order={ticketOrder.record} storeName={store?.name ?? ''} staffName={ticketOrder.staff} onClose={() => setTicketOrder(null)} settings={store?.settings} storeAddress={store?.address} storePhone={store?.phone} storeTaxId={store?.taxId} />}
      {toast && <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{toast}</div>}
    </div>
  );
  return user?.role === 'owner'
    ? <WorkspaceLayout title={t('orders.title')} storeName={store?.name} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>
    : content;
}
