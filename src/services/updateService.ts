import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { notificationService } from './notificationService';
import { PRODUCTION_URL } from '../config/appConfig';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

const LAST_CHECK_KEY = '7anouti-pos:last-update-check';
const LAST_RESULT_KEY = '7anouti-pos:last-update-result';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_REQUEST_TIMEOUT_MS = 10_000;
const WORKER_UPDATE_TIMEOUT_MS = 5_000;

export type UpdateMode = 'hosted' | 'bundled' | 'web';

export interface UpdateCheckResult {
  mode: UpdateMode;
  currentVersion: string;
  currentBuild: string;
  latestVersion: string | null;
  latestBuild: string | null;
  checkedAt: string;
  updateAvailable: boolean;
  error?: string;
}

type UpdateListener = (available: boolean) => void;
type ResultListener = (result: UpdateCheckResult) => void;
const listeners = new Set<UpdateListener>();
const resultListeners = new Set<ResultListener>();
let registration: ServiceWorkerRegistration | undefined;
let observedRegistration: ServiceWorkerRegistration | undefined;
let controllerChangeObserved = false;
let hasUpdate = false;
let availableVersion: string | undefined;
let monitorStarted = false;
const unsavedStateProviders = new Set<() => boolean>();

function runOverdueCheck(checkOverdueCustomers?: () => Promise<void>): void {
  if (checkOverdueCustomers) {
    void checkOverdueCustomers().catch((error: unknown) => {
      console.error('[customers] Automatic overdue check failed.', error);
    });
  }
}

function runAutomaticCheck(reason: 'startup' | 'interval' | 'foreground'): void {
  void updateService.checkForUpdates().then((result) => {
    console.info('[updates] Automatic check completed.', {
      reason,
      checkedAt: result.checkedAt,
      updateAvailable: result.updateAvailable,
      error: result.error,
    });
  }).catch((error: unknown) => {
    console.error(`[updates] ${reason} check failed.`, error);
  });
}

function notifyListeners(): void {
  for (const listener of listeners) listener(hasUpdate);
}

function notifyResultListeners(result: UpdateCheckResult): void {
  for (const listener of resultListeners) listener(result);
}

function setUpdateAvailable(version: string): void {
  const shouldNotify = !hasUpdate || availableVersion !== version;
  hasUpdate = true;
  availableVersion = version;
  if (!shouldNotify) return;
  notifyListeners();
  void notificationService.notifyAppUpdate(version).catch((error: unknown) => {
    console.error('[updates] Could not create in-app update notifications.', error);
  });
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('7anouti-POS', { body: 'A new app build is available.' });
  }
}

function clearUpdateAvailable(): void {
  const shouldNotify = hasUpdate;
  hasUpdate = false;
  availableVersion = undefined;
  if (shouldNotify) notifyListeners();
}

function isLocalhost(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getOriginDetails(): { mode: UpdateMode; origin: string } {
  const origin = window.location.origin;
  const native = Capacitor.isNativePlatform();
  const bundledNative = native && (
    origin === 'capacitor://localhost'
    || ((origin.startsWith('http://') || origin.startsWith('https://')) && isLocalhost(origin))
  );
  if (bundledNative) return { mode: 'bundled', origin: PRODUCTION_URL };
  if (native) return { mode: 'hosted', origin };
  return { mode: 'web', origin };
}

function readLastResult(): UpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    const result: unknown = JSON.parse(raw);
    if (
      typeof result !== 'object'
      || result === null
      || !('mode' in result)
      || !('checkedAt' in result)
    ) return null;
    return result as UpdateCheckResult;
  } catch (error) {
    console.error('[updates] Could not read the last update result.', error);
    return null;
  }
}

function saveResult(result: UpdateCheckResult, notify = true): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, result.checkedAt);
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
  } catch (error) {
    console.error('[updates] Could not save the last update result.', error);
  }
  if (notify) notifyResultListeners(result);
}

function resultErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'Request timed out after 10s') return error.message;
  return 'No internet connection';
}

