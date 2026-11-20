import { useEffect, useState } from 'react';
import { Button } from './Button';
import { updateService, type UpdateCheckResult } from '../services/updateService';
import {
  shouldShowUpdateModal,
  UPDATE_REMINDER_DELAY_MS,
  type UpdateReminder,
} from '../services/updateModalLogic';

export function UpdateRequiredModal({ result }: { result: UpdateCheckResult | null }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [reminder, setReminder] = useState<UpdateReminder | null>(null);
  const updateBuild = result?.latestBuild ?? result?.latestVersion ?? 'unknown';
  const snoozed = reminder?.build === updateBuild;
  const visible = shouldShowUpdateModal(result) && !snoozed;

  useEffect(() => {
    if (!reminder) return;
    const timeoutId = window.setTimeout(
      () => setReminder(null),
      Math.max(0, reminder.remindAt - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [reminder]);

  useEffect(() => {
    if (!visible) return;
    const preventEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', preventEscape, true);
    return () => document.removeEventListener('keydown', preventEscape, true);
  }, [visible]);

  if (!visible || !result) return null;
  const bundled = result.mode === 'bundled';
  const hasUnsavedWork = updateService.hasUnsavedChanges();

  async function updateNow() {
    setUpdating(true);
    setError('');
    try {
      await updateService.applyUpdate();
    } catch (updateError) {
      console.error('[updates] Could not apply the required update.', updateError);
      setError(updateError instanceof Error ? updateError.message : 'Could not apply the update.');
    } finally {
      setUpdating(false);
    }
  }

  function remindLater() {
    setReminder({
      build: updateBuild,
      remindAt: Date.now() + UPDATE_REMINDER_DELAY_MS,
    });
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-primary-dark/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="required-update-title"
        aria-describedby="required-update-message"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-overlay"
      >
        <h1 id="required-update-title" className="font-display text-headline-lg text-on-surface">
          Update required
        </h1>
        <p id="required-update-message" className="mt-3 font-body text-body-md text-on-surface-variant">
          A new version is available. Please update to continue.
        </p>
        <div className="mt-4 space-y-1 font-body text-body-sm text-on-surface">
          <p>Current: v{result.currentVersion} (build {result.currentBuild})</p>
          <p>New: v{result.latestVersion ?? 'unknown'} (build {result.latestBuild ?? 'unknown'})</p>
        </div>
        {hasUnsavedWork && (
          <p className="mt-4 rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">
            You have unsaved work. You will be asked to confirm before the app reloads.
          </p>
        )}
        {bundled && !result.latestApkUrl && (
          <p role="alert" className="mt-4 font-body text-body-sm text-error">
            {result.error ?? 'The APK download link is not available yet.'}
          </p>
        )}
        {error && <p role="alert" className="mt-4 font-body text-body-sm text-error">{error}</p>}
        <Button
          onClick={() => { void updateNow(); }}
          disabled={updating || (bundled && !result.latestApkUrl)}
          className="mt-6 min-h-14 w-full text-label-lg"
        >
          {updating ? 'Updating…' : bundled ? 'Download the new APK' : 'Update now'}
        </Button>
        <Button
          variant="secondary"
          onClick={remindLater}
          disabled={updating}
          className="mt-3 min-h-12 w-full"
        >
          Remind me after 5 minutes
        </Button>
      </section>
    </div>
  );
}
