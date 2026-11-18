const CURRENT_VERSION = '0.1.0';
const LAST_CHECK_KEY = '7anouti-pos:last-update-check';

export interface UpdateCheckResult {
  currentVersion: string;
  checkedAt: string;
  updateAvailable: boolean;
}

export const updateService = {
  getCurrentVersion(): string {
    return CURRENT_VERSION;
  },

  getLastCheck(): string | null {
    return localStorage.getItem(LAST_CHECK_KEY);
  },

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const checkedAt = new Date().toISOString();
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.update();
    localStorage.setItem(LAST_CHECK_KEY, checkedAt);
    return { currentVersion: CURRENT_VERSION, checkedAt, updateAvailable: false };
  },
};
