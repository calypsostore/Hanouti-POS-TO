import { useState } from 'react';
import { Button } from './Button';
import {
  NOTIFICATION_SOUNDS,
  stopNotificationSound,
  type NotificationSoundId,
  type NotificationSoundPreferences,
  type NotificationSoundPurpose,
} from '../services/notificationSounds';

interface NotificationSoundSettingsProps {
  preferences: NotificationSoundPreferences;
  disabled?: boolean;
  onChange: (purpose: NotificationSoundPurpose, soundId: NotificationSoundId) => void;
  onTest: (soundId: NotificationSoundId, onFinish: () => void) => Promise<void>;
}

const soundGroups: {
  purpose: NotificationSoundPurpose;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    purpose: 'general',
    title: 'Notification Sound',
    description: 'Used for general notifications, except Void updates.',
    icon: 'notifications_active',
  },
  {
    purpose: 'void',
    title: 'Void Sound',
    description: 'Used for Void requests, approvals, and rejections only.',
    icon: 'notifications_paused',
  },
];

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
      {soundGroups.map(({ purpose, title, description, icon }) => (
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
            {NOTIFICATION_SOUNDS.map((sound) => {
              const isSelected = preferences[purpose] === sound.id;
              const isPlaying = testingSound === sound.id;
              const action = isPlaying ? 'Pause' : 'Play';
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
                      aria-label={`${sound.label} for ${title}`}
                      className="h-5 w-5 shrink-0 accent-primary"
                    />
                    <span>{sound.label}</span>
                  </label>
                  <Button
                    type="button"
                    variant={isPlaying ? 'secondary' : 'primary'}
                    size="small"
                    className="!h-11 !w-11 !min-h-11 !rounded-full !px-0"
                    icon={<span aria-hidden="true" className="material-symbols-outlined text-xl">{isPlaying ? 'pause' : 'play_arrow'}</span>}
                    disabled={disabled}
                    aria-label={`${action} ${sound.label} preview`}
                    aria-pressed={isPlaying}
                    title={`${action} ${sound.label} preview`}
                    onClick={() => testSound(sound.id)}
                  >
                    <span className="sr-only">{action} preview</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
