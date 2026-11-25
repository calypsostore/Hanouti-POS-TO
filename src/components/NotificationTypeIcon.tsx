import type { NotificationType } from '../types/domain';
import { getNotificationAppearance } from '../lib/notificationAppearance';
import { MaterialIcon } from './MaterialIcon';

interface NotificationTypeIconProps {
  type: NotificationType;
  className?: string;
}

export function NotificationTypeIcon({ type, className = '' }: NotificationTypeIconProps) {
  const { icon, tone } = getNotificationAppearance(type);
  return (
    <span
      aria-hidden="true"
      className={`notification-center-type-icon notification-center-type-icon--${tone} ${className}`.trim()}
    >
      <MaterialIcon name={icon} />
    </span>
  );
}
