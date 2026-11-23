import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { updateService } from '../src/services/updateService';

const nativeApp = vi.hoisted(() => ({
  getInfo: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({ App: nativeApp }));

vi.mock('../src/services/notificationService', () => ({
  notificationService: { notifyAppUpdate: vi.fn().mockResolvedValue(undefined) },
}));

describe('updateService.checkForUpdates', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('__APP_VERSION__', '1.0.4');
    vi.stubGlobal('__BUILD_ID__', 'current-build');
    vi.stubGlobal('window', {
      location: { origin: 'https://hanoutipos.vercel.app', reload: vi.fn(), replace: vi.fn() },
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
      JSON.stringify({ version: '1.0.4', buildId: 'current-build' }),
      { status: 200 },
    ));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({
      mode: 'web',
      currentVersion: '1.0.4',
      currentBuild: 'current-build',
      latestVersion: '1.0.4',
      latestBuild: 'current-build',
      updateAvailable: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/hanoutipos\.vercel\.app\/version\.json\?t=/),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('skips version manifest requests on localhost during development', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://127.0.0.1:5173', reload: vi.fn() },
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
      clearInterval: (...args: Parameters<typeof clearInterval>) => globalThis.clearInterval(...args),
    });

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({ mode: 'web', updateAvailable: false });
    expect(result.error).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
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
    expect(workerRegistration.waiting.postMessage).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent update checks', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const firstCheck = updateService.checkForUpdates();
    const concurrentCheck = updateService.checkForUpdates();

    expect(concurrentCheck).toBe(firstCheck);
    resolveFetch?.(new Response(
      JSON.stringify({ version: '1.0.4', buildId: 'current-build' }),
      { status: 200 },
    ));
    await firstCheck;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('throttles automatic checks but lets a manual check bypass the interval', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.0.4', buildId: 'current-build' }),
      { status: 200 },
    ));

    await updateService.checkForUpdates({ automatic: true });
    await updateService.checkForUpdates({ automatic: true });

    expect(fetch).toHaveBeenCalledOnce();
    await updateService.checkForUpdates();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect a stored update from another build after a check fails', async () => {
    localStorage.setItem('7anouti-pos:last-update-result', JSON.stringify({
      mode: 'web',
      currentVersion: '1.0.4',
      currentBuild: 'previous-build',
      latestVersion: '1.0.5',
      latestBuild: 'future-build',
      latestApkUrl: null,
      checkedAt: new Date().toISOString(),
      updateAvailable: true,
    }));
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({ updateAvailable: false, latestBuild: null });
  });

  it('does not preserve an expired stored update after a check fails', async () => {
    localStorage.setItem('7anouti-pos:last-update-result', JSON.stringify({
      mode: 'web',
      currentVersion: '1.0.4',
      currentBuild: 'current-build',
      latestVersion: '1.0.5',
      latestBuild: 'future-build',
      latestApkUrl: null,
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      updateAvailable: true,
    }));
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({ updateAvailable: false, latestBuild: null });
  });

  it('activates a waiting worker and cache-busts the update reload', async () => {
    let stateChangeListener: (() => void) | undefined;
    const waiting = {
      state: 'installed',
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        stateChangeListener = listener;
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(() => {
        waiting.state = 'activated';
        stateChangeListener?.();
      }),
    };
    const workerRegistration = {
      waiting,
      update: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(workerRegistration),
        getRegistrations: vi.fn().mockResolvedValue([workerRegistration]),
      },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.1.0', buildId: 'deployed-build' }),
      { status: 200 },
    ));

    await updateService.checkForUpdates();
    await updateService.forceRefresh();

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(workerRegistration.unregister).toHaveBeenCalledOnce();
    expect(localStorage.getItem('7anouti-pos:updating-to')).toBe('deployed-build');
    expect(window.location.replace).toHaveBeenCalledWith('https://hanoutipos.vercel.app/?v=deployed-build');
  });

  it('does not reload or unregister workers if the waiting worker fails to activate', async () => {
    vi.useFakeTimers();
    const waiting = {
      state: 'installed',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    };
    const workerRegistration = {
      waiting,
      update: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(workerRegistration),
        getRegistrations: vi.fn().mockResolvedValue([workerRegistration]),
      },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ version: '1.1.0', buildId: 'deployed-build' }),
      { status: 200 },
    ));

    await updateService.checkForUpdates();
    const refresh = updateService.forceRefresh();
    const refreshResult = expect(refresh).rejects.toThrow('The waiting service worker did not activate in time.');
    await vi.advanceTimersByTimeAsync(3000);

    await refreshResult;
    expect(workerRegistration.unregister).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('reports an APK requirement when the release manifest has a newer APK version code', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://localhost', reload: vi.fn() },
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
      clearInterval: (...args: Parameters<typeof clearInterval>) => globalThis.clearInterval(...args),
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(App.getInfo).mockResolvedValue({
      name: '7anouti-POS',
      id: 'com.calypsostore.hanouti',
      version: '1.0.3',
      build: '10003',
    });
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({
        versionCode: 10004,
        versionName: '1.0.4',
        apkUrl: 'https://github.com/calypsostore/Hanouti-POS-TO/releases/download/v1.0.4/7anouti-POS-v1.0.4.apk',
        notes: 'Mandatory updates and notification permissions.',
      }),
      { status: 200 },
    ));

    const result = await updateService.checkForUpdates();

    expect(result).toMatchObject({
      mode: 'bundled',
      currentVersion: '1.0.3',
      currentBuild: '10003',
      latestVersion: '1.0.4',
      latestBuild: '10004',
      latestApkUrl: 'https://github.com/calypsostore/Hanouti-POS-TO/releases/download/v1.0.4/7anouti-POS-v1.0.4.apk',
      updateAvailable: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/hanoutipos\.vercel\.app\/api\/update-manifest\?t=/),
      expect.objectContaining({ cache: 'no-store' }),
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
