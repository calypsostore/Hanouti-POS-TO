import { useEffect, useState } from 'react';
import { Button } from './Button';
import { permissionService, type NotificationPermissionStatus } from '../services/permissionService';
import { SettingsGlassSection } from './settings/SettingsGlassSection';
import { t } from '../i18n/translations';
import { localizeErrorMessage } from '../i18n';

export function PermissionsSettingsCard() {
  const [status, setStatus] = useState<NotificationPermissionStatus>('prompt');
  const [showInstructions, setShowInstructions] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = permissionService.subscribe(setStatus);
    void permissionService.getStatus().catch((permissionError: unknown) => {
      console.error('[permissions] Could not check notification permission.', permissionError);
      setError(localizeErrorMessage(permissionError, t('permissions.checkFailed')));
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
      setError(localizeErrorMessage(permissionError, t('permissions.requestFailed')));
    } finally {
      setRequesting(false);
    }
  }

  const instructions = permissionService.isNative()
    ? t('permissions.androidInstructions')
    : t('permissions.browserSettingsInstructions');

  return (
    <SettingsGlassSection heading={t('permissions.settingsHeading')} description={t('permissions.settingsDescription')} icon="lock_open">
      <div className="flex items-center justify-between gap-2 font-body text-body-sm">
        <span className="text-on-surface-variant">{t('notifications.label')}</span>
        <span className="font-semibold text-on-surface">{t(
          status === 'granted'
            ? 'permissions.allowed'
            : status === 'denied'
              ? 'permissions.denied'
              : status === 'prompt'
                ? 'permissions.notYetAllowed'
                : 'permissions.unsupported',
        )}</span>
      </div>
      {error && <p role="alert" className="font-body text-body-sm text-error">{error}</p>}
      {status !== 'granted' && status !== 'unsupported' && (
        <Button onClick={() => { void requestNotifications(); }} disabled={requesting} variant="secondary" className="w-full">
          {requesting ? t('permissions.requesting') : t('permissions.askAgain')}
        </Button>
      )}
      {status === 'denied' && (
        <>
          <Button onClick={() => setShowInstructions((current) => !current)} variant="secondary" className="w-full">
            {showInstructions ? t('permissions.hideInstructions') : t('permissions.howToEnable')}
          </Button>
          {showInstructions && <p className="font-body text-body-sm text-on-surface-variant">{instructions}</p>}
        </>
      )}
      {status === 'granted' && (
        <>
          <Button onClick={() => setShowInstructions((current) => !current)} variant="secondary" className="w-full">
            {showInstructions ? t('permissions.hideInstructions') : t('permissions.notificationSettings')}
          </Button>
          {showInstructions && <p className="font-body text-body-sm text-on-surface-variant">{instructions}</p>}
        </>
      )}
    </SettingsGlassSection>
  );
}
