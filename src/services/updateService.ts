import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { notificationService } from './notificationService';
import { UPDATE_GITHUB_REPOSITORY } from '../config/updateConfig';
import { isUpdateCheckDue, parseAppUpdateManifest, type AppUpdateManifest } from './appUpdateManifest';

declare const __APP_VERSION__: string;
const LAST_CHECK_KEY = '7anouti-pos:last-update-check';
const UPDATE_CACHE_KEY = '7anouti-pos:available-update';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_REQUEST_TIMEOUT_MS = 15_000;
const VERSION_URL = `https://github.com/${UPDATE_GITHUB_REPOSITORY}/releases/latest/download/version.json`;
const ApkInstaller = registerPlugin<{ installApk(options: { path: string }): Promise<void> }>('ApkInstaller');

export interface UpdateCheckResult {
  currentVersion: string;
  checkedAt: string;
  updateAvailable: boolean;
  availableVersion?: string;
}

type UpdateListener = (available: boolean) => void;
const listeners = new Set<UpdateListener>();
let registration: ServiceWorkerRegistration | undefined;
let observedRegistration: ServiceWorkerRegistration | undefined;
let hasUpdate = false;
let availableVersion: string | undefined;
let apkDownloadUrl: string | undefined;
let monitorStarted = false;
let controllerChangeObserved = false;
const unsavedStateProviders = new Set<() => boolean>();
let nativeCheckInFlight: Promise<UpdateCheckResult> | undefined;
let cachedUpdate: AppUpdateManifest | null = null;
let inMemoryLastCheck = 0;

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
    });
  }).catch((error: unknown) => {
    console.error(`[updates] ${reason} check failed.`, error);
  });
}

function notifyListeners() {
  for (const listener of listeners) listener(hasUpdate);
}

function setUpdateAvailable(version = __APP_VERSION__, downloadUrl?: string): void {
  const shouldNotify = !hasUpdate || availableVersion !== version;
  hasUpdate = true;
  availableVersion = version;
  if (downloadUrl) apkDownloadUrl = downloadUrl;
  if (!shouldNotify) return;
  notifyListeners();
  void notificationService.notifyAppUpdate(version).catch((error: unknown) => {
    console.error('[updates] Could not create in-app update notifications.', error);
  });
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('7anouti-POS', { body: 'New version available, tap to refresh' });
  }
}

function getLastCheckTimestamp(): number {
  try {
    return Math.max(inMemoryLastCheck, Date.parse(localStorage.getItem(LAST_CHECK_KEY) ?? '') || 0);
  } catch (error) {
    console.error('[updates] Could not read the last update check time.', error);
    return inMemoryLastCheck;
  }
}

function recordLastCheck(timestamp: number): void {
  inMemoryLastCheck = timestamp;
  try {
    localStorage.setItem(LAST_CHECK_KEY, new Date(timestamp).toISOString());
  } catch (error) {
    console.error('[updates] Could not save the last update check time.', error);
  }
}

function readCachedUpdate(): AppUpdateManifest | null {
  try {
    const raw = localStorage.getItem(UPDATE_CACHE_KEY);
    if (!raw) return cachedUpdate;
    cachedUpdate = parseAppUpdateManifest(JSON.parse(raw), UPDATE_GITHUB_REPOSITORY);
    if (!cachedUpdate) localStorage.removeItem(UPDATE_CACHE_KEY);
  } catch (error) {
    console.error('[updates] Could not read the cached update.', error);
  }
  return cachedUpdate;
}

function saveCachedUpdate(update: AppUpdateManifest): void {
  cachedUpdate = update;
  try {
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(update));
  } catch (error) {
    console.error('[updates] Could not cache the available update.', error);
  }
}

function clearCachedUpdate(): void {
  cachedUpdate = null;
  try {
    localStorage.removeItem(UPDATE_CACHE_KEY);
  } catch (error) {
    console.error('[updates] Could not clear the cached update.', error);
  }
}

function clearUpdateAvailable(): void {
  const shouldNotify = hasUpdate;
  hasUpdate = false;
  availableVersion = undefined;
  apkDownloadUrl = undefined;
  if (shouldNotify) notifyListeners();
}

async function requestUpdateManifest(): Promise<AppUpdateManifest> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CHECK_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(VERSION_URL, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (!response.ok) throw new Error(`Update manifest request failed with status ${response.status}.`);
  const manifest: unknown = await response.json();
  const update = parseAppUpdateManifest(manifest, UPDATE_GITHUB_REPOSITORY);
  if (!update) throw new Error('The update manifest is invalid or does not include a trusted APK.');
  return update;
}

