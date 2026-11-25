import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createLatestRequestGuard } from '../lib/requestGuard';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { FirstRunHint } from '../components/FirstRunHint';
import { ItemCard, type ItemCardItem } from '../components/ItemCard';
import { ItemLogo } from '../components/ItemLogo';
import { Keypad } from '../components/Keypad';
import { LazyBatch } from '../components/LazyBatch';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { TicketRow } from '../components/TicketRow';
import { TopBar } from '../components/TopBar';
import { TicketView } from '../components/TicketView';
import { formatTnd } from '../lib/format';
import { getCustomerCreditTone, loadCustomerCreditStatuses } from '../lib/customerCredit';
import { useStoreAppearance } from '../lib/storeAppearance';
import { useQueryCacheRefresh } from '../lib/useQueryCacheRefresh';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { compService, type StaffDrinkAllowance } from '../services/compService';
import { OrderNotificationError, OrderServiceError, orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { reportService, type ReportDayStatus } from '../services/reportService';
import { userService } from '../services/userService';
import { updateService } from '../services/updateService';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { resolveStoreSettings } from '../types/domain';
import { useAuthStore } from '../stores/authStore';
import { useCartStore, type CartLine, type CartSnapshot } from '../stores/cartStore';
import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord, CompReason, CustomerRecord, OrderLineRecord, OrderRecord, OrderSummaryRecord, PaymentMethod, ShiftRecord, StoreRecord } from '../types/domain';
import { customerService } from '../services/customerService';
import type { CustomerCreditStatus } from '../services/customerService';
import {
  offlineOrderQueue,
  OFFLINE_ORDER_SYNCED_EVENT,
  OFFLINE_QUEUE_CHANGED_EVENT,
} from '../services/offlineOrderQueue';

interface ProductView extends ItemCardItem {
  priceMillimes: number;
  categoryId: string;
  stockCount: number | null;
  modifiers: CatalogModifierRecord[];
  modifierGroupName?: string;
  modifiersRequired?: boolean;
  modifierSelectionMode?: 'single' | 'multiple';
}

type CatalogViewMode = 'grid' | 'list';
const POS_CATALOG_VIEW_MODE_KEY = 'hanouti.pos-catalog-view-mode.v1';

function customerIdFromState(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('customerId' in state)) return '';
  return typeof state.customerId === 'string' ? state.customerId : '';
}

