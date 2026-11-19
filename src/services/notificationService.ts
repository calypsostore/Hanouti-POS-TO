import {
  resolveStoreSettings,
  type CashMovementRecord,
  type NotificationRecord,
  type NotificationType,
  type OrderRecord,
  type StoreSettings,
  type UserRecord,
} from '../types/domain';
import { formatTnd } from '../lib/format';
import { readData, writeData } from './storage';
import { customerService } from './customerService';
import { userService } from './userService';

export interface CustomerCreditAlert {
  customerId: string;
  customerName: string;
  severity: 'warning' | 'error';
  message: string;
}

export const OWNER_NOTIFICATIONS_CHANGED_EVENT = 'owner-notifications-changed';
const USER_NOTIFICATION_PREFERENCES_KEY = 'notification-user-preferences';
const overdueChecks = new Map<string, Promise<number>>();

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OWNER_NOTIFICATIONS_CHANGED_EVENT));
}

function getNotifications(): NotificationRecord[] {
  const notifications = readData<Array<NotificationRecord & { staffId?: string; message?: string }>>('notifications', []);
  let migrated = false;
  const normalized = notifications.map((notification) => {
    const userId = notification.userId ?? notification.staffId;
    const body = notification.body ?? notification.message ?? '';
    if (userId === notification.userId && body === notification.body) return notification;
    migrated = true;
    return { ...notification, userId, body };
  });
  if (migrated) writeData('notifications', normalized);
  return normalized;
}

function getUserPreferences(): Record<string, Partial<Record<NotificationType, boolean>>> {
  return readData(USER_NOTIFICATION_PREFERENCES_KEY, {});
}

function userPreferenceEnabled(userId: string | undefined, type: NotificationType): boolean {
  if (!userId) return true;
  return getUserPreferences()[userId]?.[type] !== false;
}

function notificationEnabled(store: { settings?: StoreSettings } | undefined, type: NotificationType, userId?: string): boolean {
  return (!store || resolveStoreSettings(store.settings).notificationPreferences[type] !== false) &&
    userPreferenceEnabled(userId, type);
}

