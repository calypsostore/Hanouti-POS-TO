import type { UpdateCheckResult } from './updateService';

export function shouldShowUpdateModal(result: UpdateCheckResult | null): boolean {
  return result?.updateAvailable === true;
}

export function confirmUpdateIfUnsaved(
  hasUnsavedWork: boolean,
  confirm: (message: string) => boolean,
): boolean {
  return !hasUnsavedWork || confirm('You have unsaved work. Updating now will reload the app and discard it. Continue?');
}
