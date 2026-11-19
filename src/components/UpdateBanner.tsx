import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from './Button';
import { t } from '../i18n/translations';
import { updateService } from '../services/updateService';
import { useAuthStore } from '../stores/authStore';

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => updateService.subscribe(setAvailable), []);

  async function downloadUpdate() {
    setDownloading(true);
    setDownloadProgress(null);
    setDownloadError('');
    try {
      await updateService.applyUpdate(setDownloadProgress);
    } catch (error) {
      console.error('[updates] Could not download or open the Android installer.', error);
      setDownloadError('Could not download or open the installer. Check your connection and install permission, then retry.');
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    if (!isNative) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') setDismissed(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isNative]);

  if (!available) return null;
  const availableVersion = updateService.getAvailableVersion();
  if (isNative) {
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
            {t('updates.dialogMessage', {
              version: availableVersion,
              currentVersion: updateService.getCurrentVersion(),
            })}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button onClick={() => void downloadUpdate()} disabled={downloading} className="w-full sm:w-auto">
              {downloading
                ? `Downloading${downloadProgress === null ? '…' : `… ${downloadProgress}%`}`
                : t('updates.download')}
            </Button>
            <Button variant="secondary" onClick={() => setDismissed(true)} disabled={downloading} className="w-full sm:w-auto">
              {t('updates.later')}
            </Button>
          </div>
          {downloadError && <p role="alert" className="mt-3 font-body text-body-sm text-error">{downloadError}</p>}
        </section>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-live="polite"
      onClick={() => void updateService.applyUpdate()}
      className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-xl rounded-xl bg-primary px-4 py-3 text-center font-body text-label-md text-on-primary shadow-overlay"
    >
      {t('updates.banner')}
    </button>
  );
}
