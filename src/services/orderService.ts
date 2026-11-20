import type {
  CatalogItemRecord,
  OrderLineRecord,
  OrderRecord,
  PaymentMethod,
  ReportRecord,
  TabRecord,
} from '../types/domain';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { catalogService } from './catalogService';
import { customerService } from './customerService';
import { notificationService } from './notificationService';
import { activityService } from './activityService';
import { readData, writeData } from './storage';
import { seedOrders, seedReports } from './seedData';
import { isSupabaseDriver } from '../data/driver';
import { offlineOrderQueue } from './offlineOrderQueue';
import { requireOnlineForAction } from './offlineAvailability';
import {
  countPendingVoids,
  createOrder as createRemoteOrder,
  getCashSales as getRemoteCashSales,
  getCurrentBusinessDate as getRemoteCurrentBusinessDate,
  getNextOrderNumber as getRemoteNextOrderNumber,
  getOrder as getRemoteOrder,
  getShiftBreakdown as getRemoteShiftBreakdown,
  listOrders as listRemoteOrders,
  requestVoid as requestRemoteVoid,
  resolveVoid as resolveRemoteVoid,
  voidWithPin as voidRemoteOrder,
} from '../data/repositories/orderRepository';
import { listReports as listRemoteReports } from '../data/repositories/reportRepository';

const getOrders = () => readData('orders', seedOrders);
const saveOrders = (orders: OrderRecord[]) => writeData('orders', orders);

function assertOrderNotArchivedInZ(order: OrderRecord): void {
  const reports = readData<ReportRecord[]>('reports', seedReports);
  const orderCreatedAt = new Date(order.createdAt).getTime();
  const archived = reports.some((report) => {
    if (report.storeId !== order.storeId || report.type !== 'Z') return false;
    const periodFrom = new Date(report.periodFrom ?? report.createdAt).getTime();
    const periodTo = new Date(report.periodTo ?? report.createdAt).getTime();
    return orderCreatedAt >= periodFrom && orderCreatedAt <= periodTo;
  });
  if (archived) throw new Error('Orders included in a closed Z report are archived and cannot be changed.');
}

function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function getCurrentBusinessDate(storeId: string): Promise<string> {
  if (isSupabaseDriver()) return getRemoteCurrentBusinessDate(storeId);
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [reports, shifts] = await Promise.all([
    Promise.resolve(readData<ReportRecord[]>('reports', seedReports)),
    shiftService.listShifts(storeId),
  ]);
  const lastZ = reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const lastZAt = lastZ
    ? new Date(lastZ.periodTo ?? lastZ.createdAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const firstShift = shifts
    .filter((shift) => shift.storeId === storeId && new Date(shift.openedAt).getTime() > lastZAt)
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt))[0];
  return dateKeyInTimezone(new Date(firstShift?.openedAt ?? Date.now()), timeZone);
}

async function getCurrentReportPeriodStart(storeId: string): Promise<string | undefined> {
  const [reports, shifts] = await Promise.all([
    isSupabaseDriver()
      ? listRemoteReports(storeId)
      : Promise.resolve(readData<ReportRecord[]>('reports', seedReports)),
    shiftService.listShifts(storeId),
  ]);
  const lastZ = reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const lastZAt = lastZ
    ? new Date(lastZ.periodTo ?? lastZ.createdAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const firstShift = shifts
    .filter((shift) => shift.storeId === storeId && new Date(shift.openedAt).getTime() > lastZAt)
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt))[0];
  return firstShift?.openedAt ?? (lastZ ? lastZ.periodTo ?? lastZ.createdAt : undefined);
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

export { offlineOrderQueue };

