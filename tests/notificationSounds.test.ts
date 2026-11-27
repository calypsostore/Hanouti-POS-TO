import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationSoundSettings } from '../src/components/NotificationSoundSettings';
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  getNotificationSoundForType,
  getNotificationSoundPreferences,
  NOTIFICATION_SOUNDS,
  playNotificationSound,
  playNotificationSoundForEvent,
  saveNotificationSoundPreferences,
  stopNotificationSound,
  type NotificationSoundId,
} from '../src/services/notificationSounds';

const audioInstances: { src: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }[] = [];

class MockAudio {
  src: string;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  addEventListener = vi.fn();

  constructor(source: string) {
    this.src = source;
    audioInstances.push(this);
  }
}

describe('notification sound preferences', () => {
  beforeEach(() => {
    stopNotificationSound();
    localStorage.clear();
    audioInstances.length = 0;
    vi.stubGlobal('Audio', MockAudio);
  });

  it('exposes exactly the six supported sound IDs', () => {
    expect(NOTIFICATION_SOUNDS.map(({ id }) => id)).toEqual([
      'alert1',
      'alert4',
      'alert5',
      'alert6',
      'alert7',
      'alert8',
    ]);
  });

  it('persists independent sound selections for each user', async () => {
    await saveNotificationSoundPreferences('sound-user-a', { general: 'alert6', void: 'alert8' });

    await expect(getNotificationSoundPreferences('sound-user-a')).resolves.toEqual({
      general: 'alert6',
      void: 'alert8',
    });
    await expect(getNotificationSoundPreferences('sound-user-b')).resolves.toEqual(
      { general: 'alert6', void: 'alert7' },
    );
    expect(localStorage.getItem('7anouti.notification-sounds.v1:sound-user-a')).toBe(
      JSON.stringify({ general: 'alert6', void: 'alert8' }),
    );
  });

  it('saves silent mode independently for general and Void notifications', async () => {
    await saveNotificationSoundPreferences('silent-user', { general: 'silent', void: 'alert8' });

    await expect(getNotificationSoundPreferences('silent-user')).resolves.toEqual({
      general: 'silent',
      void: 'alert8',
    });
    expect(getNotificationSoundForType('cash_difference', { general: 'silent', void: 'alert8' })).toBe('silent');
    expect(getNotificationSoundForType('void_requested', { general: 'silent', void: 'alert8' })).toBe('alert8');
  });

  it('loads persisted selections for a user after a fresh session', async () => {
    localStorage.setItem(
      '7anouti.notification-sounds.v1:sound-user-reload',
      JSON.stringify({ general: 'alert5', void: 'alert4' }),
    );

    await expect(getNotificationSoundPreferences('sound-user-reload')).resolves.toEqual({
      general: 'alert5',
      void: 'alert4',
    });
  });

  it('falls back to defaults for saved preferences using removed sounds', async () => {
    localStorage.setItem(
      '7anouti.notification-sounds.v1:sound-user-removed',
      JSON.stringify({ general: 'alert2', void: 'alert3' }),
    );

    await expect(getNotificationSoundPreferences('sound-user-removed')).resolves.toEqual(
      DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
    );
  });

  it('uses the dedicated sound for Void notifications and the general sound otherwise', () => {
    const preferences = { general: 'alert6', void: 'alert8' } as const;

    expect(getNotificationSoundForType('void_requested', preferences)).toBe('alert8');
    expect(getNotificationSoundForType('void_approved', preferences)).toBe('alert8');
    expect(getNotificationSoundForType('void_rejected', preferences)).toBe('alert8');
    expect(getNotificationSoundForType('cash_difference', preferences)).toBe('alert6');
  });

  it('plays the configured selection for an actual notification event', async () => {
    const preferences = { general: 'alert6', void: 'alert7' } as const;
    await saveNotificationSoundPreferences('sound-event-user', preferences);

    await playNotificationSoundForEvent('sound-event-user', 'void_rejected');

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).toBe(NOTIFICATION_SOUNDS.find(({ id }) => id === 'alert7')?.source);
    expect(audioInstances[0].play).toHaveBeenCalledOnce();
  });

  it('does not play audio for events configured as silent', async () => {
    await saveNotificationSoundPreferences('silent-event-user', { general: 'silent', void: 'silent' });

    await playNotificationSoundForEvent('silent-event-user', 'void_rejected');

    expect(audioInstances).toHaveLength(0);
  });

  it('plays any selected sound from its bundled asset for previews', async () => {
    const soundId: NotificationSoundId = 'alert8';

    await playNotificationSound(soundId);

    expect(audioInstances[0].src).toBe(NOTIFICATION_SOUNDS.find(({ id }) => id === soundId)?.source);
    expect(audioInstances[0].play).toHaveBeenCalledOnce();
  });

  it('stops a preview and clears its active playback state', async () => {
    const onFinish = vi.fn();
    await playNotificationSound('alert6', onFinish);

    stopNotificationSound();

    expect(audioInstances[0].pause).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('shows a friendly sound choice and a test button for every option in both settings', () => {
    const markup = renderToStaticMarkup(createElement(NotificationSoundSettings, {
      preferences: DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
      onChange: vi.fn(),
      onTest: vi.fn().mockResolvedValue(undefined),
    }));

    expect(markup).toContain('Notification Sound');
    expect(markup).toContain('Void Sound');
    expect(markup).toContain('Silent');
    expect(markup).toContain('aria-label="Silent mode for Notification Sound"');
    expect(markup).toContain('aria-label="Silent mode for Void Sound"');
    expect(markup.match(/aria-label="Play /g)).toHaveLength(12);
    for (const { label } of NOTIFICATION_SOUNDS) expect(markup).toContain(label);
    expect(markup).toContain('Soft Ping');
    expect(markup).toContain('Gentle Alert');
    expect(markup).toContain('Kind Chime');
    expect(markup).toMatch(/name="notification-sound-general" checked="" value="alert6"/);
    expect(markup).toMatch(/name="notification-sound-void" checked="" value="alert7"/);
    expect(markup).not.toContain('Bubble Pop');
    expect(markup).not.toContain('Gentle Spark');
    expect(markup).not.toContain('alert1.mpeg');
  });
});
