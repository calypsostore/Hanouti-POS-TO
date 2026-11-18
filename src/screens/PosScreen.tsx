import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ItemCard, type ItemCardItem } from '../components/ItemCard';
import { MaterialIcon } from '../components/MaterialIcon';
import { TicketRow, type TicketLine } from '../components/TicketRow';
import { TopBar } from '../components/TopBar';
import { TicketView } from '../components/TicketView';
import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { updateService } from '../services/updateService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord, CustomerRecord, OrderLineRecord, OrderRecord, PaymentMethod, ShiftRecord, StoreRecord } from '../types/domain';
import { customerService } from '../services/customerService';

interface CartLine extends TicketLine {
  itemId: string;
  unitPriceMillimes: number;
}

interface ProductView extends ItemCardItem {
  priceMillimes: number;
  categoryId: string;
  stockCount: number | null;
  modifiers: CatalogModifierRecord[];
  modifierGroupName?: string;
  modifiersRequired?: boolean;
  modifierSelectionMode?: 'single' | 'multiple';
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
    modifiers: item.modifiers ?? [],
    modifierGroupName: item.modifierGroupName,
    modifiersRequired: item.modifiersRequired,
    modifierSelectionMode: item.modifierSelectionMode,
  };
}

export function PosScreen() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [catalogRecords, setCatalogRecords] = useState<CatalogItemRecord[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [openShift, setOpenShift] = useState<ShiftRecord>();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [selectedItem, setSelectedItem] = useState<ProductView | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [can86Items, setCan86Items] = useState(false);
  const [canUseTabs, setCanUseTabs] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [ticketOrder, setTicketOrder] = useState<OrderRecord | null>(null);
  const categoryOptions = [{ id: 'all', name: t('pos.allItems'), icon: 'apps' }, ...categoryRecords];

  useEffect(() => {
    const refresh = async () => {
      try {
        const [items, categories, shift, currentStore, todaysOrders, permission, tabsPermission, customerList] = await Promise.all([
          catalogService.listItems(storeId),
          catalogService.listCategories(storeId),
          user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
          storeId ? userService.getStore(storeId) : Promise.resolve(undefined),
          orderService.listAll(storeId),
          user ? userService.hasPermission(user.id, '86_items') : Promise.resolve(false),
          user ? userService.hasPermission(user.id, 'use_tabs') : Promise.resolve(false),
          storeId ? customerService.listCustomers(storeId) : Promise.resolve([]),
        ]);
        setCatalogRecords(items);
        setCategoryRecords(categories);
        setOpenShift(shift);
        setStore(currentStore);
        setOrders(todaysOrders);
        setCan86Items(permission);
        setCanUseTabs(tabsPermission);
        setCustomers(customerList);
      } catch (error) {
        setToast(error instanceof Error ? error.message : t('common.refreshFailed'));
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [storeId, user, location.pathname]);

  useEffect(() => updateService.registerUnsavedState(() => cart.length > 0), [cart.length]);

  const allProducts = useMemo(() => catalogRecords.map(toProductView), [catalogRecords]);
  const filteredItems = useMemo(() => allProducts.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (category === 'all' || item.categoryId === category),
  ), [allProducts, category, search]);
  const quickPicks = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const order of orders) {
      if (order.status !== 'done') continue;
      for (const line of order.items) quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);
    }
    const soldItems = [...allProducts]
      .filter((item) => quantities.has(item.id))
      .sort((left, right) => (quantities.get(right.id) ?? 0) - (quantities.get(left.id) ?? 0));
    return (soldItems.length ? soldItems : allProducts).slice(0, 4);
  }, [allProducts, orders]);

  const totalMillimes = cart.reduce((sum, line) => sum + line.quantity * line.unitPriceMillimes, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

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
    try {
      await catalogService.setOutOfStock(item.id, !item.outOfStock);
      setCatalogRecords(await catalogService.listItems(storeId));
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('common.updateFailed'));
    }
  }

  async function finishOrder() {
    if (cart.length === 0) return;
    if (!user?.storeId) {
      setToast(t('pos.accountNotLinked'));
      return;
    }
    try {
      const items: OrderLineRecord[] = cart.map((line) => ({
        itemId: line.itemId,
        name: line.name,
        quantity: line.quantity,
        unitPriceMillimes: line.unitPriceMillimes,
        lineTotalMillimes: line.quantity * line.unitPriceMillimes,
        modifiers: line.modifiers ?? [],
      }));
      const order = await orderService.createOrder({
        storeId: user.storeId,
        staffId: user.id,
        items,
        paymentMethod,
        customerId: paymentMethod === 'tab' ? selectedCustomerId : undefined,
      });
      setCart([]);
      setDrawerOpen(false);
      setCatalogRecords(await catalogService.listItems(storeId));
      setOrders(await orderService.listAll(storeId));
      setToast(t('pos.orderDone'));
      setTicketOrder(order);
      setPaymentMethod('cash');
      setSelectedCustomerId('');
      window.setTimeout(() => setToast(''), 2500);
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('pos.cannotSaveOrder'));
      window.setTimeout(() => setToast(''), 3000);
    }
  }

  const renderTicketContent = (compact = false) => (
    <div className={`flex flex-col ${compact ? 'h-full' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-body text-label-sm uppercase tracking-wider text-outline">{t('pos.currentOrder')}</p>
          <h2 className="font-display text-headline-md text-on-surface">{t('pos.orderTicket')}</h2>
        </div>
        <span className="rounded-full bg-secondary-container px-2.5 py-1 font-body text-label-sm text-on-surface">
          {count} {t(count === 1 ? 'common.item' : 'common.items')}
        </span>
      </div>
      <div className={`min-h-24 flex-1 overflow-y-auto ${compact ? 'max-h-[45vh]' : ''}`}>
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
          />
        ))}
      </div>
      <div className="mt-3 border-t border-outline-variant pt-3">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-body text-label-md text-on-surface-variant">{t('common.total')}</span>
          <span className="font-display text-currency-display-mobile text-on-surface">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md">DT</small></span>
        </div>
        {canUseTabs && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="font-body text-label-sm text-on-surface-variant">
              Payment
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-2 text-on-surface">
                <option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option><option value="tab">Customer tab</option>
              </select>
            </label>
            {paymentMethod === 'tab' && (
              <label className="font-body text-label-sm text-on-surface-variant">
                Customer
                <select required value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-2 text-on-surface">
                  <option value="">Select customer</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        <Button onClick={finishOrder} disabled={!cart.length} className="min-h-[54px] w-full rounded-xl text-body-lg">
          <MaterialIcon name="check_circle" className="text-xl" />
          {t('common.done')} <span className="ml-auto font-display tabular-nums">{formatTnd(totalMillimes / 1000)} DT</span>
        </Button>
        <p className="mt-1 text-center font-body text-body-sm text-on-surface-variant">{t('pos.paidOutsideApp')}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface pb-36 tablet:pb-20">
      <TopBar title={t('pos.terminal')} storeName={store?.name} />
      <div className="flex items-center justify-between gap-2 bg-surface-container-low px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1 truncate font-display text-headline-sm text-primary">
            <MaterialIcon name="storefront" className="text-lg" filled />
            {store?.name ?? t('pos.cafe')}
          </h2>
          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-label-sm ${openShift ? 'bg-success text-on-surface' : 'bg-error-container text-on-error-container'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${openShift ? 'bg-success-dark' : 'bg-error-dark'}`} />
            {openShift ? t('pos.shiftOpenSince', { time: new Date(openShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('pos.shiftRequired')}
          </span>
        </div>
      </div>

      <main className="grid tablet:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.9fr)]">
        <section className="min-w-0 pb-4">
          <div className="flex flex-col gap-3 px-3 pt-3">
            <label className="relative block">
              <MaterialIcon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-outline" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('pos.searchPlaceholder')}
                className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <div className="scrollbar-hidden -mx-3 flex gap-2 overflow-x-auto px-3 py-0.5">
              {categoryOptions.map((item) => (
                <Chip key={item.id} selected={category === item.id} onClick={() => setCategory(item.id)}>
                  <MaterialIcon name={item.icon} className="text-lg" filled={category === item.id} />
                  {item.name}
                </Chip>
              ))}
            </div>
          </div>

          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between px-3">
              <h2 className="flex items-center gap-1.5 font-display text-headline-sm text-primary">
                <MaterialIcon name="bolt" className="text-lg text-secondary" filled />
                {t('pos.quickPicks')}
              </h2>
              <span className="font-body text-label-sm text-outline">{t('pos.highVelocity')}</span>
            </div>
            <div className="scrollbar-hidden flex gap-2.5 overflow-x-auto px-3 pb-1">
              {quickPicks.map((item) => (
                <button key={item.id} type="button" onClick={() => addItem(item)} className="flex min-h-32 w-36 shrink-0 flex-col justify-between rounded-2xl bg-surface-container-lowest p-3 text-left shadow-card active:scale-[0.98]">
                  <div className="flex items-start justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-container text-primary"><MaterialIcon name={item.icon} className="text-xl" /></span>
                  </div>
                  <div className="mt-2">
                    <p className="truncate font-body text-label-md text-on-surface">{item.name}</p>
                    <p className="font-display text-headline-sm text-primary">{formatTnd(item.priceMillimes / 1000)} <small className="font-body text-label-sm text-outline">DT</small></p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 px-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-headline-sm text-on-surface">{t('pos.catalogueItems')}</h2>
              <span className="font-body text-label-sm text-outline">{t('pos.touchToAdd')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {filteredItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={{ id: item.id, name: item.name, price: item.priceMillimes / 1000, icon: item.icon, outOfStock: item.outOfStock }}
                  quantity={cart.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0)}
                  onAdd={() => addItem(item)}
                  onRemove={() => changeProductQuantity(item.id, -1)}
                  canToggleStock={can86Items}
                  onToggleStock={() => { void toggleStock(item); }}
                />
              ))}
            </div>
          </section>
        </section>

        <aside className="hidden border-l border-outline-variant bg-surface-container-lowest p-4 tablet:block">
          {renderTicketContent(true)}
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 bg-surface-container-lowest/95 px-3 py-2.5 shadow-sheet backdrop-blur-xl safe-bottom tablet:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} className="min-w-0 text-left">
          <span className="block">
            <span className="flex items-center gap-1.5 font-body text-label-sm uppercase text-outline">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-1 text-on-surface">{count}</span>
              {t('pos.currentOrder')}
            </span>
            <span className="font-display text-currency-display-mobile text-primary">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md text-on-surface">DT</small></span>
          </span>
        </button>
        <Button onClick={finishOrder} disabled={!cart.length} className="min-h-[52px] shrink-0 rounded-2xl px-4">
          <MaterialIcon name="check_circle" className="text-xl" />
          {t('common.done')} <span className="ml-1 font-display tabular-nums">{formatTnd(totalMillimes / 1000)} DT</span>
        </Button>
      </div>

      <BottomNav />
      {ticketOrder && <TicketView order={ticketOrder} storeName={store?.name ?? t('pos.cafe')} staffName={user?.name ?? t('common.staff')} onClose={() => setTicketOrder(null)} />}
      <BottomSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('pos.currentOrder')}>
        {renderTicketContent(true)}
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
      {toast && <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{toast}</div>}
    </div>
  );
}
