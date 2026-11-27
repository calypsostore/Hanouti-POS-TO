import { useState } from 'react';
import { Button } from './Button';
import { t, type TranslationKey } from '../i18n/translations';
import {
  NOTIFICATION_SOUNDS,
  stopNotificationSound,
  type NotificationSoundId,
  type NotificationSoundChoice,
  type NotificationSoundPreferences,
  type NotificationSoundPurpose,
} from '../services/notificationSounds';

interface NotificationSoundSettingsProps {
  preferences: NotificationSoundPreferences;
  disabled?: boolean;
  onChange: (purpose: NotificationSoundPurpose, soundId: NotificationSoundChoice) => void;
  onTest: (soundId: NotificationSoundId, onFinish: () => void) => Promise<void>;
}

const soundGroups: {
  purpose: NotificationSoundPurpose;
  icon: string;
}[] = [
  {
    purpose: 'general',
    icon: 'notifications_active',
  },
  {
    purpose: 'void',
    icon: 'notifications_paused',
  },
];

const soundLabelKeys: Record<NotificationSoundId, TranslationKey> = {
  alert1: 'settings.soundSunnyBell',
  alert4: 'settings.soundCozyChime',
  alert5: 'settings.soundBrightChirp',
  alert6: 'settings.soundSoftPing',
  alert7: 'settings.soundGentleAlert',
  alert8: 'settings.soundKindChime',
};

export function NotificationSoundSettings({
  preferences,
  disabled = false,
  onChange,
  onTest,
}: NotificationSoundSettingsProps) {
  const [testingSound, setTestingSound] = useState<NotificationSoundId>();

  function finishTest(soundId: NotificationSoundId) {
    setTestingSound((current) => current === soundId ? undefined : current);
  }

  function testSound(soundId: NotificationSoundId) {
    if (testingSound === soundId) {
      stopNotificationSound();
      finishTest(soundId);
      return;
    }

    stopNotificationSound();
    setTestingSound(soundId);
    void onTest(soundId, () => finishTest(soundId))
      .catch(() => finishTest(soundId));
  }

  return (
    <div className="flex flex-col gap-5">
      {soundGroups.map(({ purpose, icon }) => {
        const title = t(purpose === 'general' ? 'settings.generalNotificationSound' : 'settings.voidNotificationSound');
        const description = t(purpose === 'general' ? 'settings.generalNotificationSoundDescription' : 'settings.voidNotificationSoundDescription');
        return (
        <fieldset
          key={purpose}
          className="min-w-0 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-card sm:p-5"
        >
          <legend className="px-1">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1.5 font-body text-label-lg text-on-primary-container">
              <span aria-hidden="true" className="material-symbols-outlined text-xl">{icon}</span>
              {title}
            </span>
          </legend>
          <p className="mb-4 mt-1 font-body text-body-sm text-on-surface-variant">{description}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-3 font-body text-label-md text-on-surface transition-colors ${
              preferences[purpose] === 'silent'
                ? 'border-primary bg-primary-container'
                : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
            }`}>
              <input
                type="radio"
                name={`notification-sound-${purpose}`}
                value="silent"
                checked={preferences[purpose] === 'silent'}
                disabled={disabled}
                onChange={() => {
                  stopNotificationSound();
                  onChange(purpose, 'silent');
                }}
                aria-label={t('settings.silentModeFor', { title })}
                className="h-5 w-5 shrink-0 accent-primary"
              />
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">volume_off</span>
                {t('settings.silent')}
              </span>
            </label>
            {NOTIFICATION_SOUNDS.map((sound) => {
              const isSelected = preferences[purpose] === sound.id;
              const isPlaying = testingSound === sound.id;
              const action = t(isPlaying ? 'settings.pause' : 'settings.play');
              const soundName = t(soundLabelKeys[sound.id]);
              return (
                <div
                  key={sound.id}
                  className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary-container'
                      : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                  }`}
                >
                  <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 font-body text-label-md text-on-surface">
                    <input
                      type="radio"
                      name={`notification-sound-${purpose}`}
                      value={sound.id}
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => onChange(purpose, sound.id)}
                      aria-label={`${soundName} — ${title}`}
                      className="h-5 w-5 shrink-0 accent-primary"
                    />
                    <span>{soundName}</span>
                  </label>
                  <Button
                    type="button"
                    variant={isPlaying ? 'secondary' : 'primary'}
                    size="small"
                    className="!h-11 !w-11 !min-h-11 !rounded-full !px-0"
                    icon={<span aria-hidden="true" className="material-symbols-outlined text-xl">{isPlaying ? 'pause' : 'play_arrow'}</span>}
                    disabled={disabled}
                    aria-label={t('settings.soundPreview', { action, sound: soundName })}
                    aria-pressed={isPlaying}
                    title={t('settings.soundPreview', { action, sound: soundName })}
                    onClick={() => testSound(sound.id)}
                  >
                    <span className="sr-only">{t('settings.preview', { action })}</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </fieldset>
      )})}
    </div>
  );
}
