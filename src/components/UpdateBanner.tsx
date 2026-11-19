import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { t } from '../i18n/translations';
import { updateService } from '../services/updateService';

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => updateService.subscribe(setAvailable), []);

  if (!available) return null;
  const availableVersion = updateService.getAvailableVersion();
  const bannerText = Capacitor.isNativePlatform() && availableVersion
    ? `New version v${availableVersion} available, tap to install`
    : t('updates.banner');
  return (
    <button
      type="button"
      aria-live="polite"
      onClick={() => void updateService.applyUpdate()}
      className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-xl rounded-xl bg-primary px-4 py-3 text-center font-body text-label-md text-on-primary shadow-overlay"
    >
      {bannerText}
    </button>
  );
}
