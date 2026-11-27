import {
  type CatalogItemRecord,
  resolveStoreSettings,
  type CashMovementRecord,
  type CustomerRecord,
  type NotificationRecord,
  type NotificationType,
  type OrderRecord,
  type StoreSettings,
  type UserRecord,
} from '../types/domain';
import { formatMillimesAmountsInText } from '../lib/format';
import { readData, writeData } from './storage';
import { customerService } from './customerService';
import type { CustomerCreditStatus, CustomerDueInfo } from './customerService';
import { userService } from './userService';
import { getSubscriptionDaysRemaining } from '../lib/subscriptionExpiry';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import { permissionService } from './permissionService';
import { compareNotificationsNewestFirst, type NotificationCursor } from '../lib/notificationOrder';
import { t } from '../i18n';
import { createNotificationContent, getNotificationContent, type NotificationContentValues } from '../lib/notificationContent';

export interface CustomerCreditAlert {
  customerId: string;
  customerName: string;
  kind: 'overdue' | 'limit' | 'nearLimit';
  severity: 'warning' | 'error';
}

export const OWNER_NOTIFICATIONS_CHANGED_EVENT = 'owner-notifications-changed';
export const OWNER_DASHBOARD_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'customer_overdue',
  'stock_depleted',
  'item_86',
  'low_stock',
  'cash_out_alert',
  'cash_difference',
  'void_requested',
  'subscription_expiring',
];
const USER_NOTIFICATION_PREFERENCES_KEY = 'notification-user-preferences';
const overdueChecks = new Map<string, Promise<number>>();
const subscriptionChecks = new Map<string, Promise<void>>();

export function keepUnresolvedItem86Notifications(
  notifications: NotificationRecord[],
  catalogItems: Pick<CatalogItemRecord, 'id' | 'outOfStock'>[],
): NotificationRecord[] {
  const outOfStockById = new Map(catalogItems.map((item) => [item.id, item.outOfStock]));
  return notifications.filter((notification) => {
    if (notification.type !== 'item_86' || !notification.catalogItemId) return true;
    return outOfStockById.get(notification.catalogItemId) !== false;
  });
}

export function selectOwnerDashboardNotifications(
  notifications: NotificationRecord[],
  catalogItems: Pick<CatalogItemRecord, 'id' | 'outOfStock'>[],
): NotificationRecord[] {
  return keepUnresolvedItem86Notifications(
    [...notifications].sort(compareNotificationsNewestFirst),
    catalogItems,
  )
    .slice(0, 5)
    .filter((notification) => !notification.readAt);
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OWNER_NOTIFICATIONS_CHANGED_EVENT));
}

async function showLocalNotificationForActiveUser(notification: NotificationRecord): Promise<void> {
  if (notification.type === 'app_update') return;
  try {
    const content = getNotificationContent(notification);
    await permissionService.showLocalNotification(content.title, content.body, notification);
  } catch (error) {
    console.error('[notifications] Could not show a local notification.', error);
  }
}

function mapNotificationContentValues(value: unknown): NotificationContentValues | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string | number] =>
    typeof entry[1] === 'string' || (typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  );
  return Object.fromEntries(entries);
}

