import type { CashMovementRecord, NotificationRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { customerService } from './customerService';
import { userService } from './userService';
import { formatTnd } from '../lib/format';

export interface CustomerCreditAlert {
  customerId: string;
  customerName: string;
  severity: 'warning' | 'error';
  message: string;
}

const getNotifications = () => readData<NotificationRecord[]>('notifications', []);
const overdueChecks = new Map<string, Promise<number>>();

async function createOverdueNotifications(storeId: string, ownerId: string): Promise<number> {
  const store = await userService.getStore(storeId);
  if (!store || store.ownerId !== ownerId) {
    throw new Error('The store owner could not be found for overdue notifications.');
  }
  const overdueCustomers = await customerService.listOverdueCustomers(storeId);
  const existing = getNotifications();
  const createdAt = new Date().toISOString();
  const additions: NotificationRecord[] = overdueCustomers
    .filter(({ customer, dueInfo }) =>
      !existing.some((notification) =>
        notification.type === 'customer_overdue' &&
        notification.storeId === storeId &&
        notification.customerId === customer.id &&
        notification.dueAt === dueInfo.nextDueAt,
      ),
    )
    .map(({ customer, dueInfo, balanceMillimes }) => ({
      id: `notification-${crypto.randomUUID()}`,
      storeId,
      staffId: ownerId,
      type: 'customer_overdue',
      title: 'Customer tab overdue',
      message: `${customer.name} is overdue on their customer tab. The oldest unpaid balance is ${formatTnd(balanceMillimes / 1000)} DT.`,
      customerId: customer.id,
      dueAt: dueInfo.nextDueAt,
      createdAt,
    }));
  if (additions.length > 0) writeData('notifications', [...existing, ...additions]);
  return additions.length;
}

export const notificationService = {
  async checkOverdueCustomers(storeId: string, ownerId: string): Promise<number> {
    const key = `${storeId}:${ownerId}`;
    const currentCheck = overdueChecks.get(key);
    if (currentCheck) return currentCheck;
    const check = createOverdueNotifications(storeId, ownerId);
    overdueChecks.set(key, check);
    try {
      return await check;
    } finally {
      if (overdueChecks.get(key) === check) overdueChecks.delete(key);
    }
  },

  async publishSchedule(storeId: string, staffIds: string[], weekLabel: string): Promise<void> {
    const staffToNotify = [...new Set(staffIds)];
    if (staffToNotify.length === 0) return;
    const createdAt = new Date().toISOString();
    const additions: NotificationRecord[] = staffToNotify.map((staffId) => ({
      id: `notification-${crypto.randomUUID()}`,
      storeId,
      staffId,
      type: 'schedule_published',
      title: 'Schedule published',
      message: `Your work schedule for ${weekLabel} is published.`,
      createdAt,
    }));
    writeData('notifications', [...getNotifications(), ...additions]);
  },

  async notifyStockDepleted(storeId: string, catalogItemId: string, itemName: string): Promise<void> {
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    const owner = await userService.getUser(store.ownerId);
    if (!owner || owner.role !== 'owner' || owner.storeId !== store.id) {
      throw new Error('The store owner could not be found for stock notifications.');
    }
    const notification: NotificationRecord = {
      id: `notification-${crypto.randomUUID()}`,
      storeId,
      staffId: owner.id,
      type: 'stock_depleted',
      title: 'Stock depleted',
      message: `${itemName} has reached 0 in tracked stock and was marked 86.`,
      catalogItemId,
      createdAt: new Date().toISOString(),
    };
    writeData('notifications', [...getNotifications(), notification]);
  },

  async notifyCashOutAboveThreshold(movement: CashMovementRecord, staffName: string): Promise<void> {
    const store = await userService.getStore(movement.storeId);
    if (!store) throw new Error('The store could not be found.');
    const thresholdMillimes = store.cashOutAlertThresholdMillimes ?? 50_000;
    if (movement.kind !== 'out' || movement.amountMillimes <= thresholdMillimes) return;
    const owner = await userService.getUser(store.ownerId);
    if (!owner || owner.role !== 'owner' || owner.storeId !== store.id) {
      throw new Error('The store owner could not be found for cash movement notifications.');
    }
    const notification: NotificationRecord = {
      id: `notification-${crypto.randomUUID()}`,
      storeId: store.id,
      staffId: owner.id,
      type: 'cash_out_alert',
      title: 'Large cash withdrawal',
      message: `${staffName} recorded a cash out of ${formatTnd(movement.amountMillimes / 1000)} DT for ${movement.reason}${movement.note ? `: ${movement.note}` : '.'}`,
      shiftId: movement.shiftId,
      cashMovementId: movement.id,
      createdAt: new Date().toISOString(),
    };
    writeData('notifications', [...getNotifications(), notification]);
  },

  async notifyCustomerCreditThresholds(
    storeId: string,
    customerId: string,
    customerName: string,
    previousPercent: number,
    currentPercent: number,
  ): Promise<void> {
    const notifyAt80 = previousPercent < 80 && currentPercent >= 80;
    const notifyAt100 = previousPercent < 100 && currentPercent >= 100;
    if (!notifyAt80 && !notifyAt100) return;
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    const owner = await userService.getUser(store.ownerId);
    if (!owner || owner.role !== 'owner' || owner.storeId !== store.id) {
      throw new Error('The store owner could not be found for credit notifications.');
    }

    const additions: NotificationRecord[] = [];
    if (notifyAt80) {
      additions.push({
        id: `notification-${crypto.randomUUID()}`,
        storeId,
        staffId: owner.id,
        type: 'customer_credit_warning',
        title: 'Customer nearing credit limit',
        message: `${customerName} has used at least 80% of their credit limit.`,
        customerId,
        createdAt: new Date().toISOString(),
      });
    }
    if (notifyAt100) {
      additions.push({
        id: `notification-${crypto.randomUUID()}`,
        storeId,
        staffId: owner.id,
        type: 'customer_credit_limit',
        title: 'Customer credit limit reached',
        message: `${customerName} has reached their credit limit.`,
        customerId,
        createdAt: new Date().toISOString(),
      });
    }
    if (additions.length > 0) writeData('notifications', [...getNotifications(), ...additions]);
  },

  async listForStaff(storeId: string, staffId: string): Promise<NotificationRecord[]> {
    return getNotifications()
      .filter((notification) => notification.storeId === storeId && notification.staffId === staffId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async listCustomerCreditAlerts(storeId: string): Promise<CustomerCreditAlert[]> {
    const customers = await customerService.listCustomers(storeId);
    const alerts = await Promise.all(customers.map(async (customer): Promise<CustomerCreditAlert | undefined> => {
      const [credit, due] = await Promise.all([
        customerService.getCreditStatus(customer.id),
        customerService.getDueInfo(customer),
      ]);
      if (due.overdue) {
        return { customerId: customer.id, customerName: customer.name, severity: 'error', message: 'Customer tab payment is overdue.' };
      }
      if (credit.limit !== undefined && (credit.percentUsed ?? 0) >= 100) {
        return { customerId: customer.id, customerName: customer.name, severity: 'error', message: 'Customer has reached their credit limit.' };
      }
      if (credit.state === 'near') {
        return { customerId: customer.id, customerName: customer.name, severity: 'warning', message: 'Customer is near their credit limit.' };
      }
      return undefined;
    }));
    return alerts.filter((alert): alert is CustomerCreditAlert => alert !== undefined);
  },
};
