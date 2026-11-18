import { useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Keypad } from '../components/Keypad';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { TopBar } from '../components/TopBar';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { OrderRecord } from '../types/domain';

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
  location: string;
  status: OrderStatus;
  total: number;
  items: OrderItemView[];
  staff: string;
  reason?: string;
}

function toOrderView(order: OrderRecord): OrderView {
  const staff = userService.getUser(order.staffId);
  return {
    id: order.id,
    number: order.number,
    staffId: order.staffId,
    time: new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    location: order.location ?? 'Counter • Takeaway',
    status: order.status === 'pending_void' ? 'pending' : order.status,
    total: order.totalMillimes / 1000,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      total: item.lineTotalMillimes / 1000,
    })),
    staff: staff?.name ?? 'Staff',
    reason: order.voidReason,
  };
}

const filterOptions: { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'All Today' },
  { value: 'done', label: 'Completed' },
  { value: 'pending', label: 'Pending Void' },
  { value: 'voided', label: 'Voided' },
];

export function OrdersScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const store = userService.getStore(storeId);
  const [orders, setOrders] = useState(() => orderService.listToday(storeId).map(toOrderView));
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [activeOrder, setActiveOrder] = useState<OrderView | null>(null);
  const [pin, setPin] = useState('');
  const [feedback, setFeedback] = useState('');
  const [toast, setToast] = useState('');

  const visibleOrders = useMemo(
    () => orders.filter((order) => filter === 'all' || order.status === filter),
    [filter, orders],
  );
  const doneTotal = orders.filter((order) => order.status === 'done').reduce((sum, order) => sum + order.total, 0);
  const pendingCount = orders.filter((order) => order.status === 'pending').length;
  const doneCount = orders.filter((order) => order.status === 'done').length;
  const voidedCount = orders.filter((order) => order.status === 'voided').length;

  function refreshOrders() {
    setOrders(orderService.listToday(storeId).map(toOrderView));
  }

  function openVoidSheet(order: OrderView) {
    setActiveOrder(order);
    setPin('');
    setFeedback('');
  }

  function pressPin(digit: string) {
    if (pin.length >= 4) return;
    const nextPin = `${pin}${digit}`;
    setPin(nextPin);
    if (nextPin.length === 4) {
      if (!activeOrder || !user) return;
      try {
        orderService.voidWithPin(activeOrder.id, nextPin, user.id);
        refreshOrders();
        setActiveOrder(null);
        showToast(`Order #${activeOrder.number} voided`);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Unable to void this order.');
        window.setTimeout(() => setPin(''), 600);
      }
    }
  }

  function requestVoid() {
    if (!activeOrder || !user) return;
    try {
      orderService.requestVoid(activeOrder.id, user.id);
      refreshOrders();
      setActiveOrder(null);
      showToast('Void request sent to the owner');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to request this void.');
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  }

  function statusLabel(status: OrderStatus) {
    if (status === 'done') return 'Done';
    if (status === 'pending') return 'Awaiting Owner';
    return 'Voided';
  }

  function statusType(status: OrderStatus) {
    if (status === 'done') return 'done' as const;
    if (status === 'pending') return 'pending' as const;
    return 'voided' as const;
  }

  return (
    <div className="min-h-screen bg-surface pb-20">
      <TopBar title="Active Orders" storeName={store?.name} />
      <main className="mx-auto flex w-full max-w-3xl flex-col">
        <section className="flex flex-col gap-3 px-4 pb-2 pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-container-high px-3 font-body text-label-sm text-primary">
              <MaterialIcon name="badge" className="text-base" filled />
              Staff: {user?.name ?? 'Staff'} <span className="font-normal text-on-surface-variant">(Today)</span>
            </span>
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-container px-3 font-body text-label-sm text-on-surface-variant">
              <MaterialIcon name="query_stats" className="text-base text-success-dark" />
              Shift: <strong className="text-on-surface">{doneCount}</strong> ord.
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <span className="font-body text-label-sm uppercase tracking-wider text-outline">Today's Shift Total</span>
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
                {option.label}
                {option.value === 'all' && <span className="opacity-80">({orders.length})</span>}
                {option.value === 'done' && <span className="opacity-70">({doneCount})</span>}
                {option.value === 'pending' && <span className="rounded-full bg-secondary-container px-1.5 py-0.5 text-[11px] text-on-surface">{pendingCount}</span>}
                {option.value === 'voided' && <span className="opacity-70">({voidedCount})</span>}
              </Chip>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 px-4 pb-8 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 font-body text-label-md uppercase tracking-wider text-outline">
              <MaterialIcon name="schedule" className="text-base" />
              Recent (Last Hour)
            </h2>
            <span className="font-body text-label-sm text-outline">Sorted by newest</span>
          </div>
          {visibleOrders.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">No orders in this filter.</p>}
          {visibleOrders.map((order) => (
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
                    <p className="truncate font-body text-body-sm text-on-surface-variant">{order.location}</p>
                  </div>
                </div>
                <StatusTag status={statusType(order.status)}>{statusLabel(order.status)}</StatusTag>
              </div>

              <div className={`flex flex-col gap-1 rounded-lg p-3 ${order.status === 'voided' ? 'bg-surface-container-low/50 text-outline' : 'bg-surface-container-low'}`}>
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className={`flex items-center justify-between gap-2 font-body text-body-md ${order.status === 'voided' ? 'line-through' : ''}`}>
                    <span className="truncate">{item.quantity}× {item.name}</span>
                    <span className="shrink-0 font-body text-label-md tabular-nums">{formatTnd(item.total)} DT</span>
                  </div>
                ))}
                {order.reason && <p className="pt-1 font-body text-body-sm italic text-error-dark">Reason: {order.reason}</p>}
              </div>

              {order.status === 'pending' && (
                <div className="flex items-center gap-2 rounded-lg bg-warning-container/70 p-2.5 text-on-warning-container">
                  <MaterialIcon name="notifications_active" className="text-xl text-secondary" />
                  <div>
                    <p className="font-body text-label-sm">Push Request Sent (11:12)</p>
                    <p className="font-body text-body-sm">Owner Si Mohamed notified via in-app alert</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex flex-col">
                  <span className="font-body text-label-sm text-outline">{order.status === 'pending' ? 'Requested Void' : order.status === 'voided' ? 'Voided total' : 'Total Tendered'}</span>
                  <span className={`font-display text-headline-md ${order.status === 'voided' ? 'text-error-dark' : 'text-primary'}`}>
                    {formatTnd(order.status === 'voided' ? 0 : order.total)} <small className="font-body text-label-sm">DT</small>
                  </span>
                </div>
                {order.status === 'done' && order.staffId === user?.id && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" className="min-h-10 px-3 text-label-md" onClick={() => showToast(`Ticket #${order.number}`)}><MaterialIcon name="receipt" className="text-lg" />Ticket</Button>
                    <Button variant="danger" className="min-h-10 px-3 text-label-md" onClick={() => openVoidSheet(order)}><MaterialIcon name="cancel" className="text-lg" />Void</Button>
                  </div>
                )}
                {order.status === 'pending' && (
                  <span className="font-body text-label-sm text-on-surface-variant">By {order.staff}</span>
                )}
                {order.status === 'voided' && (
                  <span className="flex items-center gap-1 font-body text-label-sm text-on-surface-variant"><MaterialIcon name="verified_user" className="text-base text-success-dark" />Voided by Owner</span>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>

      <BottomNav />
      <BottomSheet open={activeOrder !== null} onClose={() => setActiveOrder(null)} title={`Authorize Order Void #${activeOrder?.number ?? ''}`}>
        {activeOrder && (
          <div className="flex flex-col gap-4">
            <p className="text-center font-body text-body-sm text-outline">Total: {formatTnd(activeOrder.total)} DT • Owner / Admin authorization required</p>
            <div className="flex justify-center gap-3" aria-label={`${pin.length} of 4 PIN digits entered`}>
              {[0, 1, 2, 3].map((index) => <span key={index} className={`h-4 w-4 rounded-full ${index < pin.length ? 'bg-primary' : 'bg-surface-container-highest'}`} />)}
            </div>
            <p role="alert" className="h-4 text-center font-body text-label-sm text-error-dark">{feedback}</p>
            <Keypad onPress={pressPin} onClear={() => { setPin(''); setFeedback(''); }} onBackspace={() => { setPin((value) => value.slice(0, -1)); setFeedback(''); }} />
            <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-3">
              <div className="flex items-center gap-2">
                <MaterialIcon name="wifi_tethering" className="text-xl text-secondary" />
                <div>
                  <p className="font-body text-label-sm text-on-surface">Owner not at the counter?</p>
                  <p className="font-body text-body-sm text-outline">Send an approval request to the owner.</p>
                </div>
              </div>
              <Button className="w-full" onClick={requestVoid}><MaterialIcon name="send_to_mobile" className="text-lg" />Request void</Button>
            </div>
          </div>
        )}
      </BottomSheet>
      {toast && <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{toast}</div>}
    </div>
  );
}
