import type { OrderLineRecord, OrderRecord, PaymentMethod } from '../types/domain';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { catalogService } from './catalogService';
import { readData, writeData } from './storage';
import { seedOrders } from './seedData';

const getOrders = () => readData('orders', seedOrders);
const saveOrders = (orders: OrderRecord[]) => writeData('orders', orders);
const businessDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayStart = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface OfflineOrderQueue {
  enqueue(order: OrderRecord): Promise<void>;
  flush(): Promise<void>;
  pendingCount(): Promise<number>;
}

export const offlineOrderQueue: OfflineOrderQueue = {
  async enqueue() {},
  async flush() {},
  async pendingCount() {
    return 0;
  },
};

export const orderService = {
  async listToday(storeId: string, staffId?: string): Promise<OrderRecord[]> {
    const start = todayStart();
    return getOrders()
      .filter((order) => order.storeId === storeId && new Date(order.createdAt).getTime() >= start && (!staffId || order.staffId === staffId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listAll(storeId: string): Promise<OrderRecord[]> {
    return getOrders().filter((order) => order.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createOrder(input: { storeId: string; staffId: string; items: OrderLineRecord[]; paymentMethod?: PaymentMethod; customerId?: string; location?: string }): Promise<OrderRecord> {
    if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
    const store = await userService.getStore(input.storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    const staff = await userService.getUser(input.staffId);
    if (store.dayClosedOn === businessDate(new Date())) throw new Error('The business day is closed. Open a new shift to continue.');
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('Open a shift before taking orders.');
    if (input.paymentMethod === 'tab') {
      if (!input.customerId) throw new Error('Select a customer before charging this order to a tab.');
      if (!await userService.hasPermission(input.staffId, 'use_tabs')) throw new Error('Your position does not allow customer tabs.');
      const customer = readData<import('../types/domain').CustomerRecord[]>('customers', []).find((candidate) => candidate.id === input.customerId && candidate.storeId === input.storeId);
      if (!customer) throw new Error('Select a customer from this store.');
    }
    const [catalogItems, categories] = await Promise.all([
      catalogService.listItems(input.storeId),
      catalogService.listCategories(input.storeId),
    ]);
    const requestedQuantities = new Map<string, number>();
    const items = input.items.map((item) => {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.unitPriceMillimes) || item.unitPriceMillimes < 0) {
        throw new Error('Order contains an invalid quantity or price.');
      }
      const catalogItem = catalogItems.find((candidate) => candidate.id === item.itemId);
      if (!catalogItem) throw new Error('Order contains an item that is not in this store catalog.');
      if (catalogItem.outOfStock) throw new Error(`${catalogItem.name} is out of stock.`);
      const selectedModifiers = item.modifiers ?? [];
      if (new Set(selectedModifiers).size !== selectedModifiers.length) throw new Error('Order contains a duplicate item modifier.');
      const availableModifiers = catalogItem.modifiers ?? [];
      const selectedModifierRecords = selectedModifiers.map((name) => {
        const modifier = availableModifiers.find((candidate) => candidate.name === name);
        if (!modifier) throw new Error(`${name} is not a valid modifier for ${catalogItem.name}.`);
        return modifier;
      });
      const expectedUnitPrice = catalogItem.priceMillimes + selectedModifierRecords.reduce((sum, modifier) => sum + modifier.priceMillimes, 0);
      if (item.unitPriceMillimes !== expectedUnitPrice) throw new Error(`The price for ${catalogItem.name} does not match the catalog.`);
      requestedQuantities.set(item.itemId, (requestedQuantities.get(item.itemId) ?? 0) + item.quantity);
      return {
        ...item,
        categoryId: catalogItem.categoryId,
        categoryName: categories.find((category) => category.id === catalogItem.categoryId)?.name,
        lineTotalMillimes: item.quantity * item.unitPriceMillimes,
      };
    });
    for (const [itemId, quantity] of requestedQuantities) {
      const catalogItem = catalogItems.find((candidate) => candidate.id === itemId);
      if (catalogItem?.stockCount !== null && catalogItem && quantity > catalogItem.stockCount) {
        throw new Error(`${catalogItem.name} has only ${catalogItem.stockCount} remaining.`);
      }
    }
    const totalMillimes = items.reduce((sum, item) => sum + item.lineTotalMillimes, 0);
    const dateKey = businessDate(new Date());
    const counters = readData<Record<string, { businessDate: string; nextNumber: number }>>('order-counters', {});
    const counter = counters[input.storeId];
    const number = counter?.businessDate === dateKey ? counter.nextNumber : 1;
    const order: OrderRecord = {
      id: `order-${input.storeId}-${dateKey}-${number}`,
      number,
      storeId: input.storeId,
      storeName: store.name,
      staffId: input.staffId,
      staffName: staff?.name,
      shiftId: shift.id,
      location: input.location ?? 'Counter • Takeaway',
      status: 'done',
      paymentMethod: input.paymentMethod ?? 'cash',
      customerId: input.customerId,
      items,
      totalMillimes,
      createdAt: new Date().toISOString(),
    };
    for (const [itemId, quantity] of requestedQuantities) {
      await catalogService.decrementStock(itemId, quantity);
    }
    saveOrders([...getOrders(), order]);
    if (order.paymentMethod === 'tab' && order.customerId) {
      const tabs = readData<import('../types/domain').TabRecord[]>('tabs', []);
      writeData('tabs', [...tabs, {
        id: `tab-${crypto.randomUUID()}`,
        storeId: order.storeId,
        customerId: order.customerId,
        orderId: order.id,
        shiftId: order.shiftId,
        staffId: order.staffId,
        kind: 'issued',
        amountMillimes: order.totalMillimes,
        createdAt: order.createdAt,
      }]);
    }
    writeData('order-counters', { ...counters, [input.storeId]: { businessDate: dateKey, nextNumber: number + 1 } });
    return order;
  },

  async requestVoid(orderId: string, staffId: string, reason: string): Promise<OrderRecord> {
    if (!await userService.hasPermission(staffId, 'request_void')) {
      throw new Error('Your position does not allow void requests.');
    }
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.staffId === staffId);
    if (!order || order.status !== 'done') throw new Error('This order is not available for a void request.');
    const cleanedReason = reason.trim();
    if (!cleanedReason) throw new Error('A reason is required to request an order void.');
    const updated = { ...order, status: 'pending_void' as const, voidRequestedAt: new Date().toISOString(), voidReason: cleanedReason };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  async voidWithPin(orderId: string, pin: string, actorId: string, reason: string): Promise<OrderRecord> {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'done');
    if (!order) throw new Error('This order is not available to void.');
    const cleanedReason = reason.trim();
    if (!cleanedReason) throw new Error('A reason is required to void an order.');
    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('void-pin-attempts', {});
    const attempt = attempts[order.storeId] ?? { count: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > Date.now()) {
      const seconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
      throw new Error(`PIN pad locked. Try again in ${seconds} seconds.`);
    }
    if (!await userService.verifyStorePin(order.storeId, pin)) {
      const count = attempt.count + 1;
      writeData('void-pin-attempts', {
        ...attempts,
        [order.storeId]: { count: count >= 3 ? 0 : count, lockedUntil: count >= 3 ? Date.now() + 60_000 : 0 },
      });
      throw new Error(count >= 3 ? 'PIN pad locked for 60 seconds after 3 incorrect PINs.' : 'Incorrect Admin PIN.');
    }
    writeData('void-pin-attempts', { ...attempts, [order.storeId]: { count: 0, lockedUntil: 0 } });
    const updated: OrderRecord = {
      ...order,
      status: 'voided',
      voidedAt: new Date().toISOString(),
      voidedBy: 'pin',
      voidedByUserId: actorId,
      voidReason: cleanedReason,
    };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    await restoreOrderStock(order);
    return updated;
  },

  async resolveVoidRequest(orderId: string, ownerId: string, decision: 'approve' | 'reject', reason?: string): Promise<OrderRecord> {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'pending_void');
    if (!order) throw new Error('Pending void request could not be found.');
    const store = await userService.getStore(order.storeId);
    if (!store || store.ownerId !== ownerId) {
      throw new Error('Only this store owner can resolve the request.');
    }
    const cleanedReason = reason?.trim() || order.voidReason?.trim() || '';
    const updated: OrderRecord = decision === 'approve'
      ? { ...order, status: 'voided', voidedAt: new Date().toISOString(), voidedBy: 'owner', voidedByUserId: ownerId, voidReason: cleanedReason }
      : { ...order, status: 'done', voidRequestedAt: undefined, voidReason: undefined };
    if (decision === 'approve' && !updated.voidReason) throw new Error('A reason is required to void an order.');
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    if (decision === 'approve') await restoreOrderStock(order);
    return updated;
  },

  async getCashSalesForShift(shiftId: string): Promise<number> {
    const orderSales = getOrders()
      .filter((order) => order.shiftId === shiftId && order.status === 'done' && order.paymentMethod === 'cash')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
    const settlements = readData<import('../types/domain').TabRecord[]>('tabs', [])
      .filter((tab) => tab.shiftId === shiftId && tab.kind === 'settled')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    return orderSales + settlements;
  },

  async getPendingVoidCountForShift(shiftId: string): Promise<number> {
    return getOrders().filter((order) => order.shiftId === shiftId && order.status === 'pending_void').length;
  },

  getPinLockRemainingMs(storeId: string): number {
    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('void-pin-attempts', {});
    return Math.max(0, (attempts[storeId]?.lockedUntil ?? 0) - Date.now());
  },

  async getTotalForToday(storeId: string, staffId?: string): Promise<number> {
    return (await this.listToday(storeId, staffId))
      .filter((order) => order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  async getNextOrderNumber(storeId: string): Promise<number> {
    const dateKey = businessDate(new Date());
    const counter = readData<Record<string, { businessDate: string; nextNumber: number }>>('order-counters', {})[storeId];
    return counter?.businessDate === dateKey ? counter.nextNumber : 1;
  },
};

async function restoreOrderStock(order: OrderRecord): Promise<void> {
  const quantities = new Map<string, number>();
  for (const item of order.items) quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
  for (const [itemId, quantity] of quantities) await catalogService.incrementStock(itemId, quantity);
}
