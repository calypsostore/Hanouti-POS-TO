export type NotificationSoundChoice = 'alert1' | 'alert4' | 'alert5' | 'alert6' | 'alert7' | 'alert8' | 'silent';

function isNotificationSoundChoice(value: unknown): value is NotificationSoundChoice {
  return value === 'alert1'
    || value === 'alert4'
    || value === 'alert5'
    || value === 'alert6'
    || value === 'alert7'
    || value === 'alert8'
    || value === 'silent';
}

export function resolveNotificationSoundId(type: string, requestedSound: unknown): NotificationSoundChoice {
  if (isNotificationSoundChoice(requestedSound)) return requestedSound;
  return type.startsWith('void_') ? 'alert7' : 'alert6';
}
