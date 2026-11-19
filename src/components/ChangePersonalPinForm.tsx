import { useState, type FormEvent } from 'react';
import { authService } from '../services/authService';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';

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
      setError('The new PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await authService.changePersonalPin(userId, currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmation('');
      setNotice('Your personal PIN was changed.');
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Unable to change your PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Change personal PIN</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">Enter your current PIN, then choose a new 4-digit PIN.</p>
      </div>
      {[
        { label: 'Current PIN', value: currentPin, onChange: setCurrentPin },
        { label: 'New PIN', value: newPin, onChange: setNewPin },
        { label: 'Confirm new PIN', value: confirmation, onChange: setConfirmation },
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
        {busy ? 'Changing PIN...' : 'Change PIN'}
      </Button>
    </form>
  );
}
