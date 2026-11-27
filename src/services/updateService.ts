import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { PRODUCTION_URL } from '../config/appConfig';
import { parseAppUpdateManifest } from './appUpdateManifest';
import { UPDATE_GITHUB_REPOSITORY } from '../config/updateConfig';
import { t } from '../i18n';
import { confirmUpdateIfUnsaved, getPostUpdateStatus, sanitizeStoredResult } from './updateModalLogic';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

const LAST_CHECK_KEY = '7anouti-pos:last-update-check';
const LAST_RESULT_KEY = '7anouti-pos:last-update-result';
const UPDATE_TARGET_KEY = '7anouti-pos:updating-to';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_AUTOMATIC_CHECK_INTERVAL_MS = 30_000;
const CHECK_REQUEST_TIMEOUT_MS = 10_000;
const SERVICE_WORKER_ACTIVATION_TIMEOUT_MS = 3_000;
const RELEASE_MANIFEST_URL = `${PRODUCTION_URL}/api/update-manifest`;

export type UpdateMode = 'hosted' | 'bundled' | 'web';

export interface UpdateCheckResult {
  mode: UpdateMode;
  currentVersion: string;
  currentBuild: string;
  latestVersion: string | null;
  latestBuild: string | null;
  latestApkUrl: string | null;
  checkedAt: string;
  updateAvailable: boolean;
  error?: string;
}

type ResultListener = (result: UpdateCheckResult) => void;
const resultListeners = new Set<ResultListener>();
let registration: ServiceWorkerRegistration | undefined;
let availableVersion: string | undefined;
let availableBuild: string | undefined;
let monitorStarted = false;
let inFlightCheck: Promise<UpdateCheckResult> | null = null;
let postUpdateMessage: string | null | undefined;
const unsavedStateProviders = new Set<() => boolean>();

function runOverdueCheck(checkOverdueCustomers?: () => Promise<void>): void {
  if (checkOverdueCustomers) {
    void checkOverdueCustomers().catch((error: unknown) => {
      console.error('[customers] Automatic overdue check failed.', error);
    });
  }
}

