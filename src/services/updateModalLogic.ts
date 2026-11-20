import type { UpdateCheckResult } from './updateService';

export const UPDATE_REMINDER_DELAY_MS = 5 * 60_000;

export interface UpdateReminder {
  build: string;
  remindAt: number;
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
