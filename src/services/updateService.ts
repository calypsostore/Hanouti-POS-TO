declare const __APP_VERSION__: string;

const LAST_CHECK_KEY = '7anouti-pos:last-update-check';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  currentVersion: string;
  checkedAt: string;
  updateAvailable: boolean;
}

type UpdateListener = (available: boolean) => void;
const listeners = new Set<UpdateListener>();
let registration: ServiceWorkerRegistration | undefined;
let observedRegistration: ServiceWorkerRegistration | undefined;
let hasUpdate = false;
let monitorStarted = false;
let controllerChangeObserved = false;
const unsavedStateProviders = new Set<() => boolean>();

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

function setUpdateAvailable() {
  if (hasUpdate) return;
  hasUpdate = true;
  notifyListeners();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('7anouti-POS', { body: 'New version available, tap to refresh' });
  }
}

export const updateService = {
  getCurrentVersion(): string {
    return __APP_VERSION__;
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
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
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
    const waitingWorker = registration?.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    if (hasUpdate) window.location.reload();
  },

  startMonitoring(): () => void {
    if (monitorStarted) return () => undefined;
    monitorStarted = true;
    const check = () => {
      const lastCheck = this.getLastCheck();
      if (!lastCheck || Date.now() - new Date(lastCheck).getTime() >= CHECK_INTERVAL_MS) {
        runAutomaticCheck(lastCheck ? 'interval' : 'startup');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
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
