export type NotificationSoundId = 'alert1' | 'alert4' | 'alert5' | 'alert6' | 'alert7' | 'alert8';

function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return value === 'alert1'
    || value === 'alert4'
    || value === 'alert5'
    || value === 'alert6'
    || value === 'alert7'
    || value === 'alert8';
}

export function resolveNotificationSoundId(type: string, requestedSound: unknown): NotificationSoundId {
  if (isNotificationSoundId(requestedSound)) return requestedSound;
  return type.startsWith('void_') ? 'alert7' : 'alert6';
}
