import { useEffect, useState } from 'react';
import { Button } from './Button';
import { t } from '../i18n/translations';
import { updateService } from '../services/updateService';
import { useAuthStore } from '../stores/authStore';

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [openingHostedApp, setOpeningHostedApp] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const bundled = updateService.getMode() === 'bundled';

  useEffect(() => updateService.subscribe((nextAvailable) => {
    setAvailable(nextAvailable);
    if (nextAvailable) setDismissed(false);
  }), []);

  async function openHostedApp() {
    setOpeningHostedApp(true);
    setUpdateError('');
    try {
      await updateService.openHostedApp();
    } catch (error) {
      console.error('[updates] Could not open the hosted app.', error);
      setUpdateError(error instanceof Error ? error.message : 'Could not open the hosted app.');
    } finally {
      setOpeningHostedApp(false);
    }
  }

  useEffect(() => {
    if (!bundled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') setDismissed(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [bundled]);

  if (!available) return null;
  const availableVersion = updateService.getAvailableVersion();
  if (bundled) {
    if (!availableVersion || dismissed || !user || locked || user.mustChangePassword) return null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary-dark/60 p-4 backdrop-blur-sm">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-dialog-title"
          aria-describedby="update-dialog-message"
          className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-overlay"
        >
          <h2 id="update-dialog-title" className="font-display text-headline-md text-on-surface">
            {t('updates.dialogTitle')}
          </h2>
          <p id="update-dialog-message" className="mt-3 font-body text-body-md text-on-surface-variant">
            A newer hosted build ({availableVersion}) is available. A new APK is required to update this installed app.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button onClick={() => void openHostedApp()} disabled={openingHostedApp} className="w-full sm:w-auto">
              {openingHostedApp ? 'Opening…' : 'Open hosted app'}
            </Button>
            <Button variant="secondary" onClick={() => setDismissed(true)} disabled={openingHostedApp} className="w-full sm:w-auto">
              {t('updates.later')}
            </Button>
          </div>
          {updateError && <p role="alert" className="mt-3 font-body text-body-sm text-error">{updateError}</p>}
        </section>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-live="polite"
      onClick={() => void updateService.applyUpdate().catch((error: unknown) => {
        console.error('[updates] Could not apply the available update.', error);
        setUpdateError(error instanceof Error ? error.message : 'Could not apply the update.');
      })}
      className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-xl rounded-xl bg-primary px-4 py-3 text-center font-body text-label-md text-on-primary shadow-overlay"
    >
      {t('updates.banner')}
    </button>
  );
}