async function createQueuedOrder(input: {
  storeId: string;
  staffId: string;
  items: OrderLineRecord[];
  paymentMethod?: PaymentMethod;
  customerId?: string;
  location?: string;
  adminPin?: string;
  note?: string;
}, idempotencyKey: string): Promise<OrderRecord> {
  if (input.adminPin) {
    throw new Error('Credit-limit overrides require an internet connection. No order was queued.');
  }
  const snapshot = await offlineOrderQueue.getSnapshot(input.storeId, input.staffId);
  if (!snapshot?.shift || snapshot.shift.status !== 'open') {
    throw new Error('No cached open shift is available. Connect to the internet before taking orders.');
  }
  if (!input.items.length) throw new Error('Add at least one item before completing an order.');

  const requestedQuantities = new Map<string, number>();
  const items = input.items.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error('Order contains an invalid quantity.');
    }
    const item = snapshot.items.find((candidate) => candidate.id === line.itemId && candidate.isActive);
    if (!item) throw new Error('This item is not in the last cached catalog. Reconnect before placing this order.');
    if (item.outOfStock || item.stockCount === 0) throw new Error(`${item.name} is out of stock in the last cached catalog.`);
    const modifiers = line.modifiers ?? [];
    if (new Set(modifiers).size !== modifiers.length) throw new Error('Order contains a duplicate item modifier.');
    if (item.modifiersRequired && modifiers.length === 0) throw new Error(`Choose a modifier for ${item.name}.`);
    if (item.modifierSelectionMode === 'single' && modifiers.length > 1) throw new Error(`Choose only one modifier for ${item.name}.`);
    const selected = modifiers.map((name) => {
      const modifier = item.modifiers?.find((candidate) => candidate.name === name);
      if (!modifier) throw new Error(`${name} is not a valid modifier for ${item.name}.`);
      return modifier;
    });
    const unitPriceMillimes = item.priceMillimes + selected.reduce((sum, modifier) => sum + modifier.priceMillimes, 0);
    if (line.unitPriceMillimes !== unitPriceMillimes) {
      throw new Error(`The price for ${item.name} does not match the last cached catalog.`);
    }
    requestedQuantities.set(item.id, (requestedQuantities.get(item.id) ?? 0) + line.quantity);
    return {
      ...line,
      categoryId: item.categoryId,
      categoryName: snapshot.categories.find((category) => category.id === item.categoryId)?.name,
      unitPriceMillimes,
      lineTotalMillimes: unitPriceMillimes * line.quantity,
    };
  });

  const queuedOrders = await offlineOrderQueue.pendingOrders(input.storeId);
  for (const [itemId, quantity] of requestedQuantities) {
    const item = snapshot.items.find((candidate) => candidate.id === itemId);
    if (item?.stockCount !== null && item) {
      const alreadyQueued = queuedOrders
        .filter((order) => order.syncStatus === 'queued')
        .flatMap((order) => order.items)
        .filter((line) => line.itemId === itemId)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (quantity + alreadyQueued > item.stockCount) {
        throw new Error(`${item.name} has only ${Math.max(0, item.stockCount - alreadyQueued)} remaining in the last cached stock count.`);
      }
    }
  }

  const paymentMethod = input.paymentMethod ?? 'cash';
  const totalMillimes = items.reduce((sum, line) => sum + line.lineTotalMillimes, 0);
  if (paymentMethod === 'tab') {
    if (!input.customerId) throw new Error('Select a customer before charging this order to a tab.');
    const customer = snapshot.customers.find((candidate) => candidate.id === input.customerId && candidate.isActive);
    const status = snapshot.creditStatuses[input.customerId];
    if (!customer || !status) {
      throw new Error('The customer credit status is not cached. Reconnect before charging this order to a tab.');
    }
    const alreadyQueued = queuedOrders
      .filter((order) => order.syncStatus === 'queued' && order.paymentMethod === 'tab' && order.customerId === customer.id)
      .reduce((sum, order) => sum + order.totalMillimes, 0);
    if (status.limit !== undefined && status.balance + alreadyQueued + totalMillimes > status.limit) {
      throw new OrderServiceError('The last known credit limit would be exceeded. Reconnect before overriding it.');
    }
  }

  const order: OrderRecord = {
    id: idempotencyKey,
    idempotencyKey,
    number: -1,
    storeId: input.storeId,
    storeName: snapshot.store?.name,
    staffId: input.staffId,
    shiftId: snapshot.shift.id,
    location: input.location,
    status: 'done',
    syncStatus: 'queued',
    verificationStatus: paymentMethod === 'tab' ? 'to_verify' : undefined,
    paymentMethod,
    customerId: input.customerId,
    note: input.note?.trim() || undefined,
    items,
    totalMillimes,
    createdAt: new Date().toISOString(),
  };
  return await offlineOrderQueue.enqueue({
    idempotencyKey,
    order,
    shift: snapshot.shift,
    input: {
      storeId: input.storeId,
      staffId: input.staffId,
      items,
      paymentMethod,
      customerId: input.customerId,
      location: input.location,
      note: input.note,
    },
  });
}

