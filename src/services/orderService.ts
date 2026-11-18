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

  async createOrder(input: { storeId: string; staffId: string; items: OrderLineRecord[]; paymentMethod?: PaymentMethod; location?: string }): Promise<OrderRecord> {
    if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
    const store = await userService.getStore(input.storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    if (store.dayClosedOn === businessDate(new Date())) throw new Error('The business day is closed. Open a new shift to continue.');
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('Open a shift before taking orders.');
    const catalogItems = await catalogService.listItems(input.storeId);
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
      return { ...item, lineTotalMillimes: item.quantity * item.unitPriceMillimes };
    });
    for (const [itemId, quantity] of requestedQuantities) {
      const catalogItem = catalogItems.find((candidate) => candidate.id === itemId);
      if (catalogItem?.stockCount !== null && catalogItem && quantity > catalogItem.stockCount) {
        throw new Error(`${catalogItem.name} has only ${catalogItem.stockCount} remaining.`);
      }
    }
    const totalMillimes = items.reduce((sum, item) => sum + item.lineTotalMillimes, 0);
    const number = readData('order-counter', 1043);
    const order: OrderRecord = {
      id: `order-${number}`,
      number,
      storeId: input.storeId,
      staffId: input.staffId,
      shiftId: shift.id,
      location: input.location ?? 'Counter • Takeaway',
      status: 'done',
      paymentMethod: input.paymentMethod ?? 'cash',
      items,
      totalMillimes,
      createdAt: new Date().toISOString(),
    };
    for (const [itemId, quantity] of requestedQuantities) {
      await catalogService.decrementStock(itemId, quantity);
    }
    saveOrders([...getOrders(), order]);
    writeData('order-counter', number + 1);
    return order;
  },

  async requestVoid(orderId: string, staffId: string): Promise<OrderRecord> {
    if (!await userService.hasPermission(staffId, 'request_void')) {
      throw new Error('Your position does not allow void requests.');
    }
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.staffId === staffId);
    if (!order || order.status !== 'done') throw new Error('This order is not available for a void request.');
    const updated = { ...order, status: 'pending_void' as const, voidRequestedAt: new Date().toISOString() };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  async voidWithPin(orderId: string, pin: string, actorId: string, reason?: string): Promise<OrderRecord> {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'done');
    if (!order) throw new Error('This order is not available to void.');
    const store = await userService.getStore(order.storeId);
    if (!store || store.adminPin !== pin) throw new Error('Incorrect Admin PIN.');
    const updated: OrderRecord = {
      ...order,
      status: 'voided',
      voidedAt: new Date().toISOString(),
      voidedBy: 'pin',
      voidedByUserId: actorId,
      voidReason: reason?.trim() || 'Voided by store administrator',
    };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
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
    const updated: OrderRecord = decision === 'approve'
      ? { ...order, status: 'voided', voidedAt: new Date().toISOString(), voidedBy: 'owner', voidedByUserId: ownerId, voidReason: reason?.trim() || 'Approved by store owner' }
      : { ...order, status: 'done', voidRequestedAt: undefined };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  async getCashSalesForShift(shiftId: string): Promise<number> {
    return getOrders()
      .filter((order) => order.shiftId === shiftId && order.status === 'done' && order.paymentMethod === 'cash')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  async getPendingVoidCountForShift(shiftId: string): Promise<number> {
    return getOrders().filter((order) => order.shiftId === shiftId && order.status === 'pending_void').length;
  },

  async getTotalForToday(storeId: string, staffId?: string): Promise<number> {
    return (await this.listToday(storeId, staffId))
      .filter((order) => order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  async getNextOrderNumber(): Promise<number> {
    return readData('order-counter', 1043);
  },
};
