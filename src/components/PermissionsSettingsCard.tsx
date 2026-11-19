import { useEffect, useState } from 'react';
import { Button } from './Button';
import { permissionService, type NotificationPermissionStatus } from '../services/permissionService';

const statusLabels: Record<NotificationPermissionStatus, string> = {
  granted: 'Allowed',
  denied: 'Denied',
  prompt: 'Not yet allowed',
  unsupported: 'Not supported on this device',
};

export function PermissionsSettingsCard() {
  const [status, setStatus] = useState<NotificationPermissionStatus>('prompt');
  const [showInstructions, setShowInstructions] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = permissionService.subscribe(setStatus);
    void permissionService.getStatus().catch((permissionError: unknown) => {
      console.error('[permissions] Could not check notification permission.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not check notification permission.');
    });
    return unsubscribe;
  }, []);

  async function requestNotifications() {
    setRequesting(true);
    setError('');
    try {
      setStatus(await permissionService.request());
    } catch (permissionError) {
      console.error('[permissions] Could not request notification permission.', permissionError);
      setError(permissionError instanceof Error ? permissionError.message : 'Could not request notification permission.');
    } finally {
      setRequesting(false);
    }
  }

  const instructions = permissionService.isNative()
    ? 'Android Settings > Apps > 7anouti-POS > Notifications'
    : 'Open your browser site settings for hanoutipos.vercel.app and enable Notifications.';

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <h2 className="font-display text-headline-md text-on-surface">Permissions</h2>
      <div className="flex items-center justify-between gap-2 font-body text-body-sm">
        <span className="text-on-surface-variant">Notifications</span>
        <span className="font-semibold text-on-surface">{statusLabels[status]}</span>
      </div>
      {error && <p role="alert" className="font-body text-body-sm text-error">{error}</p>}
      {status !== 'granted' && status !== 'unsupported' && (
        <Button onClick={() => { void requestNotifications(); }} disabled={requesting} variant="secondary" className="w-full">
          {requesting ? 'Requesting…' : 'Ask again'}
        </Button>
      )}
      {status === 'denied' && (
        <>
          <Button onClick={() => setShowInstructions((current) => !current)} variant="secondary" className="w-full">
            {showInstructions ? 'Hide instructions' : 'How to enable'}
          </Button>
          {showInstructions && <p className="font-body text-body-sm text-on-surface-variant">{instructions}</p>}
        </>
      )}
      {status === 'granted' && (
        <>
          <Button onClick={() => setShowInstructions((current) => !current)} variant="secondary" className="w-full">
            {showInstructions ? 'Hide instructions' : 'Notification settings'}
          </Button>
          {showInstructions && <p className="font-body text-body-sm text-on-surface-variant">{instructions}</p>}
        </>
      )}
    </section>
  );
}
