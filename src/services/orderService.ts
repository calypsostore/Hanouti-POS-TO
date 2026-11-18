import type { OrderLineRecord, OrderRecord, PaymentMethod } from '../types/domain';
import { shiftService } from './shiftService';
import { userService } from './userService';
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

export const orderService = {
  listToday(storeId: string, staffId?: string): OrderRecord[] {
    const start = todayStart();
    return getOrders()
      .filter((order) => order.storeId === storeId && new Date(order.createdAt).getTime() >= start && (!staffId || order.staffId === staffId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  listAll(storeId: string): OrderRecord[] {
    return getOrders().filter((order) => order.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  createOrder(input: { storeId: string; staffId: string; items: OrderLineRecord[]; paymentMethod?: PaymentMethod; location?: string }): OrderRecord {
    if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
    const store = userService.getStore(input.storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    if (store.dayClosedOn === businessDate(new Date())) throw new Error('The business day is closed. Open a new shift to continue.');
    const shift = shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('Open a shift before taking orders.');
    const items = input.items.map((item) => {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.unitPriceMillimes) || item.unitPriceMillimes < 0) {
        throw new Error('Order contains an invalid quantity or price.');
      }
      return { ...item, lineTotalMillimes: item.quantity * item.unitPriceMillimes };
    });
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
    saveOrders([...getOrders(), order]);
    writeData('order-counter', number + 1);
    return order;
  },

  requestVoid(orderId: string, staffId: string): OrderRecord {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.staffId === staffId);
    if (!order || order.status !== 'done') throw new Error('This order is not available for a void request.');
    const updated = { ...order, status: 'pending_void' as const, voidRequestedAt: new Date().toISOString() };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  voidWithPin(orderId: string, pin: string, actorId: string, reason?: string): OrderRecord {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'done');
    if (!order) throw new Error('This order is not available to void.');
    const store = userService.getStore(order.storeId);
    if (!store || store.adminPin !== pin) throw new Error('Incorrect Admin PIN.');
    const updated: OrderRecord = {
      ...order,
      status: 'voided',
      voidedAt: new Date().toISOString(),
      voidedBy: actorId,
      voidReason: reason?.trim() || 'Voided by store administrator',
    };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  resolveVoidRequest(orderId: string, ownerId: string, decision: 'approve' | 'reject', reason?: string): OrderRecord {
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'pending_void');
    if (!order) throw new Error('Pending void request could not be found.');
    if (!userService.getStore(order.storeId) || userService.getStore(order.storeId)?.ownerId !== ownerId) {
      throw new Error('Only this store owner can resolve the request.');
    }
    const updated: OrderRecord = decision === 'approve'
      ? { ...order, status: 'voided', voidedAt: new Date().toISOString(), voidedBy: ownerId, voidReason: reason?.trim() || 'Approved by store owner' }
      : { ...order, status: 'done', voidRequestedAt: undefined };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    return updated;
  },

  getCashSalesForShift(shiftId: string): number {
    return getOrders()
      .filter((order) => order.shiftId === shiftId && order.status === 'done' && order.paymentMethod === 'cash')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  getTotalForToday(storeId: string, staffId?: string): number {
    return this.listToday(storeId, staffId)
      .filter((order) => order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  getNextOrderNumber(): number {
    return readData('order-counter', 1043);
  },
};
