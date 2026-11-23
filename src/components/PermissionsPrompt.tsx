import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { permissionService, type NotificationPermissionStatus } from '../services/permissionService';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';

export function PermissionsPrompt() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const locked = useAuthStore((state) => state.locked);
  const latestNotificationId = useNotificationStore((state) => state.items[0]?.id);
  const canPromptUser = Boolean(user && !locked && !user.mustChangePassword && !user.mustSetPin);
  const [status, setStatus] = useState<NotificationPermissionStatus>('prompt');
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [permissionChecked, setPermissionChecked] = useState(false);
  const lastPromptedNotificationKey = useRef('');

  useEffect(() => permissionService.subscribe(setStatus), []);

  useEffect(() => {
    if (!canPromptUser) {
      setPermissionChecked(false);
      setVisible(false);
      return;
    }
    let active = true;
    const checkPermission = () => {
      void permissionService.getStatus().then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setPermissionChecked(true);
        setVisible(nextStatus === 'prompt' || nextStatus === 'denied');
      }).catch((permissionError: unknown) => {
        console.error('[permissions] Could not check notification permission.', permissionError);
      });
    };
    checkPermission();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkPermission();
    };
    window.addEventListener('focus', checkPermission);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener('focus', checkPermission);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [canPromptUser, user?.id]);

  useEffect(() => {
    if (!permissionChecked || !latestNotificationId || !canPromptUser || !userId) return;
    const notificationKey = `${userId}:${latestNotificationId}`;
    if (lastPromptedNotificationKey.current === notificationKey) return;
    lastPromptedNotificationKey.current = notificationKey;
    if (status === 'prompt' || status === 'denied') setVisible(true);
  }, [canPromptUser, latestNotificationId, permissionChecked, status, userId]);

  async function allowNotifications() {
    setRequesting(true);
    setError('');
    setShowInstructions(false);
    try {
      const nextStatus = await permissionService.request();
      setStatus(nextStatus);
      if (nextStatus === 'granted' || nextStatus === 'unsupported') {
        setVisible(false);
      } else if (nextStatus === 'denied') {
        setError('Notifications are still blocked. You can enable them in your browser or device settings.');
        setShowInstructions(true);
      }
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
    : 'Open this app’s browser site settings and allow notifications.';

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
                  Notifications are off
                </p>
                <h1 id="permissions-title" className="permissions-prompt__title mt-0.5 font-display text-headline-sm text-on-surface">
                  Enable app alerts
                </h1>
              </div>
            </div>

            <p id="permissions-description" className="permissions-prompt__description mt-3 font-body text-body-sm text-on-surface-variant">
              Get important alerts for stock, void requests, tabs and end-of-day updates.
            </p>

            {error && status === 'denied' ? (
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
              <Button onClick={() => { void allowNotifications(); }} disabled={requesting} className="permissions-prompt__action min-h-11 flex-[1.35]">
                {requesting ? 'Requesting…' : 'Enable notifications'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
