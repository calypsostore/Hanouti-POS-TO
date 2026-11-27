import type { NotificationRecord } from '../types/domain';

export type NotificationCursor = Pick<NotificationRecord, 'createdAt' | 'id'>;

export function compareNotificationsNewestFirst(
  left: NotificationCursor,
  right: NotificationCursor,
): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (leftValid && rightValid && leftTime !== rightTime) return rightTime - leftTime;
  if (left.id !== right.id) return right.id < left.id ? -1 : 1;
  if (left.createdAt === right.createdAt) return 0;
  return right.createdAt < left.createdAt ? -1 : 1;
}