async function performNativeUpdateCheck(force: boolean): Promise<UpdateCheckResult> {
  const installed = await App.getInfo();
  const installedVersionCode = Number.parseInt(installed.build, 10);
  if (!Number.isSafeInteger(installedVersionCode)) {
    throw new Error('Could not read the installed Android version code.');
  }

  const now = Date.now();
  const lastCheckTimestamp = getLastCheckTimestamp();
  if (!force && !isUpdateCheckDue(lastCheckTimestamp ? new Date(lastCheckTimestamp).toISOString() : null, now, CHECK_INTERVAL_MS)) {
    const cached = readCachedUpdate();
    if (cached && cached.versionCode > installedVersionCode) {
      setUpdateAvailable(cached.versionName, cached.apkUrl);
    } else if (cached) {
      clearCachedUpdate();
      clearUpdateAvailable();
    }
    return {
      currentVersion: installed.version,
      checkedAt: new Date(lastCheckTimestamp).toISOString(),
      updateAvailable: hasUpdate,
      availableVersion,
    };
  }

  recordLastCheck(now);
  const update = await requestUpdateManifest();
  if (update.versionCode <= installedVersionCode) {
    clearCachedUpdate();
    clearUpdateAvailable();
    return {
      currentVersion: installed.version,
      checkedAt: new Date(now).toISOString(),
      updateAvailable: false,
    };
  }

  saveCachedUpdate(update);
  setUpdateAvailable(update.versionName, update.apkUrl);
  return {
    currentVersion: installed.version,
    checkedAt: new Date(now).toISOString(),
    updateAvailable: true,
    availableVersion: update.versionName,
  };
}

async function checkNativeForUpdates(force: boolean): Promise<UpdateCheckResult> {
  if (nativeCheckInFlight) return nativeCheckInFlight;
  const request = performNativeUpdateCheck(force);
  nativeCheckInFlight = request;
  try {
    return await request;
  } finally {
    nativeCheckInFlight = undefined;
  }
}

export const updateService = {
  getCurrentVersion(): string {
    return __APP_VERSION__;
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

  subscribe(callback: UpdateListener): () => void {
    listeners.add(callback);
    callback(hasUpdate);
    return () => listeners.delete(callback);
  },

  registerUnsavedState(provider: () => boolean): () => void {
    unsavedStateProviders.add(provider);
    return () => unsavedStateProviders.delete(provider);
  },

  hasUnsavedChanges(): boolean {
    return Array.from(unsavedStateProviders).some((provider) => provider());
  },

  async register(): Promise<void> {
    if (Capacitor.isNativePlatform() || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    registration = await navigator.serviceWorker.register('/sw.js');
    if (registration.waiting) setUpdateAvailable();
    if (observedRegistration !== registration) {
      observedRegistration = registration;
      registration.addEventListener('updatefound', () => {
        const installing = registration?.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable();
        });
      });
    }
    if (!controllerChangeObserved) {
      controllerChangeObserved = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    }
  },

  async checkForUpdates(options: { force?: boolean } = {}): Promise<UpdateCheckResult> {
    if (Capacitor.isNativePlatform()) {
      return checkNativeForUpdates(options.force === true);
    }

    if (!registration && 'serviceWorker' in navigator) {
      registration = await navigator.serviceWorker.getRegistration();
    }
    const checkedAt = new Date().toISOString();
    if (registration) await registration.update();
    localStorage.setItem(LAST_CHECK_KEY, checkedAt);
    if (registration?.waiting) setUpdateAvailable();
    return { currentVersion: __APP_VERSION__, checkedAt, updateAvailable: hasUpdate };
  },

  async applyUpdate(onProgress?: (progress: number | null) => void): Promise<void> {
    if (this.hasUnsavedChanges() && !window.confirm('You have unsaved work. Reload and discard it?')) return;
    if (Capacitor.isNativePlatform()) {
      if (!apkDownloadUrl) {
        throw new Error('No APK download URL is available.');
      }
      const updateUrl = apkDownloadUrl;
      const progressListener = await Filesystem.addListener('progress', (status) => {
        if (status.url !== updateUrl || status.contentLength <= 0) return;
        onProgress?.(Math.min(100, Math.round((status.bytes / status.contentLength) * 100)));
      });
      try {
        const result = await Filesystem.downloadFile({
          url: updateUrl,
          path: '7anouti-pos-update.apk',
          directory: Directory.Cache,
          progress: true,
        });
        if (!result.path) throw new Error('The downloaded APK path was not returned.');
        await ApkInstaller.installApk({ path: result.path });
      } finally {
        await progressListener.remove();
      }
      return;
    }
    const waitingWorker = registration?.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    if (hasUpdate) window.location.reload();
  },

  startMonitoring(checkOverdueCustomers?: () => Promise<void>): () => void {
    if (monitorStarted) return () => undefined;
    monitorStarted = true;
    const isNative = Capacitor.isNativePlatform();
    const check = (reason: 'startup' | 'interval') => {
      runOverdueCheck(checkOverdueCustomers);
      if (isNative) {
        runAutomaticCheck(reason);
        return;
      }
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
    const intervalId = window.setInterval(() => check('interval'), CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    check('startup');
    return () => {
      monitorStarted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  },
};
