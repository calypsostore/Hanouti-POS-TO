import { useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ItemCard, type ItemCardItem } from '../components/ItemCard';
import { MaterialIcon } from '../components/MaterialIcon';
import { TicketRow, type TicketLine } from '../components/TicketRow';
import { TopBar } from '../components/TopBar';
import { formatTnd } from '../lib/format';
import { catalogService } from '../services/catalogService';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord, OrderLineRecord } from '../types/domain';

interface CartLine extends TicketLine {
  itemId: string;
  unitPriceMillimes: number;
}

interface ProductView extends ItemCardItem {
  priceMillimes: number;
  categoryId: string;
}

const quickPickIds = ['item-espresso', 'item-cappuccino', 'item-almond-croissant', 'item-lemonade'];

function toProductView(item: CatalogItemRecord): ProductView {
  return {
    id: item.id,
    name: item.name,
    price: item.priceMillimes / 1000,
    priceMillimes: item.priceMillimes,
    icon: item.icon,
    categoryId: item.categoryId,
    outOfStock: item.outOfStock,
  };
}

export function PosScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const store = storeId ? userService.getStore(storeId) : undefined;
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>(['Sans Sucre', 'Extra Shot']);
  const [catalogRecords] = useState(() => catalogService.listItems(storeId));
  const [categoryRecords] = useState(() => catalogService.listCategories(storeId));
  const openShift = user ? shiftService.getOpenShiftForUser(storeId, user.id) : undefined;
  const categoryOptions = [{ id: 'all', name: 'All Items', icon: 'apps' }, ...categoryRecords];

  const allProducts = useMemo(() => catalogRecords.map(toProductView), [catalogRecords]);
  const filteredItems = useMemo(() => allProducts.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (category === 'all' || item.categoryId === category),
  ), [allProducts, category, search]);
  const quickPicks = quickPickIds
    .map((id) => allProducts.find((item) => item.id === id))
    .filter((item): item is ProductView => item !== undefined);

  const totalMillimes = cart.reduce((sum, line) => sum + line.quantity * line.unitPriceMillimes, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  function addItem(item: ProductView) {
    if (item.outOfStock) return;
    if (!openShift) {
      setToast('Open a shift before taking orders');
      window.setTimeout(() => setToast(''), 2500);
      return;
    }
    setCart((lines) => {
      const existing = lines.find((line) => line.id === item.id);
      if (existing) return lines.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      const modifiers = item.id === 'item-direct' ? selectedModifiers : [];
      const extraShot = modifiers.includes('Extra Shot') ? 600 : 0;
      const unitPriceMillimes = item.priceMillimes + extraShot;
      return [...lines, {
        id: item.id,
        itemId: item.id,
        name: item.name,
        quantity: 1,
        unitPrice: unitPriceMillimes / 1000,
        unitPriceMillimes,
        modifiers,
      }];
    });
  }

  function changeQuantity(id: string, delta: number) {
    setCart((lines) => lines
      .map((line) => line.id === id ? { ...line, quantity: line.quantity + delta } : line)
      .filter((line) => line.quantity > 0));
  }

  function finishOrder() {
    if (cart.length === 0) return;
    if (!user?.storeId) {
      setToast('Your account is not linked to a store.');
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
      orderService.createOrder({ storeId: user.storeId, staffId: user.id, items, paymentMethod: 'cash' });
      setCart([]);
      setDrawerOpen(false);
      setToast('Order marked as done');
      window.setTimeout(() => setToast(''), 2500);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to save this order.');
      window.setTimeout(() => setToast(''), 3000);
    }
  }

  function toggleModifier(modifier: string) {
    setSelectedModifiers((values) => values.includes(modifier) ? values.filter((value) => value !== modifier) : [...values, modifier]);
  }

  const TicketContent = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex flex-col ${compact ? 'h-full' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-body text-label-sm uppercase tracking-wider text-outline">Current Order</p>
          <h2 className="font-display text-headline-md text-on-surface">Order ticket</h2>
        </div>
        <span className="rounded-full bg-secondary-container px-2.5 py-1 font-body text-label-sm text-on-surface">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className={`min-h-24 flex-1 overflow-y-auto ${compact ? 'max-h-[45vh]' : ''}`}>
        {cart.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center text-center text-outline">
            <MaterialIcon name="receipt_long" className="text-3xl" />
            <p className="mt-1 font-body text-body-sm">Tap an item to add it to this ticket</p>
          </div>
        ) : cart.map((line) => (
          <TicketRow
            key={line.id}
            item={{ id: line.id, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, modifiers: line.modifiers }}
            onIncrement={() => changeQuantity(line.id, 1)}
            onDecrement={() => changeQuantity(line.id, -1)}
            onRemove={() => setCart((lines) => lines.filter((item) => item.id !== line.id))}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-outline-variant pt-3">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-body text-label-md text-on-surface-variant">Total</span>
          <span className="font-display text-currency-display-mobile text-on-surface">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md">DT</small></span>
        </div>
        <Button onClick={finishOrder} disabled={!cart.length} className="min-h-[54px] w-full rounded-xl text-body-lg">
          <MaterialIcon name="check_circle" className="text-xl" />
          Done <span className="ml-auto font-display tabular-nums">{formatTnd(totalMillimes / 1000)} DT</span>
        </Button>
        <p className="mt-1 text-center font-body text-body-sm text-on-surface-variant">Paid outside app</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface pb-36 tablet:pb-20">
      <TopBar title="POS Terminal" storeName={store?.name} />
      <div className="flex items-center justify-between gap-2 bg-surface-container-low px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1 truncate font-display text-headline-sm text-primary">
            <MaterialIcon name="storefront" className="text-lg" filled />
            {store?.name ?? 'Café'}
          </h2>
          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-label-sm ${openShift ? 'bg-success text-on-surface' : 'bg-error-container text-on-error-container'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${openShift ? 'bg-success-dark' : 'bg-error-dark'}`} />
            {openShift ? `Shift open since ${new Date(openShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Open shift required'}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" aria-label="Notifications" className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-surface-container-lowest shadow-card text-on-surface-variant">
            <MaterialIcon name="notifications" className="text-[22px]" />
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-body text-[9px] text-white">2</span>
          </button>
          <button type="button" aria-label="Staff lock" className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-container-lowest text-primary shadow-card">
            <MaterialIcon name="lock" className="text-[22px]" />
          </button>
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
                placeholder="Search items (Express, Direct, Croissant)..."
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
                Quick Picks
              </h2>
              <span className="font-body text-label-sm text-outline">High Velocity</span>
            </div>
            <div className="scrollbar-hidden flex gap-2.5 overflow-x-auto px-3 pb-1">
              {quickPicks.map((item, index) => (
                <button key={item.id} type="button" onClick={() => addItem(item)} className="flex min-h-32 w-36 shrink-0 flex-col justify-between rounded-2xl bg-surface-container-lowest p-3 text-left shadow-card active:scale-[0.98]">
                  <div className="flex items-start justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-container text-primary"><MaterialIcon name={item.icon} className="text-xl" /></span>
                    {index === 0 && <span className="rounded-md bg-success px-1.5 py-0.5 font-body text-label-sm text-on-surface">Top</span>}
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
              <h2 className="font-display text-headline-sm text-on-surface">Catalogue Items</h2>
              <span className="font-body text-label-sm text-outline">Touch to Add</span>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {filteredItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={{ id: item.id, name: item.name, price: item.priceMillimes / 1000, icon: item.icon, outOfStock: item.outOfStock }}
                  quantity={cart.find((line) => line.id === item.id)?.quantity ?? 0}
                  onAdd={() => addItem(item)}
                  onRemove={() => changeQuantity(item.id, -1)}
                />
              ))}
            </div>
          </section>

          <section className="mx-3 mt-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 shadow-card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 font-display text-headline-sm text-primary">
                <MaterialIcon name="room_service" className="text-xl" />
                Quick Modifiers
              </h2>
              <span className="rounded-full bg-success-container px-2 py-1 font-body text-label-sm text-on-success-container">Applies to Café Direct</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Sans Sucre', 'Extra Shot', 'Halib Zeyed', 'Mahroussa'].map((modifier) => {
                const active = selectedModifiers.includes(modifier);
                return (
                  <button key={modifier} type="button" onClick={() => toggleModifier(modifier)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 font-body text-label-md ${active ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface'}`}>
                    <MaterialIcon name={active ? 'check' : 'add'} className="text-base" />
                    {modifier}
                  </button>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="hidden border-l border-outline-variant bg-surface-container-lowest p-4 tablet:block">
          <TicketContent compact />
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-16 z-30 flex items-center justify-between gap-3 bg-surface-container-lowest/95 px-3 py-2.5 shadow-sheet backdrop-blur-xl tablet:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} className="min-w-0 text-left">
          <span className="block">
            <span className="flex items-center gap-1.5 font-body text-label-sm uppercase text-outline">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-1 text-on-surface">{count}</span>
              Current Order
            </span>
            <span className="font-display text-currency-display-mobile text-primary">{formatTnd(totalMillimes / 1000)} <small className="font-body text-label-md text-on-surface">DT</small></span>
          </span>
        </button>
        <Button onClick={finishOrder} disabled={!cart.length} className="min-h-[52px] shrink-0 rounded-2xl px-4">
          <MaterialIcon name="check_circle" className="text-xl" />
          Done <span className="ml-1 font-display tabular-nums">{formatTnd(totalMillimes / 1000)} DT</span>
        </Button>
      </div>

      <BottomNav />
      <BottomSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Current order">
        <TicketContent compact />
      </BottomSheet>
      {toast && <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{toast}</div>}
    </div>
  );
}
