import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import type { UpdateCheckResult } from '../services/updateService';
import {
  shouldShowUpdateModal,
  UPDATE_REMINDER_DELAY_MS,
  type UpdateReminder,
} from '../services/updateModalLogic';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';

export function UpdateRequiredModal({ result }: { result: UpdateCheckResult | null }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false);
  const [reminder, setReminder] = useState<UpdateReminder | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const portalTarget = useOverlayTarget();
  const updateBuild = result?.latestBuild ?? result?.latestVersion ?? 'unknown';
  const snoozed = reminder?.build === updateBuild;
  const visible = shouldShowUpdateModal(result) && !snoozed;
  const zIndex = useOverlayLifecycle({
    open: visible && Boolean(result),
    kind: 'critical',
    preventEscape: true,
    lockScroll: true,
    trapFocus: true,
    restoreFocus: true,
    containerRef: panelRef,
  });

  useEffect(() => {
    if (!reminder) return;
    const timeoutId = window.setTimeout(
      () => setReminder(null),
      Math.max(0, reminder.remindAt - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [reminder]);

  useEffect(() => {
    if (!visible) {
      setHasUnsavedWork(false);
      return;
    }
    let active = true;
    void import('../services/updateService').then(({ updateService }) => {
      if (active) setHasUnsavedWork(updateService.hasUnsavedChanges());
    }).catch((loadError: unknown) => {
      console.error('[updates] Could not check for unsaved work.', loadError);
      if (active) setError('Could not check whether there is unsaved work.');
    });
    return () => { active = false; };
  }, [visible]);

  if (!visible || !result) return null;
  const bundled = result.mode === 'bundled';

  async function updateNow() {
    setUpdating(true);
    setError('');
    try {
      const { updateService } = await import('../services/updateService');
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

  const modal = (
    <div
      className="glass-modal-backdrop required-update-backdrop fixed inset-0 flex items-center justify-center bg-primary-dark/70 p-4 backdrop-blur-sm"
      style={{ zIndex }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="required-update-title"
        aria-describedby="required-update-message"
        className="glass-modal-panel required-update-dialog-panel max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-overlay"
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
  if (typeof document === 'undefined' || !portalTarget) return modal;
  return createPortal(modal, portalTarget);
}
