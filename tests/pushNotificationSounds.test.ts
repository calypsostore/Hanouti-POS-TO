import { describe, expect, it } from 'vitest';
import { resolveNotificationSoundId } from '../supabase/functions/send-push/notificationSounds';

describe('push notification sound preferences', () => {
  it('uses the dedicated configured sound for Void notifications', () => {
    expect(resolveNotificationSoundId('void_requested', 'alert8')).toBe('alert8');
    expect(resolveNotificationSoundId('void_rejected', 'alert4')).toBe('alert4');
  });

  it('uses the configured general sound for other notifications', () => {
    expect(resolveNotificationSoundId('cash_difference', 'alert5')).toBe('alert5');
  });

  it('uses the UI defaults when a preference is missing or legacy', () => {
    expect(resolveNotificationSoundId('void_approved', null)).toBe('alert7');
    expect(resolveNotificationSoundId('void_rejected', 'alert2')).toBe('alert7');
    expect(resolveNotificationSoundId('cash_difference', undefined)).toBe('alert6');
    expect(resolveNotificationSoundId('cash_difference', 'alert3')).toBe('alert6');
  });
});
