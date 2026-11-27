import { getLanguage, t, type TranslationKey } from '../i18n';
import { formatTnd } from './format';
import type { NotificationRecord, NotificationType } from '../types/domain';

export type NotificationContentValues = Record<string, string | number>;

const contentKeys = {
  void_requested: { title: 'notificationsContent.voidRequestedTitle', body: 'notificationsContent.voidRequestedBody' },
  void_approved: { title: 'notificationsContent.voidApprovedTitle', body: 'notificationsContent.voidApprovedBody' },
  void_rejected: { title: 'notificationsContent.voidRejectedTitle', body: 'notificationsContent.voidRejectedBody' },
  schedule_published: { title: 'notificationsContent.schedulePublishedTitle', body: 'notificationsContent.schedulePublishedBody' },
  customer_credit_warning: { title: 'notificationsContent.customerCreditWarningTitle', body: 'notificationsContent.customerCreditWarningBody' },
  customer_credit_limit: { title: 'notificationsContent.customerCreditLimitTitle', body: 'notificationsContent.customerCreditLimitBody' },
  customer_overdue: { title: 'notificationsContent.customerOverdueTitle', body: 'notificationsContent.customerOverdueBody' },
  stock_depleted: { title: 'notificationsContent.stockDepletedTitle', body: 'notificationsContent.stockDepletedBody' },
  item_86: { title: 'notificationsContent.item86Title', body: 'notificationsContent.item86Body' },
  low_stock: { title: 'notificationsContent.lowStockTitle', body: 'notificationsContent.lowStockBody' },
  shift_opened: { title: 'notificationsContent.shiftOpenedTitle', body: 'notificationsContent.shiftOpenedBody' },
  shift_closed: { title: 'notificationsContent.shiftClosedTitle', body: 'notificationsContent.shiftClosedBody' },
  cash_difference: { title: 'notificationsContent.cashDifferenceTitle', body: 'notificationsContent.cashDifferenceBody' },
  cash_out_alert: { title: 'notificationsContent.cashOutTitle', body: 'notificationsContent.cashOutBody' },
  z_report_closed: { title: 'notificationsContent.zReportClosedTitle', body: 'notificationsContent.zReportClosedBody' },
  app_update: { title: 'notificationsContent.appUpdateTitle', body: 'notificationsContent.appUpdateBody' },
  subscription_expiring: { title: 'notificationsContent.subscriptionExpiringTitle', body: 'notificationsContent.subscriptionExpiringBody' },
} satisfies Record<NotificationType, { title: TranslationKey; body: TranslationKey }>;

function formatWeekRange(values: NotificationContentValues): string | undefined {
  const { weekStart, weekEnd } = values;
  if (typeof weekStart !== 'string' || typeof weekEnd !== 'string') return undefined;
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${weekEnd}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(getLanguage(), options)} – ${end.toLocaleDateString(getLanguage(), options)}`;
}

function interpolateValues(type: NotificationType, values: NotificationContentValues): NotificationContentValues {
  const formatted = { ...values };
  if (typeof values.amount === 'number') formatted.amount = formatTnd(values.amount);
  if (type === 'subscription_expiring' && typeof values.date === 'string') {
    const date = new Date(`${values.date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) formatted.date = date.toLocaleDateString(getLanguage());
  }
  if (type === 'schedule_published') {
    formatted.week = formatWeekRange(values) ?? String(values.week ?? '');
  }
  if (type === 'cash_out_alert') {
    const reasonKeys: Record<string, TranslationKey> = {
      supplier: 'shift.reasonBoughtMilk',
      change: 'shift.reasonChangeFloat',
      expense: 'shift.reasonExpense',
      other: 'shift.reasonOther',
    };
    const reason = typeof values.reason === 'string' ? reasonKeys[values.reason] : undefined;
    if (reason) formatted.reason = t(reason);
    const note = typeof values.note === 'string' ? values.note : '';
    formatted.note = note ? t('notificationsContent.noteSuffix', { note }) : '.';
  }
  return formatted;
}

export function createNotificationContent(type: NotificationType, values: NotificationContentValues = {}) {
  const keys = contentKeys[type];
  const interpolation = interpolateValues(type, values);
  return {
    title: t(keys.title),
    body: type === 'z_report_closed' && values.number === undefined
      ? t('notificationsContent.zReportClosedWithoutNumber')
      : t(keys.body, interpolation),
    contentValues: values,
  };
}

type NotificationContentSource = Pick<NotificationRecord, 'type' | 'title' | 'body' | 'entityId' | 'contentValues'>;

function legacyAppUpdateValues(notification: NotificationContentSource): NotificationContentValues | undefined {
  if (notification.type !== 'app_update' || !notification.entityId) return undefined;
  const version = notification.body.match(/\d+[.]\d+[.]\d+/)?.[0];
  return version ? { version, build: notification.entityId } : undefined;
}

export function getNotificationContent(notification: NotificationContentSource): { title: string; body: string } {
  const values = notification.contentValues ?? legacyAppUpdateValues(notification);
  if (!values) return { title: notification.title, body: notification.body };
  const content = createNotificationContent(notification.type, values);
  return { title: content.title, body: content.body };
}