function runAutomaticCheck(reason: 'startup' | 'interval' | 'foreground'): void {
  void updateService.checkForUpdates({ automatic: true }).then((result) => {
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

function notifyResultListeners(result: UpdateCheckResult): void {
  for (const listener of resultListeners) listener(result);
}

function setUpdateAvailable(version: string, build: string): void {
  const shouldNotify = availableBuild !== build;
  availableVersion = version;
  availableBuild = build;
  if (!shouldNotify) return;
  void import('./notificationService').then(({ notificationService }) =>
    notificationService.notifyAppUpdate(version, build),
  ).catch((error: unknown) => {
    console.error('[updates] Could not create in-app update notifications.', error);
  });
}

function clearUpdateAvailable(): void {
  availableVersion = undefined;
  availableBuild = undefined;
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

function getBuildId(): string {
  return typeof __BUILD_ID__ === 'undefined' ? '' : __BUILD_ID__;
}

function getAppVersion(): string {
  return typeof __APP_VERSION__ === 'undefined' ? '' : __APP_VERSION__;
}

function isUpdateCheckResult(value: unknown): value is UpdateCheckResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<UpdateCheckResult>;
  return (
    (result.mode === 'hosted' || result.mode === 'bundled' || result.mode === 'web')
    && typeof result.currentVersion === 'string'
    && typeof result.currentBuild === 'string'
    && (result.latestVersion === null || typeof result.latestVersion === 'string')
    && (result.latestBuild === null || typeof result.latestBuild === 'string')
    && (result.latestApkUrl === null || typeof result.latestApkUrl === 'string')
    && typeof result.checkedAt === 'string'
    && typeof result.updateAvailable === 'boolean'
    && (result.error === undefined || typeof result.error === 'string')
  );
}

function readStoredResult(): UpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    const result: unknown = JSON.parse(raw);
    return isUpdateCheckResult(result) ? result : null;
  } catch (error) {
    console.error('[updates] Could not read the last update result.', error);
    return null;
  }
}

function readLastResult(): UpdateCheckResult | null {
  const result = readStoredResult();
  if (!result) return null;
  const { mode } = getOriginDetails();
  return sanitizeStoredResult(result, getBuildId(), getAppVersion(), mode);
}

function clearStoredUpdateResult(): void {
  try {
    localStorage.removeItem(LAST_RESULT_KEY);
    localStorage.removeItem(LAST_CHECK_KEY);
  } catch (error) {
    console.error('[updates] Could not clear the completed update result.', error);
  }
}

function getPostUpdateMessage(): string | null {
  if (postUpdateMessage !== undefined) return postUpdateMessage;
  let targetBuild: string | null;
  try {
    targetBuild = localStorage.getItem(UPDATE_TARGET_KEY);
  } catch (error) {
    console.error('[updates] Could not read the pending update target.', error);
    postUpdateMessage = null;
    return postUpdateMessage;
  }
  if (!targetBuild) {
    postUpdateMessage = null;
    return postUpdateMessage;
  }

  try {
    localStorage.removeItem(UPDATE_TARGET_KEY);
  } catch (error) {
    console.error('[updates] Could not clear the pending update target.', error);
  }
  const status = getPostUpdateStatus(targetBuild, getBuildId());
  if (status === 'completed') {
    clearStoredUpdateResult();
    clearUpdateAvailable();
    postUpdateMessage = null;
    return postUpdateMessage;
  }
  postUpdateMessage = 'Update did not finish. Tap to retry.';
  return postUpdateMessage;
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

async function fetchJson(url: string, label: string): Promise<unknown> {
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
      if (!response.ok) throw new Error(`Server returned ${response.status} for ${label}`);
      try {
        return await response.json() as unknown;
      } catch (error) {
        throw new Error(`Server returned invalid JSON for ${label}`, { cause: error });
      }
    };
    return await Promise.race([request(), timeout]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Server returned ')) throw error;
    if (error instanceof Error && error.message === 'Request timed out after 10s') throw error;
    throw new Error('No internet connection', { cause: error });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchVersionManifest(url: string): Promise<{ version: string; buildId: string }> {
  const manifest: unknown = await fetchJson(url, 'version.json');
  if (
    typeof manifest !== 'object'
    || manifest === null
    || !('version' in manifest)
    || typeof manifest.version !== 'string'
    || !('buildId' in manifest)
    || typeof manifest.buildId !== 'string'
  ) throw new Error('Server returned invalid version.json');
  return { version: manifest.version, buildId: manifest.buildId };
}

async function fetchReleaseManifest() {
  const manifest = await fetchJson(`${RELEASE_MANIFEST_URL}?t=${Date.now()}`, 'APK update manifest');
  const parsed = parseAppUpdateManifest(manifest, UPDATE_GITHUB_REPOSITORY);
  if (!parsed) throw new Error('Server returned an invalid APK update manifest');
  return parsed;
}

async function updateHostedServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registration ??= await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  await registration.update();
}

async function performUpdateCheck(): Promise<UpdateCheckResult> {
  const { mode, origin } = getOriginDetails();
  const checkedAt = new Date().toISOString();
  const previousResult = readLastResult();
  const result: UpdateCheckResult = {
    mode,
    currentVersion: __APP_VERSION__,
    currentBuild: __BUILD_ID__,
    latestVersion: null,
    latestBuild: null,
    latestApkUrl: null,
    checkedAt,
    updateAvailable: false,
  };

  if (import.meta.env.DEV && mode === 'web' && isLocalhost(origin)) {
    clearUpdateAvailable();
    saveResult(result);
    return result;
  }

  try {
    if (mode === 'bundled') {
      const installedApp = await App.getInfo();
      const installedVersionCode = Number.parseInt(installedApp.build, 10);
      if (!Number.isSafeInteger(installedVersionCode)) {
        throw new Error('Could not read the installed APK version code.');
      }
      result.currentVersion = installedApp.version;
      result.currentBuild = installedApp.build;
      const latest = await fetchReleaseManifest();
      result.latestVersion = latest.versionName;
      result.latestBuild = String(latest.versionCode);
      result.latestApkUrl = latest.apkUrl;
      result.updateAvailable = latest.versionCode > installedVersionCode;
    } else {
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
    }

    if (result.updateAvailable) {
      setUpdateAvailable(result.latestVersion ?? 'unknown', result.latestBuild ?? 'unknown');
    } else {
      clearUpdateAvailable();
    }
    saveResult(result, false);
    if (mode !== 'bundled') {
      try {
        await updateHostedServiceWorker();
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
    const previousResultAgeMs = previousResult
      ? Date.now() - new Date(previousResult.checkedAt).getTime()
      : Number.NaN;
    if (
      previousResult?.updateAvailable
      && previousResult.mode === mode
      && previousResultAgeMs >= 0
      && previousResultAgeMs <= 24 * 60 * 60 * 1000
    ) {
      result.updateAvailable = true;
      result.latestVersion = previousResult.latestVersion;
      result.latestBuild = previousResult.latestBuild;
      result.latestApkUrl = previousResult.latestApkUrl ?? null;
      if (result.latestVersion && result.latestBuild) {
        setUpdateAvailable(result.latestVersion, result.latestBuild);
      }
    }
    console.error('[updates] Update check failed.', error);
  }

  saveResult(result);
  return result;
}

function checkForUpdates(options: { automatic?: boolean } = {}): Promise<UpdateCheckResult> {
  if (inFlightCheck) return inFlightCheck;

  if (options.automatic) {
    const lastCheckAt = Date.parse(updateService.getLastCheck() ?? '');
    const storedResult = readStoredResult();
    const { mode } = getOriginDetails();
    const installedBuild = mode === 'bundled' ? storedResult?.currentBuild : getBuildId();
    const currentResult = storedResult
      && storedResult.mode === mode
      && storedResult.currentVersion === getAppVersion()
      && storedResult.currentBuild === installedBuild
      ? storedResult
      : null;
    if (
      currentResult
      && Number.isFinite(lastCheckAt)
      && Date.now() - lastCheckAt < MIN_AUTOMATIC_CHECK_INTERVAL_MS
    ) return Promise.resolve(currentResult);
  }

  const trackedCheck = performUpdateCheck().finally(() => {
    if (inFlightCheck === trackedCheck) inFlightCheck = null;
  });
  inFlightCheck = trackedCheck;
  return trackedCheck;
}

async function activateWaitingWorker(worker: ServiceWorker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.removeEventListener('statechange', finish);
    };
    const finish = () => {
      if (worker.state !== 'activated') return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('The waiting service worker did not activate in time.'));
    }, SERVICE_WORKER_ACTIVATION_TIMEOUT_MS);
    if (worker.state === 'activated') {
      finish();
      return;
    }
    worker.addEventListener('statechange', finish);
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
      }
      reject(new Error('Could not activate the waiting service worker.', { cause: error }));
    }
  });
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
    if (!availableVersion) {
      const result = readLastResult();
      if (result?.updateAvailable && result.latestVersion && result.latestBuild) {
        availableVersion = result.latestVersion;
        availableBuild = result.latestBuild;
      }
    }
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

  getPostUpdateMessage(): string | null {
    return getPostUpdateMessage();
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
  },

  checkForUpdates,

  async forceRefresh(): Promise<void> {
    const result = readLastResult();
    const targetBuild = result?.latestBuild ?? getBuildId();
    try {
      localStorage.setItem(UPDATE_TARGET_KEY, targetBuild);
    } catch (error) {
      throw new Error('Could not prepare the update reload.', { cause: error });
    }

    if ('serviceWorker' in navigator) {
      registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) await activateWaitingWorker(registration.waiting);
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((workerRegistration) => workerRegistration.unregister()));
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }
    const reloadUrl = new URL('/', window.location.origin);
    reloadUrl.searchParams.set('v', targetBuild);
    window.location.replace(reloadUrl.toString());
  },

  async openHostedApp(): Promise<void> {
    await Browser.open({ url: PRODUCTION_URL });
  },

  async applyUpdate(): Promise<void> {
    if (this.getMode() === 'bundled') {
      const result = readLastResult();
      if (!result?.latestApkUrl) throw new Error('The APK download link is not available.');
      if (!confirmUpdateIfUnsaved(this.hasUnsavedChanges(), window.confirm.bind(window), t('updates.confirmDiscard'))) return;
      await Browser.open({ url: result.latestApkUrl });
      return;
    }
    if (!confirmUpdateIfUnsaved(this.hasUnsavedChanges(), window.confirm.bind(window), t('updates.confirmDiscard'))) return;
    await this.forceRefresh();
  },

  startMonitoring(checkOverdueCustomers?: () => Promise<void>): () => void {
    if (monitorStarted) return () => undefined;
    monitorStarted = true;
    let active = true;
    let removeNativeListener: (() => void) | undefined;
    let lastForegroundCheckAt = 0;
    const check = () => {
      runOverdueCheck(checkOverdueCustomers);
      runAutomaticCheck('interval');
    };
    const onForeground = () => {
      if (Date.now() - lastForegroundCheckAt < 1_000) return;
      lastForegroundCheckAt = Date.now();
      runOverdueCheck(checkOverdueCustomers);
      runAutomaticCheck('foreground');
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onForeground();
    };
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onForeground);
    lastForegroundCheckAt = Date.now();
    runOverdueCheck(checkOverdueCustomers);
    runAutomaticCheck('startup');
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onForeground();
      }).then((listener) => {
        if (!active) {
          void listener.remove().catch((error: unknown) => {
            console.error('[updates] Could not remove the foreground listener.', error);
          });
          return;
        }
        removeNativeListener = () => {
          void listener.remove().catch((error: unknown) => {
            console.error('[updates] Could not remove the foreground listener.', error);
          });
        };
      }).catch((error: unknown) => {
        console.error('[updates] Could not monitor native foreground state.', error);
      });
    }
    return () => {
      active = false;
      monitorStarted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onForeground);
      removeNativeListener?.();
    };
  },
};
