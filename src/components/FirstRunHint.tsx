import { useState } from 'react';
import { t } from '../i18n/translations';
import { MaterialIcon } from './MaterialIcon';

interface FirstRunHintProps {
  id: string;
  title: string;
  message: string;
}

function wasDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(`7anouti-pos:first-run:${id}`) === 'true';
  } catch (error) {
    console.error('Unable to read first-run hint preference.', error);
    return false;
  }
}

export function FirstRunHint({ id, title, message }: FirstRunHintProps) {
  const [dismissed, setDismissed] = useState(() => wasDismissed(id));
  const [error, setError] = useState('');

  function dismiss() {
    try {
      window.localStorage.setItem(`7anouti-pos:first-run:${id}`, 'true');
    } catch (saveError) {
      console.error('Unable to save first-run hint preference.', saveError);
      setError(t('hint.dismissFailed'));
    }
    setDismissed(true);
  }

  if (dismissed) {
    return error ? <p role="alert" className="mb-3 rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">{error}</p> : null;
  }

  return (
    <aside role="note" className="mx-3 mb-3 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-fixed p-3 text-on-surface">
      <MaterialIcon name="lightbulb" className="mt-0.5 text-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-body text-label-md">{title}</p>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">{message}</p>
      </div>
      <button type="button" onClick={dismiss} aria-label={t('hint.dismiss')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary">
        <MaterialIcon name="close" />
      </button>
    </aside>
  );
}
