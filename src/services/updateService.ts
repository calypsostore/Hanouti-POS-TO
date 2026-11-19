import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { notificationService } from './notificationService';
import { UPDATE_GITHUB_REPOSITORY } from '../config/updateConfig';
import { compareVersions } from './versionComparison';

declare const __APP_VERSION__: string;
const LAST_CHECK_KEY = '7anouti-pos:last-update-check';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_REQUEST_TIMEOUT_MS = 15_000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const updateService = {
  getCurrentVersion(): string {
    return __APP_VERSION__;
  },

  getAvailableVersion(): string | undefined {
    return availableVersion;
  },

  getLastCheck(): string | null {
    return localStorage.getItem(LAST_CHECK_KEY);
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

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (Capacitor.isNativePlatform()) {
      const checkedAt = new Date().toISOString();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), CHECK_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`https://api.github.com/repos/${UPDATE_GITHUB_REPOSITORY}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`GitHub release check failed with status ${response.status}.`);
      }

      const release: unknown = await response.json();
      if (!isRecord(release)) throw new Error('GitHub returned an invalid release response.');
      if (release.draft === true || release.prerelease === true) {
        localStorage.setItem(LAST_CHECK_KEY, checkedAt);
        return { currentVersion: __APP_VERSION__, checkedAt, updateAvailable: hasUpdate, availableVersion };
      }
      if (typeof release.tag_name !== 'string') throw new Error('GitHub release is missing its tag.');

      const releaseVersion = release.tag_name.replace(/^v/, '');
      const comparison = compareVersions(releaseVersion, __APP_VERSION__);
      if (comparison === null) throw new Error('GitHub release tag is not a major.minor.patch version.');

      if (comparison > 0) {
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const apkAsset = assets.find((asset: unknown) =>
          isRecord(asset)
          && typeof asset.name === 'string'
          && asset.name.toLowerCase().endsWith('.apk')
          && typeof asset.browser_download_url === 'string',
        );
        if (!isRecord(apkAsset) || typeof apkAsset.browser_download_url !== 'string') {
          throw new Error('GitHub release does not include an APK.');
        }
        const downloadUrl = new URL(apkAsset.browser_download_url);
        if (downloadUrl.protocol !== 'https:') throw new Error('GitHub APK download URL must use HTTPS.');
        setUpdateAvailable(releaseVersion, downloadUrl.toString());
      }

      localStorage.setItem(LAST_CHECK_KEY, checkedAt);
      return {
        currentVersion: __APP_VERSION__,
        checkedAt,
        updateAvailable: hasUpdate,
        availableVersion,
      };
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

  async applyUpdate(): Promise<void> {
    if (this.hasUnsavedChanges() && !window.confirm('You have unsaved work. Reload and discard it?')) return;
    if (Capacitor.isNativePlatform()) {
      if (!apkDownloadUrl) {
        console.error('[updates] No APK download URL is available.');
        return;
      }
      try {
        await Browser.open({ url: apkDownloadUrl });
      } catch (error) {
        console.error('[updates] Could not open the APK download.', error);
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