async function createForUser(
  user: Pick<UserRecord, 'id' | 'role' | 'storeId'>,
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt' | 'userId' | 'targetRole'>,
): Promise<NotificationRecord | undefined> {
  const store = await userService.getStore(input.storeId ?? user.storeId ?? '');
  if (!notificationEnabled(store, input.type, user.id)) return undefined;
  const notification: NotificationRecord = {
    ...input,
    userId: user.id,
    id: `notification-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  writeData('notifications', [...getNotifications(), notification]);
  notifyChanged();
  return notification;
}

async function notifyOwner(
  storeId: string,
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt' | 'userId' | 'targetRole' | 'storeId'>,
): Promise<void> {
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const owner = await userService.getUser(store.ownerId);
  if (!owner || owner.role !== 'owner' || owner.storeId !== store.id) {
    throw new Error('The store owner could not be found for notifications.');
  }
  await createForUser(owner, { ...input, storeId });
}

async function notifyOwnerAnd86Staff(
  storeId: string,
  type: 'stock_depleted' | 'item_86',
  catalogItemId: string,
  itemName: string,
): Promise<void> {
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const [owner, staff] = await Promise.all([
    userService.getUser(store.ownerId),
    userService.listUsers(storeId),
  ]);
  if (!owner || owner.role !== 'owner' || owner.storeId !== store.id) {
    throw new Error('The store owner could not be found for stock notifications.');
  }
  const authorizedStaff = await Promise.all(staff
    .filter((member) => member.role === 'staff')
    .map(async (member) => await userService.hasPermission(member.id, '86_items') ? member : undefined));
  const recipients = [owner, ...authorizedStaff.filter((member): member is NonNullable<typeof member> => member !== undefined)];
  await Promise.all(recipients.map((recipient) => createForUser(recipient, {
    storeId,
    type,
    title: type === 'stock_depleted' ? 'Stock depleted' : 'Item marked 86',
    body: type === 'stock_depleted'
      ? `${itemName} has reached 0 in tracked stock.`
      : `${itemName} was marked 86.`,
    entityType: 'catalog_item',
    entityId: catalogItemId,
    catalogItemId,
  })));
}

export const notificationService = {
  async create(input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt'>): Promise<NotificationRecord | undefined> {
    if (!input.userId && !input.targetRole) throw new Error('A notification recipient is required.');
    const { userId, targetRole, ...recordInput } = input;
    if (userId) {
      const user = await userService.getUser(userId);
      if (!user) throw new Error('The notification recipient could not be found.');
      return await createForUser(user, recordInput);
    }
    const matches = (await userService.listUsers(input.storeId))
      .filter((user) => user.isActive && user.role === targetRole);
    const created = await Promise.all(matches.map((user) => createForUser(user, recordInput)));
    return created.find((notification): notification is NotificationRecord => notification !== undefined);
  },

  async getPreference(userId: string, type: NotificationType): Promise<boolean> {
    return userPreferenceEnabled(userId, type);
  },

  async setPreference(userId: string, type: NotificationType, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Notification preference must be enabled or disabled.');
    const preferences = getUserPreferences();
    writeData(USER_NOTIFICATION_PREFERENCES_KEY, {
      ...preferences,
      [userId]: { ...preferences[userId], [type]: enabled },
    });
    notifyChanged();
  },

  async listFor(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>): Promise<NotificationRecord[]> {
    return getNotifications()
      .filter((notification) =>
        (!notification.storeId || notification.storeId === user.storeId) &&
        (notification.userId === user.id || notification.targetRole === user.role),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async unreadCount(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>): Promise<number> {
    return (await this.listFor(user)).filter((notification) => !notification.readAt).length;
  },

  async markRead(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>, notificationId: string): Promise<void> {
    const notifications = getNotifications();
    const target = notifications.find((notification) =>
      notification.id === notificationId &&
      (!notification.storeId || notification.storeId === user.storeId) &&
      (notification.userId === user.id || notification.targetRole === user.role),
    );
    if (!target) throw new Error('Notification could not be found.');
    if (target.readAt) return;
    writeData('notifications', notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: new Date().toISOString() } : notification,
    ));
    notifyChanged();
  },

  async markAllRead(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>): Promise<void> {
    const notifications = getNotifications();
    const readAt = new Date().toISOString();
    let changed = false;
    const updated = notifications.map((notification) => {
      if (notification.readAt ||
        (notification.storeId && notification.storeId !== user.storeId) ||
        (notification.userId !== user.id && notification.targetRole !== user.role)) return notification;
      changed = true;
      return { ...notification, readAt };
    });
    if (changed) {
      writeData('notifications', updated);
      notifyChanged();
    }
  },

  async checkOverdueCustomers(storeId: string, ownerId: string): Promise<number> {
    const key = `${storeId}:${ownerId}`;
    const currentCheck = overdueChecks.get(key);
    if (currentCheck) return currentCheck;
    const check = (async () => {
      const store = await userService.getStore(storeId);
      const owner = await userService.getUser(ownerId);
      if (!store || !owner || store.ownerId !== ownerId || owner.role !== 'owner') {
        throw new Error('The store owner could not be found for overdue notifications.');
      }
      if (!notificationEnabled(store, 'customer_overdue', ownerId)) return 0;
      const overdueCustomers = await customerService.listOverdueCustomers(storeId);
      const existing = getNotifications();
      const additions = overdueCustomers
        .filter(({ customer, dueInfo }) => !existing.some((notification) =>
          notification.type === 'customer_overdue' &&
          notification.storeId === storeId &&
          notification.userId === ownerId &&
          (notification.entityId ?? notification.customerId) === customer.id &&
          notification.dueAt === dueInfo.nextDueAt,
        ))
        .map(({ customer, dueInfo, balanceMillimes }) => ({
          id: `notification-${crypto.randomUUID()}`,
          storeId,
          userId: ownerId,
          type: 'customer_overdue' as const,
          title: 'Customer tab overdue',
          body: `${customer.name} is overdue on their customer tab. The oldest unpaid balance is ${formatTnd(balanceMillimes / 1000)} DT.`,
          entityType: 'customer',
          entityId: customer.id,
          customerId: customer.id,
          dueAt: dueInfo.nextDueAt,
          createdAt: new Date().toISOString(),
        }));
      if (additions.length > 0) {
        writeData('notifications', [...existing, ...additions]);
        notifyChanged();
      }
      return additions.length;
    })();
    overdueChecks.set(key, check);
    try {
      return await check;
    } finally {
      if (overdueChecks.get(key) === check) overdueChecks.delete(key);
    }
  },

  async checkSubscriptionExpiring(storeId: string): Promise<void> {
    const store = await userService.getStore(storeId);
    if (!store?.subscription?.paidUntil) return;
    const expiry = new Date(`${store.subscription.paidUntil}T00:00:00`);
    if (Number.isNaN(expiry.getTime())) throw new Error('The store subscription expiry date is invalid.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysRemaining = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
    if (daysRemaining !== 7) return;
    const owner = await userService.getUser(store.ownerId);
    if (!owner || owner.role !== 'owner') throw new Error('The store owner could not be found for subscription notifications.');
    const alreadyNotified = getNotifications().some((notification) =>
      notification.userId === owner.id &&
      notification.type === 'subscription_expiring' &&
      notification.entityId === store.subscription?.paidUntil,
    );
    if (alreadyNotified) return;
    await createForUser(owner, {
      storeId,
      type: 'subscription_expiring',
      title: 'Subscription expiring soon',
      body: `Your store subscription expires on ${store.subscription.paidUntil}.`,
      entityType: 'store',
      entityId: store.subscription.paidUntil,
    });
  },

  async notifyVoidRequested(order: OrderRecord): Promise<void> {
    const staff = await userService.getUser(order.staffId);
    await notifyOwner(order.storeId, {
      type: 'void_requested',
      title: 'Void request awaiting review',
      body: `${staff?.name ?? 'A staff member'} requested to void order #${order.number}.`,
      entityType: 'order',
      entityId: order.id,
    });
  },

  async notifyVoidResolved(order: OrderRecord, approved: boolean): Promise<void> {
    const staff = await userService.getUser(order.staffId);
    if (!staff) throw new Error('The staff member who requested this void could not be found.');
    await createForUser(staff, {
      storeId: order.storeId,
      type: approved ? 'void_approved' : 'void_rejected',
      title: approved ? 'Void request approved' : 'Void request rejected',
      body: approved
        ? `Your request to void order #${order.number} was approved.`
        : `Your request to void order #${order.number} was rejected.`,
      entityType: 'order',
      entityId: order.id,
    });
  },

  async publishSchedule(storeId: string, staffIds: string[], weekLabel: string): Promise<void> {
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    const staff = await Promise.all([...new Set(staffIds)].map((id) => userService.getUser(id)));
    await Promise.all(staff.filter((member): member is NonNullable<typeof member> => member?.role === 'staff').map((member) =>
      createForUser(member, {
        storeId,
        type: 'schedule_published',
        title: 'Schedule published',
        body: `Your work schedule for ${weekLabel} is published.`,
        entityType: 'schedule',
        entityId: weekLabel,
      }),
    ));
  },

  async notifyStockDepleted(storeId: string, catalogItemId: string, itemName: string): Promise<void> {
    await notifyOwnerAnd86Staff(storeId, 'stock_depleted', catalogItemId, itemName);
  },

  async notifyItemMarked86(storeId: string, catalogItemId: string, itemName: string): Promise<void> {
    await notifyOwnerAnd86Staff(storeId, 'item_86', catalogItemId, itemName);
  },

  async notifyLowStock(storeId: string, catalogItemId: string, itemName: string, stockCount: number, threshold: number): Promise<void> {
    await notifyOwner(storeId, {
      type: 'low_stock',
      title: 'Low stock',
      body: `${itemName} has ${stockCount} units remaining (low-stock threshold: ${threshold}).`,
      entityType: 'catalog_item',
      entityId: catalogItemId,
      catalogItemId,
    });
  },

  async notifyShiftOpened(shiftId: string, storeId: string, staffName: string): Promise<void> {
    await notifyOwner(storeId, {
      type: 'shift_opened',
      title: 'Shift opened',
      body: `${staffName} opened a shift.`,
      entityType: 'shift',
      entityId: shiftId,
      shiftId,
    });
  },

  async notifyShiftClosed(shiftId: string, storeId: string, staffName: string, differenceMillimes: number): Promise<void> {
    await notifyOwner(storeId, {
      type: 'shift_closed',
      title: 'Shift closed',
      body: `${staffName} closed their shift.`,
      entityType: 'shift',
      entityId: shiftId,
      shiftId,
    });
    if (differenceMillimes !== 0) {
      await notifyOwner(storeId, {
        type: 'cash_difference',
        title: 'Cash difference at close',
        body: `${staffName}'s shift closed with a cash difference of ${formatTnd(differenceMillimes / 1000)} DT.`,
        entityType: 'shift',
        entityId: shiftId,
        shiftId,
      });
    }
  },

  async notifyCashOutAboveThreshold(movement: CashMovementRecord, staffName: string): Promise<void> {
    const store = await userService.getStore(movement.storeId);
    if (!store) throw new Error('The store could not be found.');
    const thresholdMillimes = store.cashOutAlertThresholdMillimes ?? 50_000;
    if (movement.kind !== 'out' || movement.amountMillimes <= thresholdMillimes) return;
    await notifyOwner(store.id, {
      type: 'cash_out_alert',
      title: 'Large cash withdrawal',
      body: `${staffName} recorded a cash out of ${formatTnd(movement.amountMillimes / 1000)} DT for ${movement.reason}${movement.note ? `: ${movement.note}` : '.'}`,
      entityType: 'cash_movement',
      entityId: movement.id,
      shiftId: movement.shiftId,
      cashMovementId: movement.id,
    });
  },

  async notifyCustomerCreditThresholds(
    storeId: string,
    customerId: string,
    customerName: string,
    previousPercent: number,
    currentPercent: number,
  ): Promise<void> {
    const reached80 = previousPercent < 80 && currentPercent >= 80;
    const reached100 = previousPercent < 100 && currentPercent >= 100;
    if (!reached80 && !reached100) return;
    if (reached80) {
      await notifyOwner(storeId, {
        type: 'customer_credit_warning',
        title: 'Customer nearing credit limit',
        body: `${customerName} has used at least 80% of their credit limit.`,
        entityType: 'customer',
        entityId: customerId,
        customerId,
      });
    }
    if (reached100) {
      await notifyOwner(storeId, {
        type: 'customer_credit_limit',
        title: 'Customer credit limit reached',
        body: `${customerName} has reached their credit limit.`,
        entityType: 'customer',
        entityId: customerId,
        customerId,
      });
    }
  },

  async notifyZReportClosed(storeId: string, reportId: string, zNumber?: number): Promise<void> {
    await notifyOwner(storeId, {
      type: 'z_report_closed',
      title: 'Z report closed',
      body: zNumber === undefined ? 'The Z report was closed.' : `Z report #${zNumber} was closed.`,
      entityType: 'report',
      entityId: reportId,
    });
  },

  async notifyAppUpdate(version: string): Promise<void> {
    const users = (await userService.listUsers()).filter((user) => user.isActive);
    const existing = getNotifications();
    const recipients = users.filter((user) => !existing.some((notification) =>
      notification.type === 'app_update' && notification.userId === user.id && notification.entityId === version,
    ));
    await Promise.all(recipients.map((user) => createForUser(user, {
      type: 'app_update',
      title: 'New app version available',
      body: `Version ${version} is ready to install.`,
      entityType: 'app',
      entityId: version,
    })));
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
