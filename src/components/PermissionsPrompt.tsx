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
      const nextStatus = await permissionService.request();
      setStatus(nextStatus);
      if (nextStatus === 'granted' || nextStatus === 'unsupported') {
        setVisible(false);
      } else if (nextStatus === 'denied') {
        setError('Notifications are still blocked. Please enable them in your browser or device settings.');
      }
    } catch (permissionError) {
      console.error('[permissions] Could not request notification permission.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not request notification permission.');
    } finally {
      setRequesting(false);
    }
  }

  async function checkEnabled() {
    setRequesting(true);
    setError('');
    try {
      const nextStatus = await permissionService.getStatus();
      setStatus(nextStatus);
      if (nextStatus === 'granted') {
        setVisible(false);
      } else if (nextStatus === 'denied') {
        setError('Notifications are still blocked. Follow the settings steps below, then try again.');
      }
    } catch (permissionError) {
      console.error('[permissions] Could not check notification permission.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not check notification permission.');
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
      {visible && user && !locked && (
        <div
          className="glass-modal-backdrop permissions-prompt__backdrop fixed inset-0 z-[150] flex items-center justify-center bg-primary-dark/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) void notNow();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="permissions-title"
            aria-describedby="permissions-description"
            className="glass-modal-panel permissions-prompt__dialog relative w-full max-w-sm overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-overlay"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close notification prompt"
              onClick={() => { void notNow(); }}
              className="permissions-prompt__close absolute right-2 top-2 grid size-8 place-items-center rounded-full text-on-surface-variant transition hover:bg-surface-container"
            >
              <MaterialIcon name="close" className="text-lg" />
            </button>

            <div className="flex items-start gap-3 pr-7">
              <div className="permissions-prompt__icon grid size-11 shrink-0 place-items-center rounded-full bg-primary-fixed text-primary">
                <MaterialIcon
                  name={status === 'denied' ? 'notifications_off' : 'notifications_active'}
                  className="text-2xl"
                />
              </div>
              <div className="min-w-0">
                <p className="permissions-prompt__eyebrow font-body text-label-sm font-semibold text-primary">
                  {status === 'denied' ? 'Notifications blocked' : 'Notification reminder'}
                </p>
                <h1 id="permissions-title" className="permissions-prompt__title mt-0.5 font-display text-headline-sm text-on-surface">
                  {status === 'denied' ? 'Enable app alerts' : 'Turn on notifications'}
                </h1>
              </div>
            </div>

            <p id="permissions-description" className="permissions-prompt__description mt-3 font-body text-body-sm text-on-surface-variant">
              {status === 'denied'
                ? 'Enable notifications in browser or device settings to receive important app alerts.'
                : 'Get important alerts for stock, void requests, tabs and end-of-day updates.'}
            </p>

            {status === 'denied' ? (
              <button
                type="button"
                className="permissions-prompt__instructions mt-3 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-left"
                onClick={() => setShowInstructions((current) => !current)}
              >
                <span className="flex items-center justify-between gap-2 font-body text-label-sm text-on-surface">
                  <span>{showInstructions ? 'Hide instructions' : 'How to enable'}</span>
                  <MaterialIcon name={showInstructions ? 'expand_less' : 'expand_more'} className="text-lg" />
                </span>
                {showInstructions && <p className="mt-2 font-body text-body-sm text-on-surface-variant">{instructions}</p>}
              </button>
            ) : null}

            {error && <p role="alert" className="permissions-prompt__error mt-2 font-body text-body-sm text-error">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { void notNow(); }}
                disabled={requesting}
                className="permissions-prompt__later min-h-11 flex-1 rounded-lg bg-surface-container text-on-surface-variant font-body text-label-md transition hover:bg-surface-container-high"
              >
                Maybe later
              </button>
              {status === 'denied' ? (
                <Button
                  onClick={() => { void checkEnabled(); }}
                  disabled={requesting}
                  className="permissions-prompt__action min-h-11 flex-[1.35]"
                >
                  {requesting ? 'Checking…' : 'I’ve enabled it'}
                </Button>
              ) : (
                <Button onClick={() => { void allowNotifications(); }} disabled={requesting} className="permissions-prompt__action min-h-11 flex-[1.35]">
                  {requesting ? 'Requesting…' : 'Allow'}
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