function getNotifications(): NotificationRecord[] {
  const notifications = readData<Array<NotificationRecord & { staffId?: string; message?: string }>>('notifications', []);
  let migrated = false;
  const normalized = notifications.map((notification) => {
    const userId = notification.userId ?? notification.staffId;
    const body = formatMillimesAmountsInText(notification.body ?? notification.message ?? '');
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
    (isSupabaseDriver() || userPreferenceEnabled(userId, type));
}

export function shouldRegisterPushNotifications(
  enabled: boolean,
  isNative: boolean,
  usesSupabase: boolean,
  storeId?: string,
): boolean {
  return enabled && isNative && usesSupabase && Boolean(storeId);
}

export function notificationRecipientFilter(
  user: Pick<UserRecord, 'id' | 'role'>,
  cursor?: NotificationCursor,
  direction: 'after' | 'before' = 'before',
): string {
  if (!cursor) return `user_id.eq.${user.id},and(user_id.is.null,target_role.eq.${user.role})`;

  const operator = direction === 'after' ? 'gt' : 'lt';
  return [
    `and(user_id.eq.${user.id},created_at.${operator}.${cursor.createdAt})`,
    `and(user_id.eq.${user.id},created_at.eq.${cursor.createdAt},id.${operator}.${cursor.id})`,
    `and(user_id.is.null,target_role.eq.${user.role},created_at.${operator}.${cursor.createdAt})`,
    `and(user_id.is.null,target_role.eq.${user.role},created_at.eq.${cursor.createdAt},id.${operator}.${cursor.id})`,
  ].join(',');
}

export function mapNotificationRow(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    storeId: typeof row.store_id === 'string' ? row.store_id : undefined,
    userId: typeof row.user_id === 'string' ? row.user_id : undefined,
    targetRole: typeof row.target_role === 'string' ? row.target_role as UserRecord['role'] : undefined,
    type: String(row.type) as NotificationType,
    title: String(row.title),
    body: formatMillimesAmountsInText(String(row.body)),
    createdAt: String(row.created_at),
    entityType: typeof row.entity_type === 'string' ? row.entity_type : undefined,
    entityId: typeof row.entity_id === 'string' ? row.entity_id : undefined,
    readAt: typeof row.read_at === 'string' ? row.read_at : undefined,
    staffId: typeof row.staff_id === 'string' ? row.staff_id : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    customerId: typeof row.customer_id === 'string' ? row.customer_id : undefined,
    catalogItemId: typeof row.catalog_item_id === 'string' ? row.catalog_item_id : undefined,
    shiftId: typeof row.shift_id === 'string' ? row.shift_id : undefined,
    cashMovementId: typeof row.cash_movement_id === 'string' ? row.cash_movement_id : undefined,
    dueAt: typeof row.due_at === 'string' ? row.due_at : undefined,
    contentValues: mapNotificationContentValues(row.content_values),
  };
}

async function createForUser(
  user: Pick<UserRecord, 'id' | 'role' | 'storeId'>,
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt' | 'userId' | 'targetRole'>,
): Promise<NotificationRecord | undefined> {
  const body = formatMillimesAmountsInText(input.body);
  if (isSupabaseDriver()) {
    const storeId = input.storeId ?? user.storeId;
    if (!storeId) throw new Error('A store is required to create a notification.');
    const { data, error } = await getSupabaseClient().rpc('create_localized_notification', {
      p_store_id: storeId,
      p_user_id: user.id,
      p_target_role: null,
      p_type: input.type,
      p_title: input.title,
      p_body: body,
      p_entity_type: input.entityType ?? null,
      p_entity_id: input.entityId ?? null,
      p_staff_id: input.staffId ?? null,
      p_message: input.message ?? null,
      p_customer_id: input.customerId ?? null,
      p_catalog_item_id: input.catalogItemId ?? null,
      p_shift_id: input.shiftId ?? null,
      p_cash_movement_id: input.cashMovementId ?? null,
      p_due_at: input.dueAt ?? null,
      p_content_values: input.contentValues ?? {},
    });
    if (error) throw new Error(`Could not create notification: ${error.message}`, { cause: error });
    if (!data) return undefined;
    const row = data as Record<string, unknown>;
    const notification = mapNotificationRow(row);
    notifyChanged();
    return notification;
  }
  const store = await userService.getStore(input.storeId ?? user.storeId ?? '');
  if (!notificationEnabled(store, input.type, user.id)) return undefined;
  const notification: NotificationRecord = {
    ...input,
    body,
    userId: user.id,
    id: `notification-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  writeData('notifications', [...getNotifications(), notification]);
  notifyChanged();
  await showLocalNotificationForActiveUser(notification);
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
    ...createNotificationContent(type, { name: itemName }),
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
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient().rpc('get_notification_preference', { p_type: type });
      if (error) throw new Error(`Could not load notification preferences: ${error.message}`, { cause: error });
      return data === true;
    }
    return userPreferenceEnabled(userId, type);
  },

  async setPreference(userId: string, type: NotificationType, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Notification preference must be enabled or disabled.');
    if (isSupabaseDriver()) {
      const user = await userService.getUser(userId);
      if (!user?.storeId) throw new Error('The notification preference owner could not be found.');
      const { error } = await getSupabaseClient().from('notification_preferences').upsert({
        store_id: user.storeId,
        user_id: userId,
        type,
        enabled,
      });
      if (error) throw new Error(`Could not save notification preference: ${error.message}`, { cause: error });
      notifyChanged();
      return;
    }
    const preferences = getUserPreferences();
    writeData(USER_NOTIFICATION_PREFERENCES_KEY, {
      ...preferences,
      [userId]: { ...preferences[userId], [type]: enabled },
    });
    notifyChanged();
  },

  async listFor(
    user: Pick<UserRecord, 'id' | 'role' | 'storeId'>,
    before?: NotificationCursor,
  ): Promise<NotificationRecord[]> {
    if (isSupabaseDriver()) {
      if (!user.storeId) return [];
      const query = getSupabaseClient()
        .from('notifications')
        .select('*')
        .eq('store_id', user.storeId)
        .or(notificationRecipientFilter(user, before, 'before'))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);
      const { data, error } = await query;
      if (error) throw new Error(`Could not load notifications: ${error.message}`, { cause: error });
      return (data ?? [])
        .map((row) => mapNotificationRow(row as unknown as Record<string, unknown>))
        .sort(compareNotificationsNewestFirst);
    }
    const notifications = getNotifications()
      .filter((notification) =>
        (!notification.storeId || notification.storeId === user.storeId) &&
        (notification.userId === user.id || notification.targetRole === user.role),
      )
      .sort(compareNotificationsNewestFirst);
    return notifications
      .filter((notification) => !before || compareNotificationsNewestFirst(notification, before) > 0)
      .slice(0, 50);
  },

  async listImportantForDashboard(
    user: Pick<UserRecord, 'id' | 'role' | 'storeId'>,
  ): Promise<NotificationRecord[]> {
    if (isSupabaseDriver()) {
      if (!user.storeId) return [];
      const { data, error } = await getSupabaseClient()
        .from('notifications')
        .select('*')
        .eq('store_id', user.storeId)
        .in('type', [...OWNER_DASHBOARD_NOTIFICATION_TYPES])
        .or(notificationRecipientFilter(user))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);
      if (error) throw new Error(`Could not load owner dashboard notifications: ${error.message}`, { cause: error });
      return (data ?? [])
        .map((row) => mapNotificationRow(row as unknown as Record<string, unknown>))
        .sort(compareNotificationsNewestFirst);
    }
    return getNotifications()
      .filter((notification) =>
        (!notification.storeId || notification.storeId === user.storeId) &&
        (notification.userId === user.id || notification.targetRole === user.role) &&
        OWNER_DASHBOARD_NOTIFICATION_TYPES.includes(notification.type),
      )
      .sort(compareNotificationsNewestFirst)
      .slice(0, 50);
  },

  async unreadCount(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>): Promise<number> {
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient().rpc('unread_notification_count');
      if (error) throw new Error(`Could not load unread notification count: ${error.message}`, { cause: error });
      return typeof data === 'number' ? data : Number(data ?? 0);
    }
    return getNotifications().filter((notification) =>
      !notification.readAt &&
      (!notification.storeId || notification.storeId === user.storeId) &&
      (notification.userId === user.id || notification.targetRole === user.role),
    ).length;
  },

  async markRead(user: Pick<UserRecord, 'id' | 'role' | 'storeId'>, notificationId: string): Promise<void> {
    if (isSupabaseDriver()) {
      if (!user.storeId) throw new Error('A store is required to update notifications.');
      const { data, error } = await getSupabaseClient().rpc('mark_notifications_read', { p_ids: [notificationId] });
      if (error) throw new Error(`Could not mark notification as read: ${error.message}`, { cause: error });
      if (typeof data !== 'number' || data < 1) throw new Error('Notification could not be found.');
      notifyChanged();
      return;
    }
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
    if (isSupabaseDriver()) {
      if (!user.storeId) throw new Error('A store is required to update notifications.');
      const { data, error } = await getSupabaseClient().rpc('mark_notifications_read', { p_ids: null });
      if (error) throw new Error(`Could not mark notifications as read: ${error.message}`, { cause: error });
      if (typeof data !== 'number') throw new Error('Could not mark notifications as read.');
      notifyChanged();
      return;
    }
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
      const existing = isSupabaseDriver() ? await this.listFor(owner) : getNotifications();
      const additions = overdueCustomers
        .filter(({ customer, dueInfo }) => !existing.some((notification) =>
          notification.type === 'customer_overdue' &&
          notification.storeId === storeId &&
          notification.userId === ownerId &&
          (notification.entityId ?? notification.customerId) === customer.id &&
          notification.dueAt === dueInfo.nextDueAt,
        ))
        .map(({ customer, dueInfo, balanceMillimes }) => ({
          storeId,
          userId: ownerId,
          type: 'customer_overdue' as const,
          ...createNotificationContent('customer_overdue', {
            name: customer.name,
            amount: balanceMillimes / 1000,
          }),
          entityType: 'customer',
          entityId: customer.id,
          customerId: customer.id,
          dueAt: dueInfo.nextDueAt,
        }));
      if (additions.length > 0) {
        if (isSupabaseDriver()) {
          await Promise.all(additions.map((addition) => createForUser(owner, addition)));
        } else {
          const createdNotifications = additions.map((addition) => ({
            ...addition,
            id: `notification-${crypto.randomUUID()}`,
            createdAt: new Date().toISOString(),
          }));
          writeData('notifications', [...existing, ...createdNotifications]);
          await Promise.all(createdNotifications.map(showLocalNotificationForActiveUser));
        }
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
    const currentCheck = subscriptionChecks.get(storeId);
    if (currentCheck) return currentCheck;
    const check = (async () => {
      const store = await userService.getStore(storeId);
      if (!store?.subscription?.paidUntil) return;
      const daysRemaining = getSubscriptionDaysRemaining(store.subscription.paidUntil);
      if (daysRemaining === null) throw new Error('The store subscription expiry date is invalid.');
      if (daysRemaining !== 7) return;
      const owner = await userService.getUser(store.ownerId);
      if (!owner || owner.role !== 'owner') throw new Error('The store owner could not be found for subscription notifications.');
      const alreadyNotified = (isSupabaseDriver() ? await this.listFor(owner) : getNotifications()).some((notification) =>
        notification.userId === owner.id &&
        notification.type === 'subscription_expiring' &&
        notification.entityId === store.subscription?.paidUntil,
      );
      if (alreadyNotified) return;
      await createForUser(owner, {
        storeId,
        type: 'subscription_expiring',
        ...createNotificationContent('subscription_expiring', { date: store.subscription.paidUntil }),
        entityType: 'store',
        entityId: store.subscription.paidUntil,
      });
    })();
    subscriptionChecks.set(storeId, check);
    try {
      await check;
    } finally {
      if (subscriptionChecks.get(storeId) === check) subscriptionChecks.delete(storeId);
    }
  },

  async notifyVoidRequested(order: OrderRecord): Promise<void> {
    const staff = await userService.getUser(order.staffId);
    await notifyOwner(order.storeId, {
      type: 'void_requested',
      ...createNotificationContent('void_requested', {
        name: staff?.name ?? t('notificationsContent.staffMember'),
        number: order.number,
      }),
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
      ...createNotificationContent(approved ? 'void_approved' : 'void_rejected', { number: order.number }),
      entityType: 'order',
      entityId: order.id,
    });
  },

  async publishSchedule(storeId: string, staffIds: string[], weekStart: string, weekEnd: string): Promise<void> {
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    const staff = await Promise.all([...new Set(staffIds)].map((id) => userService.getUser(id)));
    await Promise.all(staff.filter((member): member is NonNullable<typeof member> => member?.role === 'staff').map((member) =>
      createForUser(member, {
        storeId,
        type: 'schedule_published',
        ...createNotificationContent('schedule_published', { weekStart, weekEnd }),
        entityType: 'schedule',
        entityId: weekStart,
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
      ...createNotificationContent('low_stock', { name: itemName, count: stockCount, threshold }),
      entityType: 'catalog_item',
      entityId: catalogItemId,
      catalogItemId,
    });
  },

  async notifyShiftOpened(shiftId: string, storeId: string, staffName: string): Promise<void> {
    await notifyOwner(storeId, {
      type: 'shift_opened',
      ...createNotificationContent('shift_opened', { name: staffName }),
      entityType: 'shift',
      entityId: shiftId,
      shiftId,
    });
  },

  async notifyShiftClosed(shiftId: string, storeId: string, staffName: string, differenceMillimes: number): Promise<void> {
    await notifyOwner(storeId, {
      type: 'shift_closed',
      ...createNotificationContent('shift_closed', { name: staffName }),
      entityType: 'shift',
      entityId: shiftId,
      shiftId,
    });
    if (differenceMillimes !== 0) {
      await notifyOwner(storeId, {
        type: 'cash_difference',
        ...createNotificationContent('cash_difference', {
          name: staffName,
          amount: differenceMillimes / 1000,
        }),
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
      ...createNotificationContent('cash_out_alert', {
        name: staffName,
        amount: movement.amountMillimes / 1000,
        reason: movement.reason,
        note: movement.note ?? '',
      }),
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
        ...createNotificationContent('customer_credit_warning', { name: customerName }),
        entityType: 'customer',
        entityId: customerId,
        customerId,
      });
    }
    if (reached100) {
      await notifyOwner(storeId, {
        type: 'customer_credit_limit',
        ...createNotificationContent('customer_credit_limit', { name: customerName }),
        entityType: 'customer',
        entityId: customerId,
        customerId,
      });
    }
  },

  async notifyZReportClosed(storeId: string, reportId: string, zNumber?: number): Promise<void> {
    await notifyOwner(storeId, {
      type: 'z_report_closed',
      ...createNotificationContent('z_report_closed', zNumber === undefined ? {} : { number: zNumber }),
      entityType: 'report',
      entityId: reportId,
    });
  },

  async notifyAppUpdate(version: string, buildId: string): Promise<void> {
    const users = (await userService.listUsers()).filter((user) => user.isActive && (!isSupabaseDriver() || user.storeId));
    const recipients = await Promise.all(users.map(async (user) => {
      const existing = isSupabaseDriver() ? await this.listFor(user) : getNotifications();
      return existing.some((notification) =>
        notification.type === 'app_update' && notification.userId === user.id && notification.entityId === buildId,
      ) ? undefined : user;
    }));
    const content = createNotificationContent('app_update', { version, build: buildId });
    await Promise.all(recipients.filter((user): user is NonNullable<typeof user> => Boolean(user)).map((user) => createForUser(user, {
      type: 'app_update',
      ...content,
      entityType: 'app',
      entityId: buildId,
    })));
    try {
      await permissionService.showLocalNotification(content.title, content.body);
    } catch (error) {
      console.error('[notifications] Could not show the app update notification.', error);
    }
  },

  async listCustomerCreditAlerts(
    storeId: string,
    loadedCustomers?: CustomerRecord[],
    loadedData?: {
      creditStatuses: Record<string, CustomerCreditStatus>;
      dueInfos: Record<string, CustomerDueInfo>;
    },
  ): Promise<CustomerCreditAlert[]> {
    const customers = loadedCustomers ?? await customerService.listCustomers(storeId);
    if (customers.some((customer) => customer.storeId !== storeId)) {
      throw new Error('Customer credit alert request contains a customer from another store.');
    }
    const [creditStatuses, dueInfos] = loadedData
      ? [loadedData.creditStatuses, loadedData.dueInfos]
      : await Promise.all([
        customerService.getCreditStatuses(storeId, customers),
        customerService.getDueInfos(storeId, customers),
      ]);
    const alerts = customers.map((customer): CustomerCreditAlert | undefined => {
      const credit = creditStatuses[customer.id];
      const due = dueInfos[customer.id];
      if (!credit || !due) throw new Error(`Customer credit alert data is missing for "${customer.id}".`);
      if (due.overdue) {
        return {
          customerId: customer.id,
          customerName: customer.name,
          kind: 'overdue',
          severity: 'error',
        };
      }
      if (credit.limit !== undefined && (credit.percentUsed ?? 0) >= 100) {
        return {
          customerId: customer.id,
          customerName: customer.name,
          kind: 'limit',
          severity: 'error',
        };
      }
      if (credit.state === 'near') {
        return {
          customerId: customer.id,
          customerName: customer.name,
          kind: 'nearLimit',
          severity: 'warning',
        };
      }
      return undefined;
    });
    return alerts.filter((alert): alert is CustomerCreditAlert => alert !== undefined);
  },
};
