import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import type { NotificationType } from '../types/domain';

export const NOTIFICATION_SOUNDS = [
  {
    id: 'alert1',
    label: 'Sunny Bell',
    fileName: 'alert1.mpeg',
    source: new URL('../../alerts/alert1.mpeg', import.meta.url).href,
  },
  {
    id: 'alert4',
    label: 'Cozy Chime',
    fileName: 'alert4.mpeg',
    source: new URL('../../alerts/alert4.mpeg', import.meta.url).href,
  },
  {
    id: 'alert5',
    label: 'Bright Chirp',
    fileName: 'alert5.mpeg',
    source: new URL('../../alerts/alert5.mpeg', import.meta.url).href,
  },
  {
    id: 'alert6',
    label: 'Soft Ping',
    fileName: 'alert6.mp3',
    source: new URL('../../alerts/universfield-new-notification-050-494248.mp3', import.meta.url).href,
  },
  {
    id: 'alert7',
    label: 'Gentle Alert',
    fileName: 'alert7.mp3',
    source: new URL('../../alerts/tithuh-warning-545568.mp3', import.meta.url).href,
  },
  {
    id: 'alert8',
    label: 'Kind Chime',
    fileName: 'alert8.mp3',
    source: new URL('../../alerts/notification_message-notification-alert-2-331726.mp3', import.meta.url).href,
  },
] as const;

export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number]['id'];
export type NotificationSoundChoice = NotificationSoundId | 'silent';
export type NotificationSoundPurpose = 'general' | 'void';

export interface NotificationSoundPreferences {
  general: NotificationSoundChoice;
  void: NotificationSoundChoice;
}

export const DEFAULT_NOTIFICATION_SOUND_PREFERENCES: NotificationSoundPreferences = {
  general: 'alert6',
  void: 'alert7',
};

const LOCAL_PREFERENCE_PREFIX = '7anouti.notification-sounds.v1:';
const preferencesByUser = new Map<string, NotificationSoundPreferences>();
let activeAudio: HTMLAudioElement | undefined;
let activeAudioOnFinish: (() => void) | undefined;

function finishAudio(audio: HTMLAudioElement): void {
  if (activeAudio !== audio) return;
  activeAudio = undefined;
  const onFinish = activeAudioOnFinish;
  activeAudioOnFinish = undefined;
  onFinish?.();
}

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return NOTIFICATION_SOUNDS.some((sound) => sound.id === value);
}

export function isNotificationSoundChoice(value: unknown): value is NotificationSoundChoice {
  return value === 'silent' || isNotificationSoundId(value);
}

function resolvePreferences(value: unknown): NotificationSoundPreferences {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_NOTIFICATION_SOUND_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  return {
    general: isNotificationSoundChoice(record.general) ? record.general : DEFAULT_NOTIFICATION_SOUND_PREFERENCES.general,
    void: isNotificationSoundChoice(record.void) ? record.void : DEFAULT_NOTIFICATION_SOUND_PREFERENCES.void,
  };
}

function localPreferenceKey(userId: string): string {
  return `${LOCAL_PREFERENCE_PREFIX}${encodeURIComponent(userId)}`;
}

function readLocalPreferences(userId: string): NotificationSoundPreferences {
  const value = localStorage.getItem(localPreferenceKey(userId));
  if (value === null) return { ...DEFAULT_NOTIFICATION_SOUND_PREFERENCES };
  try {
    return resolvePreferences(JSON.parse(value) as unknown);
  } catch (error) {
    throw new Error('Could not read notification sound preferences.', { cause: error });
  }
}

function assertPreferences(value: NotificationSoundPreferences): void {
  if (!isNotificationSoundChoice(value.general) || !isNotificationSoundChoice(value.void)) {
    throw new Error('Choose a valid notification sound or silent mode for both notification categories.');
  }
}

export async function getNotificationSoundPreferences(userId: string): Promise<NotificationSoundPreferences> {
  if (!userId.trim()) throw new Error('A user is required to load notification sound preferences.');
  const cached = preferencesByUser.get(userId);
  if (cached) return { ...cached };

  if (!isSupabaseDriver()) {
    const preferences = readLocalPreferences(userId);
    preferencesByUser.set(userId, preferences);
    return { ...preferences };
  }

  const { data, error } = await getSupabaseClient()
    .from('notification_sound_preferences')
    .select('general_sound, void_sound')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load notification sound preferences: ${error.message}`, { cause: error });

  const preferences = resolvePreferences(data
    ? { general: data.general_sound, void: data.void_sound }
    : undefined);
  preferencesByUser.set(userId, preferences);
  return { ...preferences };
}

export async function saveNotificationSoundPreferences(
  userId: string,
  preferences: NotificationSoundPreferences,
): Promise<void> {
  if (!userId.trim()) throw new Error('A user is required to save notification sound preferences.');
  assertPreferences(preferences);

  if (isSupabaseDriver()) {
    const { error } = await getSupabaseClient()
      .from('notification_sound_preferences')
      .upsert({
        user_id: userId,
        general_sound: preferences.general,
        void_sound: preferences.void,
      });
    if (error) throw new Error(`Could not save notification sound preferences: ${error.message}`, { cause: error });
  } else {
    localStorage.setItem(localPreferenceKey(userId), JSON.stringify(preferences));
  }

  preferencesByUser.set(userId, { ...preferences });
}

export function getNotificationSoundForType(
  type: NotificationType,
  preferences: NotificationSoundPreferences,
): NotificationSoundChoice {
  return type.startsWith('void_') ? preferences.void : preferences.general;
}

export function getNotificationSoundChannelId(baseChannelId: string, sound: NotificationSoundChoice): string {
  return `${baseChannelId}_${sound}`;
}

export function stopNotificationSound(): void {
  const audio = activeAudio;
  if (!audio) return;
  audio.pause();
  finishAudio(audio);
}

export async function playNotificationSound(
  soundId: NotificationSoundId,
  onFinish?: () => void,
): Promise<void> {
  const sound = NOTIFICATION_SOUNDS.find((option) => option.id === soundId);
  if (!sound) throw new Error('Choose a valid notification sound.');

  stopNotificationSound();
  const audio = new Audio(sound.source);
  activeAudio = audio;
  activeAudioOnFinish = onFinish;
  audio.addEventListener('ended', () => finishAudio(audio), { once: true });
  audio.addEventListener('error', () => finishAudio(audio), { once: true });

  try {
    await audio.play();
  } catch (error) {
    finishAudio(audio);
    throw new Error(`Could not play ${sound.label}.`, { cause: error });
  }
}

export async function playNotificationSoundForEvent(userId: string, type: NotificationType): Promise<void> {
  const preferences = await getNotificationSoundPreferences(userId);
  const sound = getNotificationSoundForType(type, preferences);
  if (sound === 'silent') return;
  await playNotificationSound(sound);
}
