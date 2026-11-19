import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { PRODUCTION_URL } from '../src/config/appConfig';
import { updateService } from '../src/services/updateService';

vi.mock('../src/services/notificationService', () => ({
  notificationService: { notifyAppUpdate: vi.fn().mockResolvedValue(undefined) },
}));

describe('updateService.checkForUpdates', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('__APP_VERSION__', '1.1.0');
    vi.stubGlobal('__BUILD_ID__', 'current-build');
    vi.stubGlobal('window', {
      location: { origin: 'https://hanoutipos.vercel.app', reload: vi.fn() },
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
      clearInterval: (...args: Parameters<typeof clearInterval>) => globalThis.clearInterval(...args),
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports the app as up to date when the build IDs match', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.1.0', buildId: 'current-build' }),
      { status: 200 },
    ));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({
      mode: 'web',
      currentVersion: '1.1.0',
      currentBuild: 'current-build',
      latestVersion: '1.1.0',
      latestBuild: 'current-build',
      updateAvailable: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/hanoutipos\.vercel\.app\/version\.json\?t=/),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('reports a different hosted build as an available update', async () => {
    const waiting = { postMessage: vi.fn() };
    const workerRegistration = { waiting, update: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue(workerRegistration) },
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.1.0', buildId: 'deployed-build' }),
      { status: 200 },
    ));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({
      mode: 'hosted',
      latestBuild: 'deployed-build',
      updateAvailable: true,
    });
    expect(workerRegistration.update).toHaveBeenCalledOnce();
  });

  it('checks the production site and reports APK requirement for bundled native apps', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://localhost', reload: vi.fn() },
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
      clearInterval: (...args: Parameters<typeof clearInterval>) => globalThis.clearInterval(...args),
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.1.0', buildId: 'deployed-build' }),
      { status: 200 },
    ));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({ mode: 'bundled', updateAvailable: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${PRODUCTION_URL}/version\\.json\\?t=`)),
      expect.any(Object),
    );
  });

  it('returns a readable network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await updateService.checkForUpdates();

    expect(result.error).toBe('No internet connection');
  });

  it('explains when the server does not have version.json', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    const result = await updateService.checkForUpdates();

    expect(result.error).toBe('Server returned 404 for version.json');
  });

  it('returns a readable timeout error', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));

    const check = updateService.checkForUpdates();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await check;

    expect(result.error).toBe('Request timed out after 10s');
  });
});
