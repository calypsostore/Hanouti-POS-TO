import { compareVersions } from './versionComparison';

export interface AppUpdateManifest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAppUpdateManifest(value: unknown, repository: string): AppUpdateManifest | null {
  if (!isRecord(value)) return null;
  if (typeof value.versionCode !== 'number' || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1) return null;
  if (typeof value.versionName !== 'string' || compareVersions(value.versionName, value.versionName) === null) return null;
  if (typeof value.apkUrl !== 'string' || typeof value.notes !== 'string') return null;

  const expectedPrefix = `https://github.com/${repository}/releases/download/`;
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(value.apkUrl);
  } catch {
    return null;
  }
  if (
    downloadUrl.protocol !== 'https:'
    || downloadUrl.hostname !== 'github.com'
    || !downloadUrl.href.startsWith(expectedPrefix)
    || !downloadUrl.pathname.toLowerCase().endsWith('.apk')
  ) return null;

  return {
    versionCode: value.versionCode,
    versionName: value.versionName,
    apkUrl: downloadUrl.toString(),
    notes: value.notes,
  };
}

export function isUpdateCheckDue(lastCheckAt: string | null, now: number, intervalMs: number): boolean {
  if (!lastCheckAt) return true;
  const lastCheck = Date.parse(lastCheckAt);
  return !Number.isFinite(lastCheck) || now - lastCheck >= intervalMs;
}