async function fetchVersionManifest(url: string): Promise<{ version: string; buildId: string }> {
  const controller = new AbortController();
  let rejectTimeout: (reason: Error) => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timeoutId = window.setTimeout(() => {
    controller.abort();
    rejectTimeout(new Error('Request timed out after 10s'));
  }, CHECK_REQUEST_TIMEOUT_MS);

  try {
    const request = async () => {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Server returned ${response.status} for version.json`);
      let manifest: unknown;
      try {
        manifest = await response.json();
      } catch (error) {
        throw new Error('Server returned invalid JSON for version.json', { cause: error });
      }
      if (
        typeof manifest !== 'object'
        || manifest === null
        || !('version' in manifest)
        || typeof manifest.version !== 'string'
        || !('buildId' in manifest)
        || typeof manifest.buildId !== 'string'
      ) {
        throw new Error('Server returned invalid version.json');
      }
      return { version: manifest.version, buildId: manifest.buildId };
    };
    return await Promise.race([request(), timeout]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Server returned ')) throw error;
    throw new Error(resultErrorMessage(error), { cause: error });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function waitForWaitingWorker(workerRegistration: ServiceWorkerRegistration): Promise<boolean> {
  if (workerRegistration.waiting) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timeoutId = 0;
    const finish = (found: boolean) => {
      window.clearTimeout(timeoutId);
      workerRegistration.removeEventListener('updatefound', onUpdateFound);
      resolve(found);
    };
    const checkInstalling = () => {
      const installing = workerRegistration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && workerRegistration.waiting) finish(true);
      });
    };
    const onUpdateFound = () => checkInstalling();
    timeoutId = window.setTimeout(() => finish(Boolean(workerRegistration.waiting)), WORKER_UPDATE_TIMEOUT_MS);
    workerRegistration.addEventListener('updatefound', onUpdateFound);
    checkInstalling();
  });
}

async function updateHostedServiceWorker(updateAvailable: boolean): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registration ??= await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  await registration.update();
  if (updateAvailable && !(await waitForWaitingWorker(registration))) {
    await updateService.forceRefresh();
  }
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const { mode, origin } = getOriginDetails();
  const checkedAt = new Date().toISOString();
  const result: UpdateCheckResult = {
    mode,
    currentVersion: __APP_VERSION__,
    currentBuild: __BUILD_ID__,
    latestVersion: null,
    latestBuild: null,
    checkedAt,
    updateAvailable: false,
  };

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== 'https:' && originUrl.protocol !== 'http:') {
      throw new Error('App origin is not an HTTP(S) URL.');
    }
    const latest = await fetchVersionManifest(
      `${originUrl.origin}/version.json?t=${Date.now()}`,
    );
    result.latestVersion = latest.version;
    result.latestBuild = latest.buildId;
    result.updateAvailable = latest.buildId !== __BUILD_ID__;

    if (result.updateAvailable) {
      setUpdateAvailable(latest.version);
    } else {
      clearUpdateAvailable();
    }
    saveResult(result, false);
    if (mode !== 'bundled') {
      try {
        await updateHostedServiceWorker(result.updateAvailable);
      } catch (error) {
        result.error = error instanceof Error
          ? `Could not update the service worker: ${error.message}`
          : 'Could not update the service worker.';
      }
    }
  } catch (error) {
    result.error = error instanceof Error
      ? error.message
      : 'No internet connection';
    if (result.error === 'Failed to fetch' || result.error === 'NetworkError when attempting to fetch resource.') {
      result.error = 'No internet connection';
    }
    console.error('[updates] Update check failed.', error);
  }

  saveResult(result);
  return result;
}

export const updateService = {
  getCurrentVersion(): string {
    return __APP_VERSION__;
  },

  getCurrentBuild(): string {
    return __BUILD_ID__;
  },

  getMode(): UpdateMode {
    return getOriginDetails().mode;
  },

  getAvailableVersion(): string | undefined {
    return availableVersion;
  },

  getLastCheck(): string | null {
    try {
      return localStorage.getItem(LAST_CHECK_KEY);
    } catch (error) {
      console.error('[updates] Could not read the last update check time.', error);
      return null;
    }
  },

  getLastResult(): UpdateCheckResult | null {
    return readLastResult();
  },

  subscribe(callback: UpdateListener): () => void {
    listeners.add(callback);
    callback(hasUpdate);
    return () => listeners.delete(callback);
  },

  subscribeResults(callback: ResultListener): () => void {
    resultListeners.add(callback);
    return () => resultListeners.delete(callback);
  },

  registerUnsavedState(provider: () => boolean): () => void {
    unsavedStateProviders.add(provider);
    return () => unsavedStateProviders.delete(provider);
  },

  hasUnsavedChanges(): boolean {
    return Array.from(unsavedStateProviders).some((provider) => provider());
  },

  async register(): Promise<void> {
    if (this.getMode() === 'bundled' || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    registration = await navigator.serviceWorker.register('/sw.js');
    if (registration.waiting) setUpdateAvailable(__APP_VERSION__);
    if (observedRegistration !== registration) {
      observedRegistration = registration;
      registration.addEventListener('updatefound', () => {
        const installing = registration?.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(__APP_VERSION__);
          }
        });
      });
    }
    if (!controllerChangeObserved) {
      controllerChangeObserved = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    }
  },

  checkForUpdates,

  async forceRefresh(): Promise<void> {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((workerRegistration) => workerRegistration.unregister()));
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }
    window.location.reload();
  },

  async openHostedApp(): Promise<void> {
    await Browser.open({ url: PRODUCTION_URL });
  },

  async applyUpdate(): Promise<void> {
    if (this.hasUnsavedChanges() && !window.confirm('You have unsaved work. Reload and discard it?')) return;
    if (this.getMode() === 'bundled') {
      await this.openHostedApp();
      return;
    }
    const waitingWorker = registration?.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    await this.forceRefresh();
  },

  startMonitoring(checkOverdueCustomers?: () => Promise<void>): () => void {
    if (monitorStarted) return () => undefined;
    monitorStarted = true;
    const check = () => {
      runOverdueCheck(checkOverdueCustomers);
      const lastCheck = this.getLastCheck();
      if (!lastCheck || Date.now() - new Date(lastCheck).getTime() >= CHECK_INTERVAL_MS) {
        runAutomaticCheck(lastCheck ? 'interval' : 'startup');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runOverdueCheck(checkOverdueCustomers);
        runAutomaticCheck('foreground');
      }
    };
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    check();
    return () => {
      monitorStarted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  },
};

const initialResult = readLastResult();
if (initialResult?.updateAvailable && initialResult.latestVersion) {
  hasUpdate = true;
  availableVersion = initialResult.latestVersion;
}
