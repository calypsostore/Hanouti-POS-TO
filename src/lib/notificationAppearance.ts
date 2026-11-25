import type { NotificationType } from '../types/domain';

export type NotificationTone = 'blue' | 'green' | 'red' | 'violet' | 'amber';

interface NotificationAppearance {
  icon: string;
  tone: NotificationTone;
}

const notificationAppearances: Record<NotificationType, NotificationAppearance> = {
  void_requested: { icon: 'pending_actions', tone: 'amber' },
  void_approved: { icon: 'check_circle', tone: 'green' },
  void_rejected: { icon: 'block', tone: 'red' },
  schedule_published: { icon: 'calendar_month', tone: 'blue' },
  customer_credit_warning: { icon: 'credit_card', tone: 'amber' },
  customer_credit_limit: { icon: 'credit_card_off', tone: 'red' },
  customer_overdue: { icon: 'schedule', tone: 'amber' },
  stock_depleted: { icon: 'inventory_2', tone: 'red' },
  item_86: { icon: 'do_not_disturb_on', tone: 'red' },
  low_stock: { icon: 'inventory_2', tone: 'amber' },
  shift_opened: { icon: 'notifications', tone: 'violet' },
  shift_closed: { icon: 'power_settings_new', tone: 'red' },
  cash_difference: { icon: 'price_change', tone: 'violet' },
  cash_out_alert: { icon: 'payments', tone: 'amber' },
  z_report_closed: { icon: 'notifications', tone: 'blue' },
  app_update: { icon: 'download', tone: 'green' },
  subscription_expiring: { icon: 'workspace_premium', tone: 'violet' },
};

export function getNotificationAppearance(type: NotificationType): NotificationAppearance {
  return notificationAppearances[type];
}
