import type { UpdateCheckResult, UpdateMode } from './updateService';

export const UPDATE_REMINDER_DELAY_MS = 5 * 60_000;

export interface UpdateReminder {
  build: string;
  remindAt: number;
}

export type PostUpdateStatus = 'completed' | 'failed' | null;

export function sanitizeStoredResult(
  result: UpdateCheckResult | null,
  currentBuild: string,
  currentVersion: string,
  currentMode: UpdateMode,
): UpdateCheckResult | null {
  if (!result || result.mode !== currentMode || result.currentVersion !== currentVersion) return null;
  if (currentMode !== 'bundled' && result.currentBuild !== currentBuild) return null;
  const installedBuild = currentMode === 'bundled' ? result.currentBuild : currentBuild;
  if (result.latestBuild === installedBuild) return null;
  return result;
}

export function getPostUpdateStatus(targetBuild: string | null, currentBuild: string): PostUpdateStatus {
  if (!targetBuild) return null;
  return targetBuild === currentBuild ? 'completed' : 'failed';
}

export function shouldShowUpdateModal(result: UpdateCheckResult | null): boolean {
  return result?.updateAvailable === true;
}

export function shouldSnoozeUpdate(
  reminder: UpdateReminder | null,
  build: string,
  now: number,
): boolean {
  return reminder?.build === build && reminder.remindAt > now;
}

export function confirmUpdateIfUnsaved(
  hasUnsavedWork: boolean,
  confirm: (message: string) => boolean,
): boolean {
  return !hasUnsavedWork || confirm('You have unsaved work. Updating now will reload the app and discard it. Continue?');
}