export interface ShiftSalesBreakdown {
  orderCount: number;
  cashSalesMillimes: number;
  cardSalesMillimes: number;
  otherSalesMillimes: number;
  tabSalesMillimes: number;
  tabPaymentsMillimes: number;
  voidsMillimes: number;
}

export const orderService = {
  async listToday(storeId: string, staffId?: string): Promise<OrderRecord[]> {
    const [currentBusinessDate, periodStart] = await Promise.all([
      getCurrentBusinessDate(storeId),
      getCurrentReportPeriodStart(storeId),
    ]);
    if (isSupabaseDriver()) return listRemoteOrders(storeId, staffId, currentBusinessDate, periodStart);
    const shifts = await shiftService.listShifts(storeId);
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return getOrders()
      .filter((order) => order.storeId === storeId &&
        (order.businessDate ?? dateKeyInTimezone(
          new Date(shiftById.get(order.shiftId)?.openedAt ?? order.createdAt),
          timeZone,
        )) === currentBusinessDate &&
        (!periodStart || new Date(order.createdAt).getTime() >= new Date(periodStart).getTime()) &&
        (!staffId || order.staffId === staffId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listAll(storeId: string): Promise<OrderRecord[]> {
    if (isSupabaseDriver()) return listRemoteOrders(storeId);
    return getOrders().filter((order) => order.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createOrder(input: { storeId: string; staffId: string; items: OrderLineRecord[]; paymentMethod?: PaymentMethod; customerId?: string; location?: string; adminPin?: string; note?: string; idempotencyKey?: string }): Promise<OrderRecord> {
    if (isSupabaseDriver()) {
      if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
      const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return createQueuedOrder(input, idempotencyKey);
      }
      try {
        const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
        if (!shift) throw new Error('The business day is closed. Open a new shift to continue.');
        const order = await createRemoteOrder({
          shift,
          items: input.items,
          idempotencyKey,
          paymentMethod: input.paymentMethod,
          customerId: input.customerId,
          location: input.location,
          adminPin: input.adminPin,
          note: input.note,
        });
        return { ...order, idempotencyKey };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Limit reached')) {
          throw new OrderServiceError('Limit reached. Tell the customer.');
        }
        if (offlineOrderQueue.isNetworkFailure(error) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          return createQueuedOrder(input, idempotencyKey);
        }
        throw error;
      }
    }
    if (input.items.length === 0) throw new Error('Add at least one item before completing an order.');
    const store = await userService.getStore(input.storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    const staff = await userService.getUser(input.staffId);
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('The business day is closed. Open a new shift to continue.');
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
    const dateKey = await getCurrentBusinessDate(input.storeId);
    const counters = readData<Record<string, { businessDate: string; nextNumber: number }>>('order-counters', {});
    const counter = counters[input.storeId];
    const number = counter?.businessDate === dateKey ? counter.nextNumber : 1;
    const order: OrderRecord = {
      id: `order-${input.storeId}-${dateKey}-${number}`,
      number,
      storeId: input.storeId,
      businessDate: dateKey,
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
    requireOnlineForAction('Voiding orders');
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
    assertOrderNotArchivedInZ(order);
    const cleanedReason = reason.trim();
    if (!cleanedReason) throw new Error('A reason is required to request an order void.');
    const updated = { ...order, status: 'pending_void' as const, voidRequestedAt: new Date().toISOString(), voidReason: cleanedReason };
    saveOrders(orders.map((candidate) => candidate.id === orderId ? updated : candidate));
    if (order.paymentMethod === 'cash' && (await shiftService.getShift(order.shiftId))?.status === 'closed') {
      await shiftService.recordClosedShiftVoidAdjustment({
        shiftId: order.shiftId,
        orderId: order.id,
        orderNumber: order.number,
        kind: 'requested',
        amountMillimes: -order.totalMillimes,
        actorId: staffId,
      });
    }
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
    requireOnlineForAction('Voiding orders');
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
    assertOrderNotArchivedInZ(order);
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
        kind: 'approved',
        amountMillimes: -order.totalMillimes,
        actorId,
      });
    }
    await restoreOrderStock(order, actorId);
    return updated;
  },

  async resolveVoidRequest(orderId: string, ownerId: string, decision: 'approve' | 'reject', reason?: string): Promise<OrderRecord> {
    requireOnlineForAction('Resolving void requests');
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
    assertOrderNotArchivedInZ(order);
    const store = await userService.getStore(order.storeId);
    if (!store || store.ownerId !== ownerId) {
      throw new Error('Only this store owner can resolve the request.');
    }
    const cleanedReason = reason?.trim() || order.voidReason?.trim() || '';
    const updated: OrderRecord = decision === 'approve'
      ? { ...order, status: 'voided', voidRequestedAt: undefined, voidedAt: new Date().toISOString(), voidedBy: 'owner', voidedByUserId: ownerId, voidReason: cleanedReason }
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
    if (decision === 'approve') {
      await restoreOrderStock(order, ownerId);
    } else if (order.paymentMethod === 'cash' && (await shiftService.getShift(order.shiftId))?.status === 'closed') {
      await shiftService.recordClosedShiftVoidAdjustment({
        shiftId: order.shiftId,
        orderId: order.id,
        orderNumber: order.number,
        kind: 'rejected',
        amountMillimes: order.totalMillimes,
        actorId: ownerId,
      });
    }
    await notificationService.notifyVoidResolved(updated, decision === 'approve');
    return updated;
  },

  async autoApprovePendingVoids(storeId: string, ownerId: string, shiftId?: string): Promise<OrderRecord[]> {
    if (isSupabaseDriver()) throw new Error('Pending void auto-approval is handled by the shift workflow.');
    const store = await userService.getStore(storeId);
    const owner = await userService.getUser(ownerId);
    if (!store || store.ownerId !== ownerId || owner?.role !== 'owner' || owner.storeId !== storeId) {
      throw new Error('Only this store owner can auto-approve pending voids.');
    }
    const orders = getOrders();
    const pending = orders.filter((order) => order.storeId === storeId &&
      order.status === 'pending_void' && (!shiftId || order.shiftId === shiftId));
    const approvedAt = new Date().toISOString();
    const approved = pending.map((order) => ({
      ...order,
      status: 'voided' as const,
      voidRequestedAt: undefined,
      voidedAt: approvedAt,
      voidedBy: 'owner',
      voidedByUserId: ownerId,
      voidReason: 'Auto-approved at forced close',
    }));
    const approvedById = new Map(approved.map((order) => [order.id, order]));
    saveOrders(orders.map((order) => approvedById.get(order.id) ?? order));
    for (const order of approved) {
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'order.voided',
        summary: `Auto-approved void for order #${order.number} at forced close.`,
        entityType: 'order',
        entityId: order.id,
        meta: {
          before: { status: 'pending_void', voidReason: order.voidReason },
          after: { status: 'voided', voidReason: order.voidReason },
        },
      });
      await restoreOrderStock(order, ownerId);
      await notificationService.notifyVoidResolved(order, true);
    }
    return approved;
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
    const cashTabPaymentsTotal = shiftTabPayments
      .filter((tab) => (tab.paymentMethod ?? 'cash') === 'cash')
      .reduce((sum, tab) => {
        if (tab.kind === 'settled') return sum + tab.amountMillimes;
        if (tab.kind === 'reversal') return sum - tab.amountMillimes;
        return sum;
      }, 0);
    return {
      orderCount: completedOrders.length,
      cashSalesMillimes: shiftOrders
        .filter((order) => order.status === 'done')
        .filter((order) => order.paymentMethod === 'cash')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      cardSalesMillimes: completedOrders
        .filter((order) => order.paymentMethod === 'card')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      otherSalesMillimes: completedOrders
        .filter((order) => order.paymentMethod === 'other')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      tabSalesMillimes: completedOrders
        .filter((order) => order.paymentMethod === 'tab')
        .reduce((sum, order) => sum + order.totalMillimes, 0),
      tabPaymentsMillimes: cashTabPaymentsTotal,
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
    if (isSupabaseDriver()) return 0;
    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('void-pin-attempts', {});
    return Math.max(0, (attempts[storeId]?.lockedUntil ?? 0) - Date.now());
  },

  async getTotalForToday(storeId: string, staffId?: string): Promise<number> {
    return (await this.listToday(storeId, staffId))
      .filter((order) => order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
  },

  async getNextOrderNumber(storeId: string): Promise<number> {
    if (isSupabaseDriver()) return getRemoteNextOrderNumber();
    const dateKey = await getCurrentBusinessDate(storeId);
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
