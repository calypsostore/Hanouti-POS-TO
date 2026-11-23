import { isSupabaseDriver } from '../data/driver';

export function requireOnlineForAction(action: string): void {
  if (isSupabaseDriver() && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(`${action} requires an internet connection and cannot be queued. Only orders can be queued offline.`);
  }
}
