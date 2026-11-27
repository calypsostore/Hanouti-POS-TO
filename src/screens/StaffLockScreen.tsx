import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { useAuthStore } from '../stores/authStore';
import { t } from '../i18n/translations';
import { localizeErrorMessage } from '../i18n';

export function StaffLockScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);
  const [identifier, setIdentifier] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(identifier, password, ['staff']);
      navigate('/dashboard', { replace: true });
    } catch (unlockError) {
      setError(localizeErrorMessage(unlockError, t('lock.unableToUnlock')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <form onSubmit={(event) => { void unlock(event); }} className="w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6 shadow-card">
        <div className="mb-5 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-fixed text-primary"><MaterialIcon name="lock" className="text-2xl" /></span>
          <h1 className="mt-3 font-display text-headline-lg text-on-surface">{t('lock.terminalLocked')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{user?.name} · {t('lock.shiftRemainsOpen')}</p>
        </div>
        <label className="mb-3 block font-body text-label-md text-on-surface">
          {t('login.staffIdentifier')}
          <input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="mb-4 block font-body text-label-md text-on-surface">
          {t('lock.password')}
          <input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
        </label>
        {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full">
          <MaterialIcon name={submitting ? 'sync' : 'lock_open'} className={submitting ? 'animate-spin' : ''} />
          {submitting ? t('lock.unlocking') : t('lock.unlockTerminal')}
        </Button>
      </form>
    </main>
  );
}
