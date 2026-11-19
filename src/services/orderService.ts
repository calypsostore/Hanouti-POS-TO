import type { CatalogItemRecord, OrderLineRecord, OrderRecord, PaymentMethod, TabRecord } from '../types/domain';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { catalogService } from './catalogService';
import { customerService } from './customerService';
import { notificationService } from './notificationService';
import { activityService } from './activityService';
import { readData, writeData } from './storage';
import { seedOrders } from './seedData';
import { isSupabaseDriver } from '../data/driver';
import {
  countPendingVoids,
  createOrder as createRemoteOrder,
  getCashSales as getRemoteCashSales,
  getNextOrderNumber as getRemoteNextOrderNumber,
  getOrder as getRemoteOrder,
  getShiftBreakdown as getRemoteShiftBreakdown,
  listOrders as listRemoteOrders,
  requestVoid as requestRemoteVoid,
  resolveVoid as resolveRemoteVoid,
  voidWithPin as voidRemoteOrder,
} from '../data/repositories/orderRepository';

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

export class OrderServiceError extends Error {
  readonly code = 'CREDIT_LIMIT';

  constructor(message: string) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

export class OrderNotificationError extends Error {
  readonly order: OrderRecord;

  constructor(order: OrderRecord, cause: unknown) {
    super(`Order #${order.number} was created, but an owner notification could not be saved: ${cause instanceof Error ? cause.message : 'Unknown notification error.'}`, { cause });
    this.name = 'OrderNotificationError';
    this.order = order;
  }
}

async function authorizeCreditOverride(input: {
  storeId: string;
  staffId: string;
  pin: string;
  storePinMustChange: boolean;
}): Promise<void> {
  const actor = await userService.getUser(input.staffId);
  const store = await userService.getStore(input.storeId);
  const isOwner = actor?.role === 'owner' && actor.id === store?.ownerId && actor.storeId === store.id;
  const staffCanOverride = actor?.role === 'staff' && actor.storeId === store?.id &&
    await userService.hasPermission(actor.id, 'tab_override_limit');
  if (!isOwner && !staffCanOverride) {
    throw new Error('Your position does not allow overriding customer credit limits.');
  }
  if (input.storePinMustChange) throw new Error('Set your admin PIN in Settings before overriding credit limits.');
  const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('credit-override-pin-attempts', {});
  const attempt = attempts[input.storeId] ?? { count: 0, lockedUntil: 0 };
  if (attempt.lockedUntil > Date.now()) {
    const seconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    throw new Error(`PIN pad locked. Try again in ${seconds} seconds.`);
  }
  if (!await userService.verifyStorePin(input.storeId, input.pin, 'credit_override')) {
    const count = attempt.count + 1;
    writeData('credit-override-pin-attempts', {
      ...attempts,
      [input.storeId]: { count: count >= 3 ? 0 : count, lockedUntil: count >= 3 ? Date.now() + 60_000 : 0 },
    });
    throw new Error(count >= 3 ? 'PIN pad locked for 60 seconds after 3 incorrect PINs.' : 'Incorrect Admin PIN.');
  }
  writeData('credit-override-pin-attempts', { ...attempts, [input.storeId]: { count: 0, lockedUntil: 0 } });
}

export const offlineOrderQueue: OfflineOrderQueue = {
  async enqueue() {},
  async flush() {},
  async pendingCount() {
    return 0;
  },
};

export interface ShiftSalesBreakdown {
  orderCount: number;
  cashSalesMillimes: number;
  tabSalesMillimes: number;
  tabPaymentsMillimes: number;
  voidsMillimes: number;
}

export const orderService = {
  async listToday(storeId: string, staffId?: string): Promise<OrderRecord[]> {
    if (isSupabaseDriver()) return listRemoteOrders(storeId, staffId, businessDate(new Date()));
    const start = todayStart();
    return getOrders()
      .filter((order) => order.storeId === storeId && new Date(order.createdAt).getTime() >= start && (!staffId || order.staffId === staffId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listAll(storeId: string): Promise<OrderRecord[]> {
    if (isSupabaseDriver()) return listRemoteOrders(storeId);
    return getOrders().filter((order) => order.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createOrder(input: { storeId: string; staffId: string; items: OrderLineRecord[]; paymentMethod?: PaymentMethod; customerId?: string; location?: string; adminPin?: string; note?: string }): Promise<OrderRecord> {
    if (isSupabaseDriver()) {
      if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
      const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
      if (!shift) throw new Error('Open a shift before taking orders.');
      try {
        return await createRemoteOrder({
          shift,
          items: input.items,
          paymentMethod: input.paymentMethod,
          customerId: input.customerId,
          location: input.location,
          adminPin: input.adminPin,
          note: input.note,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('Limit reached')) {
          throw new OrderServiceError('Limit reached. Tell the customer.');
        }
        throw error;
      }
    }
    if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
    const store = await userService.getStore(input.storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    const staff = await userService.getUser(input.staffId);
    if (store.dayClosedOn === businessDate(new Date())) throw new Error('The business day is closed. Open a new shift to continue.');
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('Open a shift before taking orders.');
    let tabCustomer: Awaited<ReturnType<typeof customerService.getCustomer>>;
    if (input.paymentMethod === 'tab') {
      if (!input.customerId) throw new Error('Select a customer before charging this order to a tab.');
      if (staff?.role !== 'owner' && !await userService.hasPermission(input.staffId, 'use_tabs')) throw new Error('Your position does not allow customer tabs.');
      tabCustomer = await customerService.getCustomer(input.customerId, input.storeId);
      if (!tabCustomer?.isActive) throw new Error('Select an active customer from this store.');
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
    let creditStatusBefore: Awaited<ReturnType<typeof customerService.getCreditStatus>> | undefined;
    let creditStatusAfter: Awaited<ReturnType<typeof customerService.getCreditStatus>> | undefined;
    if (input.paymentMethod === 'tab' && tabCustomer) {
      creditStatusBefore = await customerService.getCreditStatus(tabCustomer.id);
      creditStatusAfter = await customerService.getCreditStatus(tabCustomer.id, totalMillimes);
      if (creditStatusAfter.limit !== undefined && creditStatusAfter.balance > creditStatusAfter.limit) {
        if (!input.adminPin) throw new OrderServiceError('Limit reached. Tell the customer.');
        await authorizeCreditOverride({
          storeId: input.storeId,
          staffId: input.staffId,
          pin: input.adminPin,
          storePinMustChange: Boolean(store.pinMustChange),
        });
      }
    }
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
      location: input.location,
      status: 'done',
      paymentMethod: input.paymentMethod ?? 'cash',
      customerId: input.customerId,
      note: input.note?.trim() || undefined,
      items,
      totalMillimes,
      createdAt: new Date().toISOString(),
    };
    const stockDepletedItems: CatalogItemRecord[] = [];
    for (const [itemId, quantity] of requestedQuantities) {
      const previousItem = catalogItems.find((candidate) => candidate.id === itemId);
      const updatedItem = await catalogService.decrementStock(itemId, quantity, {
        id: input.staffId,
        name: staff?.name ?? input.staffId,
      });
      if (previousItem && !previousItem.outOfStock && previousItem.stockCount !== null && updatedItem.stockCount === 0) {
        stockDepletedItems.push(updatedItem);
      }
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
    await activityService.log({
      storeId: order.storeId,
      actorId: order.staffId,
      actorName: staff?.name,
      action: 'order.created',
      summary: `Created order #${order.number} for ${order.totalMillimes} millimes.`,
      entityType: 'order',
      entityId: order.id,
      meta: {
        after: {
          number: order.number,
          paymentMethod: order.paymentMethod,
          totalMillimes: order.totalMillimes,
          customerId: order.customerId,
          items: order.items.map(({ itemId, name, quantity, unitPriceMillimes, lineTotalMillimes }) =>
            ({ itemId, name, quantity, unitPriceMillimes, lineTotalMillimes })),
        },
      },
    });
    const ownerNotifications: Promise<void>[] = stockDepletedItems.map((item) =>
      notificationService.notifyStockDepleted(input.storeId, item.id, item.name),
    );
    if (tabCustomer && creditStatusBefore && creditStatusAfter) {
      ownerNotifications.push(notificationService.notifyCustomerCreditThresholds(
        input.storeId,
        tabCustomer.id,
        tabCustomer.name,
        creditStatusBefore.percentUsed ?? 0,
        creditStatusAfter.percentUsed ?? 0,
      ));
    }
    try {
      await Promise.all(ownerNotifications);
    } catch (notificationError) {
      throw new OrderNotificationError(order, notificationError);
    }
    return order;
  },

  async requestVoid(orderId: string, staffId: string, reason: string): Promise<OrderRecord> {
    if (isSupabaseDriver()) {
      if (!reason.trim()) throw new Error('A reason is required to request an order void.');
      return requestRemoteVoid(orderId, reason);
    }
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
    const actor = await userService.getUser(staffId);
    await activityService.log({
      storeId: order.storeId,
      actorId: staffId,
      actorName: actor?.name,
      action: 'order.void_requested',
      summary: `Requested a void for order #${order.number}. ${cleanedReason}`,
      entityType: 'order',
      entityId: order.id,
      meta: { before: { status: order.status }, after: { status: updated.status, voidReason: cleanedReason } },
    });
    await notificationService.notifyVoidRequested(updated);
    return updated;
  },

  async voidWithPin(orderId: string, pin: string, actorId: string, reason: string): Promise<OrderRecord> {
    if (isSupabaseDriver()) {
      if (!reason.trim()) throw new Error('A reason is required to void an order.');
      const order = await getRemoteOrder(orderId);
      if (!order) throw new Error('This order is not available to void.');
      if ((await userService.getStore(order.storeId))?.pinMustChange) {
        throw new Error('Set your admin PIN in Settings before voiding orders.');
      }
      return voidRemoteOrder(orderId, reason, pin);
    }
    const orders = getOrders();
    const order = orders.find((candidate) => candidate.id === orderId && candidate.status === 'done');
    if (!order) throw new Error('This order is not available to void.');
    const cleanedReason = reason.trim();
    if (!cleanedReason) throw new Error('A reason is required to void an order.');
    if ((await userService.getStore(order.storeId))?.pinMustChange) {
      throw new Error('Set your admin PIN in Settings before voiding orders.');
    }
    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('void-pin-attempts', {});
    const attempt = attempts[order.storeId] ?? { count: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > Date.now()) {
      const seconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
      throw new Error(`PIN pad locked. Try again in ${seconds} seconds.`);
    }
    if (!await userService.verifyStorePin(order.storeId, pin, 'void')) {
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
    await activityService.log({
      storeId: order.storeId,
      actorId,
      action: 'order.voided',
      summary: `Voided order #${order.number}. ${cleanedReason}`,
      entityType: 'order',
      entityId: order.id,
      meta: { before: { status: order.status }, after: { status: updated.status, voidReason: cleanedReason } },
    });
    if (order.paymentMethod === 'cash') {
      await shiftService.recordClosedShiftVoidAdjustment({
        shiftId: order.shiftId,
        orderId: order.id,
        orderNumber: order.number,
        amountMillimes: order.totalMillimes,
        actorId,
      });
    }
    await restoreOrderStock(order, actorId);
    return updated;
  },

  async resolveVoidRequest(orderId: string, ownerId: string, decision: 'approve' | 'reject', reason?: string): Promise<OrderRecord> {
    if (isSupabaseDriver()) {
      const order = await getRemoteOrder(orderId);
      if (!order) throw new Error('Pending void request could not be found.');
      const store = await userService.getStore(order.storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can resolve the request.');
      const cleanedReason = reason?.trim() || order.voidReason?.trim() || '';
      if (decision === 'approve' && !cleanedReason) throw new Error('A reason is required to void an order.');
      return resolveRemoteVoid(orderId, decision, cleanedReason, '');
    }
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
    await activityService.log({
      storeId: order.storeId,
      actorId: ownerId,
      action: decision === 'approve' ? 'order.voided' : 'order.void_rejected',
      summary: decision === 'approve'
        ? `Approved void for order #${order.number}. ${cleanedReason}`
        : `Rejected void request for order #${order.number}.`,
      entityType: 'order',
      entityId: order.id,
      meta: { before: { status: order.status, voidReason: order.voidReason }, after: { status: updated.status, voidReason: updated.voidReason } },
    });
    await notificationService.notifyVoidResolved(updated, decision === 'approve');
    if (decision === 'approve') {
      if (order.paymentMethod === 'cash') {
        await shiftService.recordClosedShiftVoidAdjustment({
          shiftId: order.shiftId,
          orderId: order.id,
          orderNumber: order.number,
          amountMillimes: order.totalMillimes,
          actorId: ownerId,
        });
      }
      await restoreOrderStock(order, ownerId);
    }
    return updated;
  },

  async getCashSalesForShift(shiftId: string): Promise<number> {
    if (isSupabaseDriver()) return getRemoteCashSales(shiftId);
    const breakdown = await this.getShiftSalesBreakdown(shiftId);
    return breakdown.cashSalesMillimes + breakdown.tabPaymentsMillimes;
  },

  async getShiftSalesBreakdown(shiftId: string): Promise<ShiftSalesBreakdown> {
    if (isSupabaseDriver()) return getRemoteShiftBreakdown(shiftId);
    const shiftOrders = getOrders().filter((order) => order.shiftId === shiftId);
    const completedOrders = shiftOrders.filter((order) => order.status === 'done');
    const shiftTabPayments = readData<TabRecord[]>('tabs', [])
      .filter((tab) => tab.shiftId === shiftId);
    const settlements = shiftTabPayments
      .filter((tab) => tab.kind === 'settled')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const reversals = shiftTabPayments
      .filter((tab) => tab.kind === 'reversal')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    return {
      orderCount: completedOrders.length,
      cashSalesMillimes: completedOrders
        .filter((order) => order.paymentMethod === 'cash')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      tabSalesMillimes: completedOrders
        .filter((order) => order.paymentMethod === 'tab')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      tabPaymentsMillimes: settlements - reversals,
      voidsMillimes: shiftOrders
        .filter((order) => order.status === 'voided')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
    };
  },

  async getPendingVoidCountForShift(shiftId: string): Promise<number> {
    if (isSupabaseDriver()) return countPendingVoids(shiftId);
    return getOrders().filter((order) => order.shiftId === shiftId && order.status === 'pending_void').length;
  },

  getPinLockRemainingMs(storeId: string): number {
    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('void-pin-attempts', {});
    return Math.max(0, (attempts[storeId]?.lockedUntil ?? 0) - Date.now());
  },

  async getTotalForToday(storeId: string, staffId?: string): Promise<number> {
    if (isSupabaseDriver()) {
      const orders = await listRemoteOrders(storeId, staffId, businessDate(new Date()));
      return orders.filter((order) => order.status === 'done').reduce((total, order) => total + order.totalMillimes, 0);
    }
    return (await this.listToday(storeId, staffId))
      .filter((order) => order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  async getNextOrderNumber(storeId: string): Promise<number> {
    if (isSupabaseDriver()) return getRemoteNextOrderNumber();
    const dateKey = businessDate(new Date());
    const counter = readData<Record<string, { businessDate: string; nextNumber: number }>>('order-counters', {})[storeId];
    return counter?.businessDate === dateKey ? counter.nextNumber : 1;
  },
};

async function restoreOrderStock(order: OrderRecord, actorId: string): Promise<void> {
  const actor = await userService.getUser(actorId);
  if (!actor) throw new Error('The staff member restoring this stock could not be found.');
  const quantities = new Map<string, number>();
  for (const item of order.items) quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
  for (const [itemId, quantity] of quantities) {
    await catalogService.incrementStock(itemId, quantity, { id: actor.id, name: actor.name });
  }
}
