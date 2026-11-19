import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { permissionService, type NotificationPermissionStatus } from '../services/permissionService';
import { useAuthStore } from '../stores/authStore';

export function PermissionsPrompt() {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const [status, setStatus] = useState<NotificationPermissionStatus>('prompt');
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const shownThisOpen = useRef(false);

  useEffect(() => permissionService.subscribe(setStatus), []);

  useEffect(() => {
    if (
      !user
      || locked
      || user.mustChangePassword
      || user.mustSetPin
      || shownThisOpen.current
    ) {
      if (!user || locked || user.mustChangePassword || user.mustSetPin) setVisible(false);
      return;
    }
    let active = true;
    void permissionService.getStatus().then((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
      if (nextStatus === 'prompt' || nextStatus === 'denied') {
        shownThisOpen.current = true;
        setVisible(true);
      }
    }).catch((permissionError: unknown) => {
      console.error('[permissions] Could not check notification permission.', permissionError);
    });
    return () => {
      active = false;
    };
  }, [locked, user, user?.id, user?.mustChangePassword, user?.mustSetPin]);

  async function allowNotifications() {
    setRequesting(true);
    setError('');
    try {
      setStatus(await permissionService.request());
      setVisible(false);
    } catch (permissionError) {
      console.error('[permissions] Could not request notification permission.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not request notification permission.');
    } finally {
      setRequesting(false);
    }
  }

  async function notNow() {
    setError('');
    try {
      setStatus(await permissionService.markAsked());
      setVisible(false);
    } catch (permissionError) {
      console.error('[permissions] Could not save the permission choice.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not save your choice.');
    }
  }

  const instructions = permissionService.isNative()
    ? 'Android Settings > Apps > 7anouti-POS > Notifications'
    : 'Open your browser site settings for hanoutipos.vercel.app and enable Notifications.';

  return (
    <>
      {status === 'denied' && (
        <aside className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-xl bg-error-container p-3 text-on-error-container shadow-overlay">
          <div className="flex items-start gap-2">
            <MaterialIcon name="notifications_off" className="mt-0.5 text-lg" />
            <div className="min-w-0 flex-1">
              <p className="font-body text-label-md">Notifications are disabled. App alerts will not appear on this device.</p>
              <button
                type="button"
                className="mt-1 font-body text-label-md underline"
                onClick={() => setShowInstructions((current) => !current)}
              >
                {showInstructions ? 'Hide instructions' : 'How to enable'}
              </button>
              {showInstructions && <p className="mt-1 font-body text-body-sm">{instructions}</p>}
            </div>
          </div>
        </aside>
      )}
      {visible && user && !locked && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-primary-dark/60 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="permissions-title"
            className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-overlay"
          >
            <h1 id="permissions-title" className="font-display text-headline-lg text-on-surface">Permissions</h1>
            <p className="mt-3 font-body text-body-md text-on-surface-variant">
              7anouti-POS needs notifications for alerts like low stock, tab limits, void requests, end-of-day summary and app updates.
            </p>
            {status === 'denied' && <p className="mt-3 font-body text-body-sm text-error">{instructions}</p>}
            {error && <p role="alert" className="mt-3 font-body text-body-sm text-error">{error}</p>}
            <Button onClick={() => { void allowNotifications(); }} disabled={requesting} className="mt-6 min-h-14 w-full text-label-lg">
              {requesting ? 'Requesting…' : 'Allow notifications'}
            </Button>
            <button
              type="button"
              onClick={() => { void notNow(); }}
              disabled={requesting}
              className="mt-4 w-full font-body text-label-md text-on-surface-variant underline"
            >
              Not now
            </button>
          </section>
        </div>
      )}
    </>
  );
}
