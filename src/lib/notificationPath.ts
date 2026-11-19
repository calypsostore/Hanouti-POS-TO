import type { NotificationRecord, UserRole } from '../types/domain';

export function notificationPath(notification: NotificationRecord, role: UserRole): string {
  if (notification.entityType === 'customer' && notification.entityId) return `/customers/${notification.entityId}`;
  if (notification.entityType === 'catalog_item') return role === 'owner' ? '/owner/catalog' : '/pos';
  if (notification.entityType === 'shift') return role === 'owner' ? '/owner/shifts' : '/shift';
  if (notification.entityType === 'order') return '/orders';
  if (notification.entityType === 'report') return role === 'owner' ? '/owner/reports' : '/notifications';
  if (notification.entityType === 'schedule') return '/settings';
  if (notification.entityType === 'store') return role === 'owner' ? '/owner/settings' : '/settings';
  return '/settings';
}
