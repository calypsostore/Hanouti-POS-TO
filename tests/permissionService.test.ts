import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { permissionService, PERMISSIONS_ASKED_KEY } from '../src/services/permissionService';

const nativeNotifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  createChannel: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: nativeNotifications }));

describe('permissionService', () => {
  beforeEach(() => {
    localStorage.clear();
    nativeNotifications.checkPermissions.mockReset();
    nativeNotifications.requestPermissions.mockReset();
    nativeNotifications.createChannel.mockReset().mockResolvedValue(undefined);
    nativeNotifications.schedule.mockReset().mockResolvedValue({ notifications: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('checks native notification permission without requesting it', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const checkPermissions = vi.mocked(LocalNotifications.checkPermissions)
      .mockResolvedValue({ display: 'prompt-with-rationale' });
    const requestPermissions = vi.mocked(LocalNotifications.requestPermissions);

    await expect(permissionService.getStatus()).resolves.toBe('prompt');

    expect(checkPermissions).toHaveBeenCalledOnce();
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('requests native permission only when explicitly called and saves the outcome', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const requestPermissions = vi.mocked(LocalNotifications.requestPermissions)
      .mockResolvedValue({ display: 'granted' });

    await expect(permissionService.request()).resolves.toBe('granted');

    expect(requestPermissions).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PERMISSIONS_ASKED_KEY)).toBe('true');
    expect(localStorage.getItem('notificationPermissionStatus')).toBe('granted');
  });

  it('uses the web Notification API for status and user-triggered requests', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    await expect(permissionService.getStatus()).resolves.toBe('prompt');
    expect(requestPermission).not.toHaveBeenCalled();
    await expect(permissionService.request()).resolves.toBe('granted');

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PERMISSIONS_ASKED_KEY)).toBe('true');
  });

  it('creates a high-importance Android channel and schedules local alerts on it', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const checkPermissions = vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    const createChannel = vi.mocked(LocalNotifications.createChannel);
    const schedule = vi.mocked(LocalNotifications.schedule);

    await expect(permissionService.showLocalNotification('Update available', 'A new build is ready.'))
      .resolves.toBe(true);

    expect(checkPermissions).toHaveBeenCalledOnce();
    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      id: '7anouti-general',
      importance: 4,
    }));
    expect(schedule).toHaveBeenCalledWith({
      notifications: [expect.objectContaining({
        title: 'Update available',
        body: 'A new build is ready.',
        channelId: '7anouti-general',
      })],
    });
  });
});
