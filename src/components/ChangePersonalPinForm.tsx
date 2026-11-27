import { useState, type FormEvent } from 'react';
import { authService } from '../services/authService';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { SettingsGlassSection } from './settings/SettingsGlassSection';
import { t } from '../i18n/translations';
import { localizeErrorMessage } from '../i18n';

interface ChangePersonalPinFormProps {
  userId: string;
}

export function ChangePersonalPinForm({ userId }: ChangePersonalPinFormProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPin !== confirmation) {
      setError(t('password.personalPinsMismatch'));
      return;
    }
    setBusy(true);
    try {
      await authService.changePersonalPin(userId, currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmation('');
      setNotice(t('password.personalPinChanged'));
    } catch (changeError) {
      setError(localizeErrorMessage(changeError, t('password.personalPinChangeUnable')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGlassSection heading={t('password.personalChangeHeading')} description={t('password.personalChangeDescription')} icon="pin">
      <form onSubmit={submit} className="settings-glass-form flex flex-col gap-3">
      {[
        { label: t('password.currentPin'), value: currentPin, onChange: setCurrentPin },
        { label: t('password.newPin'), value: newPin, onChange: setNewPin },
        { label: t('password.confirmNewPin'), value: confirmation, onChange: setConfirmation },
      ].map((field) => (
        <label key={field.label} className="font-body text-label-md">
          {field.label}
          <input
            required
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            value={field.value}
            onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
            className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 text-center font-mono tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      ))}
      {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
      {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
      <Button type="submit" disabled={busy || !/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin) || !/^\d{4}$/.test(confirmation)}>
        <MaterialIcon name="lock_reset" />
        {busy ? t('password.changingPin') : t('password.changePin')}
      </Button>
      </form>
    </SettingsGlassSection>
  );
}