function formatOutOfStockTime(timestamp?: string): string {
  if (!timestamp) return 'unknown time';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function OrderElapsedTime({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  return <>{label}</>;
}

function toProductView(item: CatalogItemRecord): ProductView {
  return {
    id: item.id,
    name: item.name,
    price: item.priceMillimes / 1000,
    priceMillimes: item.priceMillimes,
    icon: item.icon,
    categoryId: item.categoryId,
    outOfStock: item.outOfStock || item.stockCount === 0,
    stockCount: item.stockCount,
    outOfStockBy: item.outOfStockBy,
    outOfStockAt: item.outOfStockAt,
    modifiers: item.modifiers ?? [],
    modifierGroupName: item.modifierGroupName,
    modifiersRequired: item.modifiersRequired,
    modifierSelectionMode: item.modifierSelectionMode,
  };
}

export function PosScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const { largeButtons } = useStoreAppearance();
  const lock = useAuthStore((state) => state.lock);
  const storeId = user?.storeId ?? '';
  const cacheRevision = useQueryCacheRefresh(['catalog_items', 'categories', 'stores', 'store_settings']);
  const preselectedCustomerId = new URLSearchParams(location.search).get('customer')?.trim() || customerIdFromState(location.state);
  const cart = useCartStore((state) => state.cart);
  const note = useCartStore((state) => state.note);
  const firstItemAddedAt = useCartStore((state) => state.firstItemAddedAt);
  const setCart = useCartStore((state) => state.setCart);
  const setOrderNote = useCartStore((state) => state.setNote);
  const clearOrder = useCartStore((state) => state.clearOrder);
  const restoreOrder = useCartStore((state) => state.restoreOrder);
  const [store, setStore] = useState<StoreRecord>();
  const [category, setCategory] = useState('all');
  const [openStockMenuItemId, setOpenStockMenuItemId] = useState<string | null>(null);
  const [catalogViewMode, setCatalogViewMode] = useState<CatalogViewMode>(() =>
    window.localStorage.getItem(POS_CATALOG_VIEW_MODE_KEY) === 'list' ? 'list' : 'grid',
  );
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<CartSnapshot | null>(null);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const [catalogRecords, setCatalogRecords] = useState<CatalogItemRecord[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [openShift, setOpenShift] = useState<ShiftRecord>();
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });
  const [orders, setOrders] = useState<(OrderRecord | OrderSummaryRecord)[]>([]);
  const [needsAttentionOrders, setNeedsAttentionOrders] = useState<Array<{ order: OrderRecord; message: string }>>([]);
  const [selectedItem, setSelectedItem] = useState<ProductView | null>(null);
  const [markedOutOfStockItem, setMarkedOutOfStockItem] = useState<ProductView | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [can86Items, setCan86Items] = useState(false);
  const [canUseTabs, setCanUseTabs] = useState(false);
  const [canOverrideCreditLimit, setCanOverrideCreditLimit] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerCreditStatuses, setCustomerCreditStatuses] = useState<Record<string, CustomerCreditStatus>>({});
  const [customerCreditUnavailable, setCustomerCreditUnavailable] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [creditOverrideOpen, setCreditOverrideOpen] = useState(false);
  const [creditOverridePin, setCreditOverridePin] = useState('');
  const [creditOverrideError, setCreditOverrideError] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(preselectedCustomerId);
  const [creditStatus, setCreditStatus] = useState<CustomerCreditStatus | null>(null);
  const [creditStatusCustomerId, setCreditStatusCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(preselectedCustomerId ? 'tab' : 'cash');
  const [ticketOrder, setTicketOrder] = useState<OrderRecord | null>(null);
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [completedOrderNotice, setCompletedOrderNotice] = useState('');
  const [compOpen, setCompOpen] = useState(false);
  const [compItemId, setCompItemId] = useState('');
  const [compQuantity, setCompQuantity] = useState('');
  const [compReason, setCompReason] = useState<CompReason>('dropped');
  const [compNote, setCompNote] = useState('');
  const [compSubmitting, setCompSubmitting] = useState(false);
  const [compError, setCompError] = useState('');
  const [staffDrinkAllowance, setStaffDrinkAllowance] = useState<StaffDrinkAllowance | null>(null);
  const undoTimeoutRef = useRef<number | undefined>(undefined);
  const refreshGuardRef = useRef(createLatestRequestGuard());
  const orderIdempotencyKeyRef = useRef<string | undefined>(undefined);
  const pendingOrderSubmissionsRef = useRef(new Set<string>());
  const syncedOrdersRef = useRef(new Map<string, OrderRecord>());
  const appliedPreselectionRef = useRef('');
  const categoryOptions = [{ id: 'all', name: t('pos.allItems'), icon: 'apps' }, ...categoryRecords];

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const searchInput = document.getElementById('pos-product-search');
      if (searchInput) {
        event.preventDefault();
        searchInput.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  async function lockTerminal() {
    try {
      await lock();
      navigate('/lock', { replace: true, state: { from: location.pathname } });
    } catch (lockError) {
      setToast(lockError instanceof Error ? lockError.message : 'Unable to lock the terminal.');
    }
  }

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const requestGeneration = refreshGuardRef.current.begin();
      setCatalogLoading(true);
      setCatalogError('');
      setCustomerCreditUnavailable(false);
      try {
        const [items, categories, shift, currentStore, todaysOrders, nextDayStatus] = await Promise.all([
          catalogService.listItems(storeId),
          catalogService.listCategories(storeId),
          user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
          storeId ? userService.getStore(storeId) : Promise.resolve(undefined),
          orderService.listTodaySummaries(storeId),
          reportService.getDayStatus(storeId),
        ]);
        if (!active || !refreshGuardRef.current.isLatest(requestGeneration)) return;

        let customerList: CustomerRecord[] = [];
        try {
          customerList = storeId ? await customerService.listCustomers(storeId) : [];
        } catch (customerError) {
          console.error('Unable to load POS customers; the catalog remains available.', customerError);
        }
        if (!active || !refreshGuardRef.current.isLatest(requestGeneration)) return;

        const permissionSet = new Set(permissions);
        const permission = user?.role === 'owner' || permissionSet.has('86_items');
        const compPermission = user?.role === 'owner' || permissionSet.has('comp_items');
        const tabsPermission = permissionSet.has('use_tabs');
        const overridePermission = permissionSet.has('tab_override_limit');
        const queuedOrders = await offlineOrderQueue.pendingOrders(storeId);
        const attentionOrders = await offlineOrderQueue.needsAttention(storeId);
        setCatalogRecords(items);
        setCategoryRecords(categories);
        setOpenShift(shift);
        setDayStatus(nextDayStatus);
        setStore(currentStore);
        setOrders([...todaysOrders, ...queuedOrders]);
        setCan86Items(permission);
        setCanUseTabs(user?.role === 'owner' || tabsPermission);
        setCanOverrideCreditLimit(user?.role === 'owner' || overridePermission);
        setCustomers(customerList);
        setCustomerCreditStatuses({});
        setNeedsAttentionOrders(attentionOrders);
        setCatalogLoading(false);

        const creditStatusResult = await loadCustomerCreditStatuses(
          () => customerService.getCreditStatuses(storeId, customerList),
        );
        setCustomerCreditStatuses(creditStatusResult.statuses);
        setCustomerCreditUnavailable(creditStatusResult.unavailable);
        if (user) {
          try {
            await offlineOrderQueue.cacheSnapshot({
              storeId,
              userId: user.id,
              items,
              categories,
              customers: customerList,
              creditStatuses: creditStatusResult.statuses,
              shift,
              store: currentStore,
              orders: todaysOrders,
              permissions: {
                can86Items: permission,
                canCompItems: compPermission,
                canUseTabs: user.role === 'owner' || tabsPermission,
                canOverrideCreditLimit: user.role === 'owner' || overridePermission,
              },
              cachedAt: new Date().toISOString(),
            });
          } catch (cacheError) {
            console.error('Unable to cache point-of-sale data for offline use.', cacheError);
          }
        }
      } catch (error) {
        console.error('Unable to load point-of-sale data.', error);
        if (user && (!navigator.onLine || offlineOrderQueue.isNetworkFailure(error))) {
          try {
            const snapshot = await offlineOrderQueue.getSnapshot(storeId, user.id);
            if (snapshot) {
              const [queuedOrders, attentionOrders] = await Promise.all([
                offlineOrderQueue.pendingOrders(storeId),
                offlineOrderQueue.needsAttention(storeId),
              ]);
              setCatalogRecords(snapshot.items);
              setCategoryRecords(snapshot.categories);
              setOpenShift(snapshot.shift);
              setStore(snapshot.store);
              setOrders([...snapshot.orders, ...queuedOrders]);
              setCustomers(snapshot.customers);
              setCustomerCreditStatuses(snapshot.creditStatuses);
              setCan86Items(snapshot.permissions.can86Items);
              setCanUseTabs(snapshot.permissions.canUseTabs);
              setCanOverrideCreditLimit(snapshot.permissions.canOverrideCreditLimit);
              setNeedsAttentionOrders(attentionOrders);
              setCatalogError('Offline mode: using the last saved POS data.');
              return;
            }
          } catch (cacheError) {
            console.error('Unable to load cached point-of-sale data.', cacheError);
          }
        }
        setCatalogError(t('common.refreshFailed'));
      } finally {
        setCatalogLoading(false);
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    const onQueueChanged = () => {
      void Promise.all([
        offlineOrderQueue.pendingOrders(storeId),
        offlineOrderQueue.needsAttention(storeId),
      ]).then(([queuedOrders, attentionOrders]) => {
        setOrders((current) => [...current.filter((order) => !order.syncStatus), ...queuedOrders]);
        setCompletedOrder((current) => current
          ? queuedOrders.find((order) => order.idempotencyKey === current.idempotencyKey) ?? current
          : current);
        setNeedsAttentionOrders(attentionOrders);
      }).catch((error: unknown) => {
        console.error('Unable to refresh the offline order queue.', error);
      });
    };
    const onOrderSynced = (event: Event) => {
      const { idempotencyKey, order } = (event as CustomEvent<{ idempotencyKey: string; order: OrderRecord }>).detail;
      if (pendingOrderSubmissionsRef.current.has(idempotencyKey)) {
        syncedOrdersRef.current.set(idempotencyKey, order);
      }
      setOrders((current) => [...current.filter((candidate) => candidate.idempotencyKey !== idempotencyKey), order]);
      setCompletedOrder((current) => current?.idempotencyKey === idempotencyKey ? order : current);
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
    window.addEventListener(OFFLINE_ORDER_SYNCED_EVENT, onOrderSynced);
    const unsubscribe = subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications', 'catalog_items', 'categories'], onFocus);
    const unsubscribeStoreSettings = subscribeToStoreChanges(storeId, ['stores', 'store_settings'], () => {
      void userService.getStore(storeId).then(setStore).catch((error: unknown) => {
        console.error('Unable to refresh store settings after a live update.', error);
      });
    });
    return () => {
      active = false;
      refreshGuardRef.current.begin();
      unsubscribe();
      unsubscribeStoreSettings();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
      window.removeEventListener(OFFLINE_ORDER_SYNCED_EVENT, onOrderSynced);
    };
  }, [cacheRevision, location.pathname, permissions, storeId, user]);

  useEffect(() => {
    if (!compOpen || compReason !== 'staff_drink' || !user?.id || !openShift || !compItemId) {
      setStaffDrinkAllowance(null);
      return;
    }
    let active = true;
    void compService.getStaffDrinkAllowance(storeId, user.id, openShift.id, compItemId).then((allowance) => {
      if (active) setStaffDrinkAllowance(allowance);
    }).catch((error: unknown) => {
      console.error('Unable to load the staff drink allowance.', error);
      if (active) setCompError('Unable to load the staff drink allowance. Please try again.');
    });
    return () => { active = false; };
  }, [compItemId, compOpen, compReason, openShift, storeId, user?.id]);

  useEffect(() => updateService.registerUnsavedState(() => cart.length > 0 || note.trim().length > 0), [cart.length, note]);

  useEffect(() => {
    if (!preselectedCustomerId || !canUseTabs || !customers.some((customer) => customer.id === preselectedCustomerId)) return;
    const preselectionKey = `${location.key}:${preselectedCustomerId}`;
    if (appliedPreselectionRef.current === preselectionKey) return;
    appliedPreselectionRef.current = preselectionKey;
    setSelectedCustomerId(preselectedCustomerId);
    setPaymentMethod('tab');
  }, [canUseTabs, customers, location.key, preselectedCustomerId]);

  useEffect(() => {
    if (paymentMethod === 'card' && !store?.allowCardPayments) setPaymentMethod('cash');
    else if (paymentMethod === 'other' && !store?.allowOtherPayments) setPaymentMethod('cash');
    else if (paymentMethod === 'tab' && !canUseTabs) setPaymentMethod('cash');
  }, [canUseTabs, paymentMethod, store?.allowCardPayments, store?.allowOtherPayments]);

  useEffect(() => () => {
    if (undoTimeoutRef.current !== undefined) window.clearTimeout(undoTimeoutRef.current);
  }, []);

  const allProducts = useMemo(() => catalogRecords.map(toProductView), [catalogRecords]);
  const cartQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const line of cart) quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);
    return quantities;
  }, [cart]);
  const productSearchIndex = useMemo(
    () => new Map(allProducts.map((item) => [item.id, item.name.toLocaleLowerCase()])),
    [allProducts],
  );
  const normalizedSearch = search.toLocaleLowerCase();
  const filteredItems = useMemo(() => allProducts.filter((item) =>
    (productSearchIndex.get(item.id) ?? '').includes(normalizedSearch) &&
    (category === 'all' || item.categoryId === category),
  ), [allProducts, category, normalizedSearch, productSearchIndex]);
  const quickPicks = useMemo(() => {
    const settings = resolveStoreSettings(store?.settings);
    if (settings.quickPickMode === 'manual') {
      const itemsById = new Map(allProducts.map((item) => [item.id, item]));
      return settings.quickPickItemIds.flatMap((itemId) => {
        const item = itemsById.get(itemId);
        return item ? [item] : [];
      });
    }
    const quantities = new Map<string, number>();
    for (const order of orders) {
      if (order.status !== 'done') continue;
      if (!('items' in order)) continue;
      for (const line of order.items) quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);
    }
    const soldItems = [...allProducts]
      .filter((item) => quantities.has(item.id))
      .sort((left, right) => (quantities.get(right.id) ?? 0) - (quantities.get(left.id) ?? 0));
    return (soldItems.length ? soldItems : allProducts).slice(0, 4);
  }, [allProducts, orders, store?.settings]);

  const totalMillimes = cart.reduce((sum, line) => sum + line.quantity * line.unitPriceMillimes, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const creditStatusPending = paymentMethod === 'tab' && Boolean(selectedCustomerId) && creditStatusCustomerId !== selectedCustomerId;
  const creditLimitExceeded = paymentMethod === 'tab' && creditStatusCustomerId === selectedCustomerId &&
    creditStatus?.limit !== undefined && creditStatus.balance > creditStatus.limit;
  const tabCheckoutBlocked = paymentMethod === 'tab' &&
    (!canUseTabs || !selectedCustomerId || creditStatusPending || (creditLimitExceeded && !canOverrideCreditLimit));
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const customerSearchIndex = useMemo(
    () => new Map(customers.map((customer) => [
      customer.id,
      `${customer.name} ${customer.phone ?? ''}`.toLocaleLowerCase(),
    ])),
    [customers],
  );
  const normalizedCustomerSearch = customerSearch.toLocaleLowerCase().trim();
  const filteredCustomers = useMemo(() => customers.filter((customer) =>
    (customerSearchIndex.get(customer.id) ?? '').includes(normalizedCustomerSearch),
  ), [customerSearchIndex, customers, normalizedCustomerSearch]);
  const selectedCustomerStatus = creditStatusCustomerId === selectedCustomerId ? creditStatus : null;
  const selectedCustomerRemaining = !selectedCustomerStatus
    ? 'Checking...'
    : selectedCustomerStatus.limit === undefined
      ? 'No limit'
      : `${formatTnd((selectedCustomerStatus.remaining ?? 0) / 1000)} DT left`;

  useEffect(() => {
    setCreditStatus(null);
    setCreditStatusCustomerId('');
    if (paymentMethod !== 'tab' || !selectedCustomerId) return;
    let active = true;
    void customerService.getCreditStatus(selectedCustomerId, totalMillimes).then((status) => {
      if (!active) return;
      setCreditStatus(status);
      setCreditStatusCustomerId(selectedCustomerId);
    }).catch((error: unknown) => {
      console.error('Unable to load customer credit status.', error);
      if (active) setToast('Unable to load customer credit status. Please try again.');
    });
    return () => { active = false; };
  }, [paymentMethod, selectedCustomerId, totalMillimes]);

  function addItem(item: ProductView) {
    if (item.outOfStock || item.stockCount === 0) return;
    if (!openShift) {
      setToast(t('pos.openShiftRequired'));
      window.setTimeout(() => setToast(''), 2500);
      return;
    }
    if (item.modifiers.length > 0) {
      setSelectedItem(item);
      setSelectedModifiers([]);
      return;
    }
    commitItem(item, []);
  }

  function commitItem(item: ProductView, modifierIds: string[]) {
    const selected = item.modifiers.filter((modifier) => modifierIds.includes(modifier.id));
    const modifiers = selected.map((modifier) => modifier.name);
    const modifierTotal = selected.reduce((sum, modifier) => sum + modifier.priceMillimes, 0);
    const lineId = `${item.id}:${selected.map((modifier) => modifier.id).sort().join(',')}`;
    const currentQuantity = cart.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
    if (item.stockCount !== null && currentQuantity >= item.stockCount) {
      setToast(t('pos.stockRemaining', { item: item.name, count: item.stockCount }));
      window.setTimeout(() => setToast(''), 2500);
      return;
    }
    setCart((lines) => {
      const existing = lines.find((line) => line.id === lineId);
      if (existing) return lines.map((line) => line.id === lineId ? { ...line, quantity: line.quantity + 1 } : line);
      const unitPriceMillimes = item.priceMillimes + modifierTotal;
      return [...lines, {
        id: lineId,
        itemId: item.id,
        name: item.name,
        quantity: 1,
        unitPrice: unitPriceMillimes / 1000,
        unitPriceMillimes,
        modifiers,
      }];
    });
    setSelectedItem(null);
  }

  function changeQuantity(id: string, delta: number) {
    setCart((lines) => lines
      .map((line) => line.id === id ? { ...line, quantity: line.quantity + delta } : line)
      .filter((line) => line.quantity > 0));
  }

  function changeProductQuantity(itemId: string, delta: number) {
    const line = [...cart].reverse().find((candidate) => candidate.itemId === itemId);
    if (line) changeQuantity(line.id, delta);
  }

  function incrementCartLine(line: CartLine) {
    const item = catalogRecords.find((candidate) => candidate.id === line.itemId);
    const quantity = cart.filter((candidate) => candidate.itemId === line.itemId).reduce((sum, candidate) => sum + candidate.quantity, 0);
    if (item?.stockCount !== null && item && quantity >= item.stockCount) {
      setToast(t('pos.stockRemaining', { item: item.name, count: item.stockCount }));
      window.setTimeout(() => setToast(''), 2500);
      return;
    }
    changeQuantity(line.id, 1);
  }

  async function toggleStock(item: ProductView) {
    if (!user) {
      setToast('Your account could not be loaded.');
      return false;
    }
    try {
      await catalogService.setOutOfStock(item.id, !item.outOfStock, { id: user.id, name: user.name });
      setCatalogRecords(await catalogService.listItems(storeId));
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('common.updateFailed'));
      return false;
    }
  }

  async function submitComp() {
    if (!user?.storeId || !openShift || !compItemId) {
      setCompError('Select an item and open your shift before recording a comp.');
      return;
    }
    const quantity = Number(compQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setCompError('Quantity must be a positive whole number.');
      return;
    }
    if (compReason === 'staff_drink') {
      if (user.role !== 'staff' || !staffDrinkAllowance?.allowed) {
        setCompError('This item is not allowed for staff drinks in your position.');
        return;
      }
      if (quantity > staffDrinkAllowance.remainingQuantity) {
        setCompError(`Allowed today: ${staffDrinkAllowance.usedQuantity} of ${staffDrinkAllowance.maxQuantity} used.`);
        return;
      }
    }
    setCompSubmitting(true);
    setCompError('');
    try {
      await compService.createComp({
        storeId: user.storeId,
        staffId: user.id,
        shiftId: openShift.id,
        itemId: compItemId,
        quantity,
        reason: compReason,
        note: compNote,
      });
    } catch (error) {
      setCompError(error instanceof Error ? error.message : 'Unable to record this comp.');
      setCompSubmitting(false);
      return;
    }
    setCompOpen(false);
    setCompNote('');
    setCompError('');
    setCompSubmitting(false);
    try {
      setCatalogRecords(await catalogService.listItems(storeId));
      setToast('Comp recorded. No sale was created.');
    } catch (refreshError) {
      setToast(`Comp recorded, but the catalog could not refresh: ${refreshError instanceof Error ? refreshError.message : 'Please reload the page.'}`);
    }
  }

  function clearCurrentOrder() {
    if (cart.length === 0 && !note.trim()) return;
    const snapshot: CartSnapshot = { cart, note, firstItemAddedAt };
    if (undoTimeoutRef.current !== undefined) window.clearTimeout(undoTimeoutRef.current);
    clearOrder();
    setClearConfirmationOpen(false);
    setToast('');
    setUndoSnapshot(snapshot);
    undoTimeoutRef.current = window.setTimeout(() => {
      setUndoSnapshot(null);
      undoTimeoutRef.current = undefined;
    }, 5000);
  }

  function cancelTabOrder() {
    if (undoTimeoutRef.current !== undefined) window.clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = undefined;
    setUndoSnapshot(null);
    clearOrder();
    setSelectedCustomerId('');
    setPaymentMethod('cash');
    setCustomerSearch('');
    setCustomerPickerOpen(false);
    setCreditOverrideOpen(false);
    setCreditOverridePin('');
    setCreditOverrideError('');
    setDrawerOpen(false);
    setToast('');
    navigate('/pos', { replace: true });
  }

  function undoClearOrder() {
    if (!undoSnapshot) return;
    if (undoTimeoutRef.current !== undefined) window.clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = undefined;
    restoreOrder(undoSnapshot);
    setUndoSnapshot(null);
    setToast('Order restored.');
    window.setTimeout(() => setToast(''), 2500);
  }

  async function finishOrder(adminPin?: string) {
    if (cart.length === 0) return;
    if (!user?.storeId) {
      setToast(t('pos.accountNotLinked'));
      return;
    }
    let order: OrderRecord;
    let orderNotice = '';
    const idempotencyKey = orderIdempotencyKeyRef.current ?? crypto.randomUUID();
    orderIdempotencyKeyRef.current = idempotencyKey;
    pendingOrderSubmissionsRef.current.add(idempotencyKey);
    try {
      const items: OrderLineRecord[] = cart.map((line) => ({
        itemId: line.itemId,
        name: line.name,
        quantity: line.quantity,
        unitPriceMillimes: line.unitPriceMillimes,
        lineTotalMillimes: line.quantity * line.unitPriceMillimes,
        modifiers: line.modifiers ?? [],
      }));
      order = await orderService.createOrder({
        storeId: user.storeId,
        staffId: user.id,
        items,
        paymentMethod,
        customerId: paymentMethod === 'tab' ? selectedCustomerId : undefined,
        note,
        adminPin,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof OrderNotificationError) {
        order = error.order;
        orderNotice = error.message;
      } else {
        if (error instanceof OrderServiceError && error.code === 'CREDIT_LIMIT') {
          orderIdempotencyKeyRef.current = undefined;
          pendingOrderSubmissionsRef.current.delete(idempotencyKey);
          if (canOverrideCreditLimit) {
            setCreditOverrideError('Limit reached. Tell the customer. Enter the Admin PIN to override.');
            setCreditOverrideOpen(true);
          } else {
            setToast('Limit reached. Tell the customer.');
            window.setTimeout(() => setToast(''), 3000);
          }
          return;
        }
        const message = error instanceof Error ? error.message : t('pos.cannotSaveOrder');
        orderIdempotencyKeyRef.current = undefined;
        pendingOrderSubmissionsRef.current.delete(idempotencyKey);
        if (creditOverrideOpen) setCreditOverrideError(message);
        else {
          setToast(message);
          window.setTimeout(() => setToast(''), 3000);
        }
        return;
      }
    }

    if (orderIdempotencyKeyRef.current === idempotencyKey) orderIdempotencyKeyRef.current = undefined;
    clearOrder();
    if (undoTimeoutRef.current !== undefined) window.clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = undefined;
    setUndoSnapshot(null);
    setDrawerOpen(false);
    setClearConfirmationOpen(false);
    setCreditOverrideOpen(false);
    setCreditOverridePin('');
    setCreditOverrideError('');
    if (order.syncStatus === 'queued') {
      setOrders((current) => [...current.filter((candidate) => candidate.id !== order.id), order]);
      orderNotice = paymentMethod === 'tab'
        ? 'Queued for sync. Customer credit will be verified when the connection returns.'
        : 'Queued for sync. The server will assign the final order number when the connection returns.';
    } else {
      try {
        setCatalogRecords(await catalogService.listItems(storeId));
        setOrders(await orderService.listTodaySummaries(storeId));
        const customerList = await customerService.listCustomers(storeId);
        const creditStatusResult = await loadCustomerCreditStatuses(
          () => customerService.getCreditStatuses(storeId, customerList),
        );
        setCustomers(customerList);
        setCustomerCreditStatuses(creditStatusResult.statuses);
        setCustomerCreditUnavailable(creditStatusResult.unavailable);
      } catch (refreshError) {
        orderNotice ||= `Order created, but the POS could not refresh: ${refreshError instanceof Error ? refreshError.message : 'Please reload the page.'}`;
      }
    }
    const syncedOrder = syncedOrdersRef.current.get(idempotencyKey);
    syncedOrdersRef.current.delete(idempotencyKey);
    if (syncedOrder) {
      order = syncedOrder;
      orderNotice = '';
      setOrders((current) => [...current.filter((candidate) => candidate.idempotencyKey !== idempotencyKey), order]);
    }
    setCompletedOrderNotice(orderNotice);
    setCompletedOrder(order);
    pendingOrderSubmissionsRef.current.delete(idempotencyKey);
    setPaymentMethod('cash');
    setSelectedCustomerId('');
  }

  const renderTicketContent = (compact = false) => (
    <div className={`pos-ticket-content flex min-h-0 flex-col ${compact ? 'h-full' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-body text-label-sm uppercase tracking-wider text-outline">{t('pos.currentOrder')}</p>
          <h2 className="font-display text-headline-md text-on-surface">{t('pos.orderTicket')}</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-surface-container-high px-2 py-1 font-body text-label-sm tabular-nums text-on-surface-variant" aria-label="Order elapsed time"><OrderElapsedTime startedAt={firstItemAddedAt} /></span>
          <span className="rounded-full bg-secondary-container px-2 py-1 font-body text-label-sm text-on-surface">
            {count} {t(count === 1 ? 'common.item' : 'common.items')}
          </span>
        </div>
      </div>
      <div className="mb-2 flex justify-end">
        <Button
          variant="ghost"
          className="min-h-9 px-2 text-label-sm text-error-dark"
          icon={<MaterialIcon name="delete_outline" className="text-base" />}
          disabled={cart.length === 0 && !note.trim()}
          onClick={() => setClearConfirmationOpen(true)}
        >
          Clear order
        </Button>
      </div>
      <div className={`pos-ticket-lines min-h-0 flex-1 overflow-y-auto ${compact ? 'max-h-[45vh]' : ''}`}>
        {cart.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center text-center text-outline">
            <MaterialIcon name="receipt_long" className="text-3xl" />
            <p className="mt-1 font-body text-body-sm">{t('pos.tapToAdd')}</p>
          </div>
        ) : cart.map((line) => (
          <TicketRow
            key={line.id}
            item={{ id: line.id, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, modifiers: line.modifiers }}
            onIncrement={() => incrementCartLine(line)}
            onDecrement={() => changeQuantity(line.id, -1)}
            onRemove={() => setCart((lines) => lines.filter((item) => item.id !== line.id))}
            largeButtons={largeButtons}
          />
        ))}
      </div>
      <label className="mt-2 block font-body text-label-sm text-on-surface-variant">
        Order note (optional)
        <input
          id="pos-product-search"
          value={note}
          onChange={(event) => setOrderNote(event.target.value)}
          maxLength={200}
          placeholder="e.g. no sugar, extra hot"
          className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
        />
      </label>
      <div className="mt-3 border-t border-outline-variant pt-3">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-body text-label-md text-on-surface-variant">{t('common.total')}</span>
          <span className="font-display text-currency-display-mobile text-on-surface">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md">DT</small></span>
        </div>
        <div className="mb-3">
          <p className="mb-1 font-body text-label-sm text-on-surface-variant">Payment method</p>
          <div role="group" aria-label="Payment method" className="flex rounded-xl bg-surface-container-low p-1">
            {([
              { value: 'cash', label: 'Cash' },
              ...(canUseTabs ? [{ value: 'tab', label: 'Customer tab' }] : []),
              ...(store?.allowCardPayments ? [{ value: 'card', label: 'Card' }] : []),
              ...(store?.allowOtherPayments ? [{ value: 'other', label: 'Other' }] : []),
            ] as { value: PaymentMethod; label: string }[]).map((method) => (
              <button
                key={method.value}
                type="button"
                aria-pressed={paymentMethod === method.value}
                onClick={() => {
                  setPaymentMethod(method.value);
                  if (method.value === 'tab') {
                    setCustomerSearch('');
                    setCustomerPickerOpen(true);
                  }
                }}
                className={`min-h-10 flex-1 rounded-lg px-2 font-body text-label-sm ${paymentMethod === method.value ? 'bg-surface-container-lowest text-primary shadow-card' : 'text-on-surface-variant'}`}
              >
                {method.label}
              </button>
            ))}
          </div>
        </div>
        {paymentMethod === 'tab' && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex max-w-full items-center rounded-full px-3 py-1.5 font-body text-label-sm ${selectedCustomer ? 'bg-secondary-container text-on-surface' : 'bg-surface-container-low text-outline'}`}>
              {selectedCustomer ? `${selectedCustomer.name} • ${selectedCustomerRemaining}` : 'Choose a customer'}
            </span>
            <button
              type="button"
              onClick={() => { setCustomerSearch(''); setCustomerPickerOpen(true); }}
              className="min-h-10 rounded-lg px-3 font-body text-label-sm text-primary underline underline-offset-2"
            >
              {selectedCustomer ? 'Change' : 'Choose customer'}
            </button>
          </div>
        )}
        {paymentMethod === 'tab' && selectedCustomerId && creditStatusCustomerId === selectedCustomerId && creditStatus && (
          <section className={`mb-3 rounded-lg p-3 font-body text-body-sm ${creditLimitExceeded ? 'bg-error-container text-on-error-container' : creditStatus.state === 'near' ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-low text-on-surface-variant'}`}>
            <p className="font-body text-label-md">Balance after this order: {formatTnd(Math.abs(creditStatus.balance) / 1000)} DT{creditStatus.balance < 0 ? ' credit' : ''}</p>
            {creditStatus.limit === undefined ? (
              <p className="mt-1">No credit limit set.</p>
            ) : (
              <>
                <div className="customer-credit-progress-track relative mt-2 h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={Math.min(100, Math.max(0, creditStatus.percentUsed ?? 0))} aria-valuemin={0} aria-valuemax={100} aria-label={`${Math.round(creditStatus.percentUsed ?? 0)} percent of credit limit used`}>
                  <span aria-hidden="true" className={`customer-credit-progress-fill ${getCustomerCreditTone(creditStatus.state, creditStatus.percentUsed).barClass}`} style={{ width: `${Math.min(100, Math.max(0, creditStatus.percentUsed ?? 0))}%` }} />
                </div>
                <p className="mt-1">{Math.round(creditStatus.percentUsed ?? 0)}% used · {formatTnd((creditStatus.remaining ?? 0) / 1000)} DT remaining</p>
              </>
            )}
            {creditLimitExceeded && (
              <div role="alert" className="mt-2">
                <p className="font-body text-label-md">Limit reached. Tell the customer.</p>
                {canOverrideCreditLimit && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setCreditOverrideError(''); setCreditOverridePin(''); setCreditOverrideOpen(true); }}
                    className="mt-2 w-full"
                  >
                    <MaterialIcon name="verified_user" />Override with Admin PIN
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        {creditStatusPending && <p role="status" className="mb-3 font-body text-body-sm text-outline">Checking customer credit…</p>}
        <Button onClick={() => { void finishOrder(); }} disabled={!cart.length || tabCheckoutBlocked} className="min-h-[54px] w-full rounded-xl text-body-lg">
          <MaterialIcon name="check_circle" className="text-xl text-white" />
          {paymentMethod === 'tab' && selectedCustomer ? `Charge to ${selectedCustomer.name}` : t('common.done')}
          <span className="ml-auto font-display tabular-nums">{formatTnd(totalMillimes / 1000)} DT</span>
        </Button>
        <p className="mt-1 text-center font-body text-body-sm text-on-surface-variant">{t('pos.paidOutsideApp')}</p>
      </div>
    </div>
  );

  return (
    <div className="pos-screen bg-surface">
      <TopBar
        title={t('pos.terminal')}
        storeName={store?.name}
        storeLogoId={resolveStoreSettings(store?.settings).storeLogoId}
        storeType={resolveStoreSettings(store?.settings).storeType}
        onDashboardClick={() => navigate(user?.role === 'owner' ? '/owner/dashboard' : '/dashboard')}
        onLockClick={user?.role === 'staff' ? () => { void lockTerminal(); } : undefined}
      />
      <div className="pos-alert-stack">
        {!openShift && dayStatus.dayIsClosed && (
          <section role="status" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-container p-3 text-on-warning-container">
            <p className="font-body text-body-sm">Day closed. Open a shift to start a new day.</p>
            <Button type="button" onClick={() => navigate(user?.role === 'owner' ? '/owner/shifts' : '/shift')}>
              <MaterialIcon name="lock_open" />Open shift
            </Button>
          </section>
        )}
        <FirstRunHint id={`pos-${user?.id ?? 'guest'}`} title={t('hint.title')} message={t('hint.pos')} />
        {user?.role === 'owner' && needsAttentionOrders.length > 0 && (
          <section aria-label="Needs attention" className="mx-3 mt-3 rounded-xl border border-error/30 bg-error-container p-3 text-on-error-container">
            <h2 className="font-display text-headline-sm">Needs attention ({needsAttentionOrders.length})</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {needsAttentionOrders.map(({ order, message }) => (
                <li key={order.idempotencyKey ?? order.id} className="rounded-lg bg-surface-container-lowest/70 p-3">
                  <p className="font-body text-label-md">Local order {Math.abs(order.number)} · {formatTnd(order.totalMillimes / 1000)} DT</p>
                  <p className="mt-1 font-body text-body-sm">{message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <main className="pos-terminal-layout">
        <section className="pos-products-pane min-w-0 pb-4">
          <div className="pos-catalog-controls flex flex-col gap-3 px-3 pt-3">
            <label className="relative block">
              <MaterialIcon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-outline" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('pos.searchPlaceholder')}
                className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <div className="pos-category-list scrollbar-hidden -mx-3 flex gap-2 overflow-x-auto px-3 py-0.5">
              {categoryOptions.map((item) => (
                <Chip key={item.id} selected={category === item.id} onClick={() => setCategory(item.id)}>
                  {item.id === 'all' ? <MaterialIcon name={item.icon} className="text-lg" filled={category === item.id} /> : <ItemLogo id={item.icon} size="sm" />}
                  {item.name}
                </Chip>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              {openShift ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 font-body text-label-sm text-on-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success-dark" />
                  {t('pos.shiftOpenSince', { time: new Date(openShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
                </span>
              ) : (
                <button type="button" onClick={() => navigate(user?.role === 'owner' ? '/owner/shifts' : '/shift')} className="inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 font-body text-label-sm text-on-error-container">
                  <span className="h-1.5 w-1.5 rounded-full bg-error-dark" />
                  {t('pos.shiftRequired')}
                </button>
              )}
              <button
                type="button"
                aria-label={t('pos.listView')}
                aria-pressed={catalogViewMode === 'list'}
                title={t(catalogViewMode === 'grid' ? 'pos.switchToListView' : 'pos.switchToGridView')}
                onClick={() => {
                  const nextViewMode = catalogViewMode === 'grid' ? 'list' : 'grid';
                  window.localStorage.setItem(POS_CATALOG_VIEW_MODE_KEY, nextViewMode);
                  setCatalogViewMode(nextViewMode);
                }}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition ${
                  catalogViewMode === 'grid' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-primary'
                }`}
              >
                <MaterialIcon name={catalogViewMode === 'grid' ? 'grid_view' : 'view_list'} className="text-xl" />
              </button>
            </div>
          </div>

          <div className="pos-catalog-scroll-area">
            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between px-3">
                <h2 className="flex items-center gap-1.5 font-display text-headline-sm text-primary">
                  <MaterialIcon name="bolt" className="text-lg text-secondary" filled />
                  {t('pos.quickPicks')}
                </h2>
                <span className="font-body text-label-sm text-outline">
                  {resolveStoreSettings(store?.settings).quickPickMode === 'manual' ? 'Admin selected' : t('pos.highVelocity')}
                </span>
              </div>
              <div className="scrollbar-hidden flex gap-2.5 overflow-x-auto px-3 pb-1">
                {quickPicks.map((item) => {
                  const quantity = cartQuantities.get(item.id) ?? 0;
                  return (
                    <article key={item.id} className={`flex ${largeButtons ? 'min-h-40 w-40' : 'min-h-32 w-36'} shrink-0 flex-col justify-between rounded-2xl bg-surface-container-lowest p-3 text-left shadow-card`}>
                      <button type="button" aria-label={t('pos.addItem', { item: item.name })} onClick={() => addItem(item)} className="flex min-h-0 flex-1 flex-col justify-between text-left active:scale-[0.98]">
                        <div className="flex items-start justify-between">
                          <span className="relative">
                            <ItemLogo id={item.icon} size="sm" />
                            {quantity > 0 && <span className="pos-cart-count-badge">{quantity}</span>}
                          </span>
                        </div>
                        <div className="mt-2">
                          <p className="truncate font-body text-label-md text-on-surface">{item.name}</p>
                          <p className="font-display text-headline-sm text-primary">{formatTnd(item.priceMillimes / 1000)} <small className="font-body text-label-sm text-outline">DT</small></p>
                        </div>
                      </button>
                      {quantity > 0 && !item.outOfStock && (
                        <div className={`pos-quantity-controls mt-1 flex items-center justify-between rounded-lg bg-surface-container-low p-0.5 ${largeButtons ? 'pos-quantity-controls--large' : ''}`}>
                          <button type="button" aria-label={t('pos.removeItem', { item: item.name })} onClick={() => changeProductQuantity(item.id, -1)} className={`flex ${largeButtons ? 'h-14 w-14' : 'h-7 w-7'} items-center justify-center rounded-lg bg-surface-container-lowest text-primary`}>
                            <MaterialIcon name={quantity === 1 ? 'delete' : 'remove'} className="text-sm" />
                          </button>
                          <span className="font-display text-label-lg text-primary">{quantity}</span>
                          <button type="button" aria-label={t('pos.addItem', { item: item.name })} onClick={() => addItem(item)} className={`flex ${largeButtons ? 'h-14 w-14' : 'h-7 w-7'} items-center justify-center rounded-lg bg-primary text-on-primary`}>
                            <MaterialIcon name="add" className="text-sm" />
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="mt-4 px-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-headline-sm text-on-surface">{t('pos.catalogueItems')}</h2>
                <span className="font-body text-label-sm text-outline">{t('pos.touchToAdd')}</span>
              </div>
              {catalogError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{catalogError}</p>}
              {customerCreditUnavailable && (
                <p role="status" className="mb-3 rounded-lg bg-warning-container px-3 py-2 font-body text-label-sm text-on-warning-container">
                  Customer credit balances are unavailable; customer selection is still available.
                </p>
              )}
              {catalogLoading ? <ListSkeleton rows={4} label="Loading products" /> : filteredItems.length === 0 ? (
                <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">
                  {search ? 'No products match your search.' : 'No products are available yet.'}
                </p>
              ) : <div className={`pos-catalog-grid grid grid-cols-2 gap-3 xl:grid-cols-3${catalogViewMode === 'list' ? ' pos-catalog-grid--list' : ''}`}>
                <LazyBatch
                  items={filteredItems}
                  resetKey={search}
                  renderItem={(item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      quantity={cartQuantities.get(item.id) ?? 0}
                      onAdd={() => addItem(item)}
                      onRemove={() => changeProductQuantity(item.id, -1)}
                      canToggleStock={user?.role === 'owner' || can86Items}
                      onToggleStock={() => { void toggleStock(item); }}
                      onOpenOutOfStock={() => setMarkedOutOfStockItem(item)}
                      largeButtons={largeButtons}
                      viewMode={catalogViewMode}
                      stockMenuOpen={openStockMenuItemId === item.id}
                      onStockMenuToggle={() =>
                        setOpenStockMenuItemId((currentItemId) => currentItemId === item.id ? null : item.id)
                      }
                    />
                  )}
                />
              </div>}
            </section>
          </div>
        </section>

        <aside className="pos-order-pane hidden border-l border-outline-variant bg-surface-container-lowest p-4 tablet:block">
          {renderTicketContent(true)}
        </aside>
      </main>

      <div className={`pos-mobile-action-bar fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 bg-surface-container-lowest/95 px-3 py-2.5 shadow-sheet backdrop-blur-xl tablet:hidden ${largeButtons ? 'pos-mobile-action-bar--large' : ''}`}>
        <button type="button" onClick={() => setDrawerOpen(true)} className="min-w-0 text-left">
          <span className="block">
            <span className="flex items-center gap-1.5 font-body text-label-sm uppercase text-outline">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-1 text-on-surface">{count}</span>
              {t('pos.currentOrder')}
            </span>
            <span className="font-display text-currency-display-mobile text-primary">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md text-on-surface">DT</small></span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {canUseTabs && (paymentMethod === 'tab' && selectedCustomer ? (
            <Button
              variant="danger"
              onClick={cancelTabOrder}
              aria-label="Cancel customer order"
              className="!bg-red-600 !text-white hover:!bg-red-700 active:!bg-red-800 !h-[52px] !min-h-[52px] !w-[52px] !min-w-[52px] !p-0 rounded-full"
            >
              <MaterialIcon name="close" className="text-3xl !text-white" />
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => { setPaymentMethod('tab'); setCustomerSearch(''); setCustomerPickerOpen(true); }}
              className="min-h-[52px] rounded-2xl px-3 text-label-sm"
            >
              <MaterialIcon name="person_add" className="text-lg" />
              Add to tab
            </Button>
          ))}
          <Button variant="success" onClick={() => { void finishOrder(); }} disabled={!cart.length || tabCheckoutBlocked} className="min-h-[52px] rounded-2xl px-3 text-label-sm">
            <MaterialIcon name="check_circle" className="text-lg text-white" />
            <span className="max-w-[38vw] truncate">{paymentMethod === 'tab' && selectedCustomer ? `Charge to ${selectedCustomer.name}` : t('common.done')}</span>
          </Button>
        </div>
      </div>

      {ticketOrder && <TicketView order={ticketOrder} storeName={store?.name ?? t('pos.cafe')} staffName={user?.name ?? t('common.staff')} onClose={() => setTicketOrder(null)} settings={store?.settings} storeAddress={store?.address} storePhone={store?.phone} storeTaxId={store?.taxId} />}
      <BottomSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('pos.currentOrder')}>
        {renderTicketContent(true)}
      </BottomSheet>
      <BottomSheet open={clearConfirmationOpen} onClose={() => setClearConfirmationOpen(false)} title="Clear order">
        <p className="mb-4 font-body text-body-md text-on-surface-variant">
          Clear {count} {count === 1 ? 'item' : 'items'}?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setClearConfirmationOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={clearCurrentOrder}>Clear</Button>
        </div>
      </BottomSheet>
      <BottomSheet open={completedOrder !== null} onClose={() => setCompletedOrder(null)} title="Order complete">
        {completedOrder && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl bg-success-container p-4 text-on-success-container">
              <MaterialIcon name="check_circle" className="text-3xl" />
              <div>
                <p className="font-display text-headline-sm">
                  {completedOrder.syncStatus ? `Local order ${Math.abs(completedOrder.number)}` : `Order #${completedOrder.number}`}
                </p>
                <p className="font-body text-body-md">Total: {formatTnd(completedOrder.totalMillimes / 1000)} DT</p>
              </div>
              {completedOrder.syncStatus === 'queued' && <span className="rounded-full bg-warning px-2 py-1 font-body text-label-sm text-on-warning">Queued</span>}
              {completedOrder.syncStatus === 'needs_attention' && <span className="rounded-full bg-error px-2 py-1 font-body text-label-sm text-white">Needs attention</span>}
              {completedOrder.verificationStatus === 'to_verify' && <span className="rounded-full bg-warning-container px-2 py-1 font-body text-label-sm text-on-warning-container">To verify</span>}
            </div>
            {completedOrderNotice && <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">{completedOrderNotice}</p>}
            <Button
              variant="secondary"
              onClick={() => {
                setTicketOrder(completedOrder);
                setCompletedOrder(null);
              }}
            >
              <MaterialIcon name="receipt" />View receipt
            </Button>
            <Button onClick={() => { setCompletedOrder(null); setCompletedOrderNotice(''); }}>
              <MaterialIcon name="add" />New order
            </Button>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={customerPickerOpen} onClose={() => setCustomerPickerOpen(false)} title="Choose customer" panelClassName="h-[60dvh]">
        <div className="flex flex-col gap-2 px-2 pt-2">
          <label className="relative block">
            <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline" />
            <input
              autoFocus
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Search customers..."
              className="h-11 w-full rounded-lg bg-surface-container-low pl-10 pr-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          {filteredCustomers.map((customer) => (
            <CustomerCreditOption
              key={customer.id}
              customer={customer}
              status={customerCreditStatuses[customer.id]}
              selected={selectedCustomerId === customer.id}
              canOverrideCreditLimit={canOverrideCreditLimit}
              onSelect={() => {
                setSelectedCustomerId(customer.id);
                setPaymentMethod('tab');
                setCustomerPickerOpen(false);
                setCreditOverridePin('');
                setCreditOverrideError('');
              }}
            />
          ))}
          {filteredCustomers.length === 0 && (
            <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-outline">
              {customers.length === 0 ? 'No active customers.' : 'No customers match your search.'}
            </p>
          )}
        </div>
      </BottomSheet>
      <BottomSheet open={creditOverrideOpen} onClose={() => setCreditOverrideOpen(false)} title="Override credit limit">
        <div className="flex flex-col gap-3">
          <p className="font-body text-body-sm text-on-surface-variant">
            Limit reached. Tell the customer. Enter the Admin PIN to charge {selectedCustomer?.name ?? 'this customer'} {formatTnd(totalMillimes / 1000)} DT to their tab.
          </p>
          <p className="text-center font-body text-label-sm text-outline" aria-label={`${creditOverridePin.length} of 4 PIN digits entered`}>
            {creditOverridePin.length} of 4 PIN digits entered
          </p>
          <Keypad
            onPress={(digit) => setCreditOverridePin((value) => value.length < 4 ? `${value}${digit}` : value)}
            onClear={() => setCreditOverridePin('')}
            onBackspace={() => setCreditOverridePin((value) => value.slice(0, -1))}
          />
          {creditOverrideError && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{creditOverrideError}</p>}
          <Button type="button" disabled={creditOverridePin.length !== 4} onClick={() => { void finishOrder(creditOverridePin); }} className="w-full">
            Override and complete order
          </Button>
        </div>
      </BottomSheet>
      <BottomSheet open={selectedItem !== null} onClose={() => setSelectedItem(null)} title={selectedItem?.name ?? ''}>
        {selectedItem && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-body text-label-lg text-on-surface">{selectedItem.modifierGroupName || t('catalog.modifiers')}</p>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                {selectedItem.modifiersRequired ? selectedItem.modifierSelectionMode === 'single' ? 'Choose one option to continue.' : 'Select at least one option to continue.' : selectedItem.modifierSelectionMode === 'single' ? 'Choose one option, if wanted.' : 'Choose any options you want.'}
              </p>
            </div>
            {selectedItem.modifiers.map((modifier) => {
              const active = selectedModifiers.includes(modifier.id);
              const singleSelection = selectedItem.modifierSelectionMode === 'single';
              return (
                <button key={modifier.id} type="button" aria-pressed={active} onClick={() => setSelectedModifiers((values) => active ? values.filter((value) => value !== modifier.id) : singleSelection ? [modifier.id] : [...values, modifier.id])} className={`flex min-h-12 items-center justify-between rounded-xl px-4 font-body text-label-md ${active ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface'}`}>
                  <span>{modifier.name}</span>
                  <span>{modifier.priceMillimes ? `+${formatTnd(modifier.priceMillimes / 1000)} DT` : t('common.noCharge')}</span>
                </button>
              );
            })}
            <Button disabled={Boolean(selectedItem.modifiersRequired && selectedModifiers.length === 0)} onClick={() => commitItem(selectedItem, selectedModifiers)}>{t('pos.addToOrder')}</Button>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={compOpen} onClose={() => setCompOpen(false)} title="Comp / waste">
        <div className="flex flex-col gap-3">
          {!openShift && <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">Open your shift before recording a comp.</p>}
          <label className="font-body text-label-md text-on-surface">Item
            <select value={compItemId} onChange={(event) => { setCompItemId(event.target.value); setCompError(''); }} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
              <option value="">Select an item</option>
              {catalogRecords.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="font-body text-label-md text-on-surface">Quantity
            <input type="number" min="1" step="1" required value={compQuantity} onChange={(event) => { setCompQuantity(event.target.value); setCompError(''); }} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md text-on-surface">Reason
            <select value={compReason} onChange={(event) => { setCompReason(event.target.value as CompReason); setCompError(''); }} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
              <option value="dropped">Dropped</option>
              <option value="staff_drink">Staff drink</option>
              <option value="free_customer">Free customer</option>
              <option value="remake">Remake</option>
              <option value="other">Other</option>
            </select>
          </label>
          {compReason === 'staff_drink' && user?.role === 'staff' && (
            <div className="rounded-lg bg-primary-fixed/40 p-3 font-body text-body-sm text-on-surface">
              {staffDrinkAllowance
                ? <>
                    <p className="font-semibold">Allowed today: {staffDrinkAllowance.usedQuantity} of {staffDrinkAllowance.maxQuantity} used</p>
                    {!staffDrinkAllowance.allowed && <p className="mt-1">This item is not allowed for staff drinks in your position.</p>}
                    {staffDrinkAllowance.allowed && staffDrinkAllowance.remainingQuantity > 0 && <p className="mt-1">{staffDrinkAllowance.remainingQuantity} remaining this shift.</p>}
                  </>
                : 'Checking staff drink allowance…'}
            </div>
          )}
          {compReason === 'staff_drink' && user?.role !== 'staff' && (
            <p className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">Staff drink allowances apply to staff positions only.</p>
          )}
          <label className="font-body text-label-md text-on-surface">Note (optional)
            <textarea maxLength={500} rows={3} value={compNote} onChange={(event) => setCompNote(event.target.value)} className="mt-1 w-full resize-y rounded-lg bg-surface-container-low px-3 py-2 font-body text-body-md outline-none focus:ring-2 focus:ring-primary" />
          </label>
          {compError && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{compError}</p>}
          <Button
            type="button"
            disabled={compSubmitting || !openShift || !compItemId ||
              (compReason === 'staff_drink' && (user?.role !== 'staff' || !staffDrinkAllowance?.allowed || Number(compQuantity) > (staffDrinkAllowance?.remainingQuantity ?? 0)))}
            onClick={() => { void submitComp(); }}
          >
            <MaterialIcon name="delete_sweep" />
            {compSubmitting ? 'Recording…' : 'Record comp'}
          </Button>
          <p className="text-center font-body text-body-sm text-outline">Stock is reduced. This item will not be added to sales.</p>
        </div>
      </BottomSheet>
      <BottomSheet open={markedOutOfStockItem !== null} onClose={() => setMarkedOutOfStockItem(null)} title="86 item">
        {markedOutOfStockItem && (
          <div className="flex flex-col gap-3">
            <p className="font-body text-body-md text-on-surface">
              Marked 86 by {markedOutOfStockItem.outOfStockBy ?? 'Unknown staff'} at {formatOutOfStockTime(markedOutOfStockItem.outOfStockAt)}.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMarkedOutOfStockItem(null)}>Close</Button>
              {(user?.role === 'owner' || can86Items) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (markedOutOfStockItem) void toggleStock(markedOutOfStockItem).then((updated) => {
                      if (updated) setMarkedOutOfStockItem(null);
                    });
                  }}
                >
                  <MaterialIcon name="check" />Mark available
                </Button>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
      {undoSnapshot ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-4 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay tablet:bottom-6">
          <span>Order cleared.</span>
          <button type="button" onClick={undoClearOrder} className="font-body text-label-lg underline underline-offset-2">Undo</button>
        </div>
      ) : toast && <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{toast}</div>}
    </div>
  );
}

function CustomerCreditOption({ customer, status, selected, canOverrideCreditLimit, onSelect }: {
  customer: CustomerRecord;
  status?: CustomerCreditStatus;
  selected: boolean;
  canOverrideCreditLimit: boolean;
  onSelect: () => void;
}) {
  const percent = Math.min(100, Math.max(0, status?.percentUsed ?? 0));
  const progressTone = status ? getCustomerCreditTone(status.state, percent).barClass : 'bg-surface-container-high';
  const overLimit = status?.limit !== undefined && status.balance > status.limit;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!status || (overLimit && !canOverrideCreditLimit)}
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${overLimit ? 'border-error-dark bg-error-container text-on-error-container' : selected ? 'border-primary bg-primary-fixed' : 'border-outline-variant bg-surface-container-lowest'}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <strong className={`block truncate font-body text-label-md ${overLimit ? 'text-on-error-container' : 'text-on-surface'}`}>{customer.name}</strong>
          <span className={`mt-1 block font-body text-label-sm ${overLimit ? 'text-on-error-container' : 'text-on-surface-variant'}`}>
            {status
              ? `Balance ${formatTnd(Math.abs(status.balance) / 1000)} DT${status.balance < 0 ? ' credit' : ''}`
              : 'Checking balance…'}
          </span>
        </span>
        <span className={`shrink-0 text-right font-body text-label-sm ${overLimit ? 'text-error-dark' : 'text-on-surface-variant'}`}>
          {status?.limit === undefined
            ? status ? 'No limit' : 'Checking…'
            : `${formatTnd((status.remaining ?? 0) / 1000)} DT remaining`}
        </span>
      </span>
      <span className="customer-credit-progress-track relative mt-2 block h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${customer.name} credit used`}>
        <span aria-hidden="true" className={`customer-credit-progress-fill ${progressTone}`} style={{ width: `${percent}%` }} />
      </span>
      {overLimit && <span className="mt-1 block font-body text-label-sm text-error-dark">Over credit limit</span>}
    </button>
  );
}
