import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { t } from '../i18n/translations';
import { Button } from './Button';
import { Keypad } from './Keypad';
import { MaterialIcon } from './MaterialIcon';
import { localizeErrorMessage } from '../i18n';

interface LockScreenProps {
  returnTo: string;
}

export function LockScreen({ returnTo }: LockScreenProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const device = useAuthStore((state) => state.device);
  const unlockWithPin = useAuthStore((state) => state.unlockWithPin);
  const unlockWithPassword = useAuthStore((state) => state.unlockWithPassword);
  const logout = useAuthStore((state) => state.logout);
  const deviceBoundSession = Boolean(device && user);
  const [hasPin, setHasPin] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lockRemainingMs, setLockRemainingMs] = useState(0);

  useEffect(() => {
    if (!user?.storeId) return;
    let active = true;
    void Promise.all([
      userService.getStore(user.storeId),
      authService.hasPersonalPin(user.id),
    ]).then(([store, userHasPin]) => {
      if (!active) return;
      setStoreName(store?.name ?? '');
      setHasPin(userHasPin);
      setPasswordMode(!userHasPin);
    }).catch((loadError: unknown) => {
      if (active) setError(localizeErrorMessage(loadError, t('lock.unableToLoad')));
    });
    return () => { active = false; };
  }, [user?.id, user?.storeId]);

  useEffect(() => {
    if (!user) return;
    const updateRemaining = () => setLockRemainingMs(authService.getPinLockRemainingMs(user.id));
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [user]);

  function finishUnlock() {
    navigate(returnTo, { replace: true });
  }

  async function submitPin() {
    if (pin.length !== 4 || submitting || lockRemainingMs > 0) return;
    setSubmitting(true);
    setError('');
    try {
      await unlockWithPin(pin);
      finishUnlock();
    } catch (unlockError) {
      setError(localizeErrorMessage(unlockError, t('lock.unableToUnlock')));
      setPin('');
      if (user) setLockRemainingMs(authService.getPinLockRemainingMs(user.id));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || loggingOut) return;
    setSubmitting(true);
    setError('');
    try {
      await unlockWithPassword(password);
      finishUnlock();
    } catch (unlockError) {
      setError(localizeErrorMessage(unlockError, t('lock.unableToUnlock')));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (submitting || loggingOut) return;
    setLoggingOut(true);
    setError('');
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (logoutError) {
      setError(localizeErrorMessage(logoutError, t('lock.unableToLogout')));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <section className="w-full max-w-sm rounded-3xl bg-surface-container-lowest p-6 shadow-card">
        <div className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-fixed text-primary">
            <MaterialIcon name="lock" className="text-3xl" filled />
          </span>
          <h1 className="mt-4 font-display text-headline-lg text-on-surface">{t('lock.terminalLocked')}</h1>
          <p className="mt-1 font-body text-title-md text-on-surface">{user?.name}</p>
          {storeName && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{storeName}</p>}
        </div>

        {passwordMode ? (
          <form onSubmit={(event) => { void submitPassword(event); }} className="mt-6 flex flex-col gap-3">
            <label htmlFor="lock-password" className="font-body text-label-md text-on-surface">{t('lock.password')}</label>
            <input
              id="lock-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-body-lg outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" disabled={submitting || loggingOut || !password} className="min-h-12 w-full">
              <MaterialIcon name="lock_open" />
              {t('lock.unlock')}
            </Button>
            {hasPin && (
              <button type="button" onClick={() => { setPasswordMode(false); setError(''); }} className="min-h-11 font-body text-label-md text-primary">
                {t('lock.usePinInstead')}
              </button>
            )}
          </form>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-center font-body text-label-md text-on-surface-variant">{t('lock.enterPin')}</p>
            <div className="flex h-8 items-center justify-center gap-3" aria-label={t('devices.pinDigitsEntered', { entered: String(pin.length), total: '4' })}>
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className={`h-3 w-3 rounded-full ${index < pin.length ? 'bg-primary' : 'bg-outline-variant'}`} />
              ))}
            </div>
            <Keypad
              disabled={submitting || loggingOut || lockRemainingMs > 0}
              onPress={(digit) => setPin((current) => current.length < 4 ? current + digit : current)}
              onClear={() => setPin('')}
              onBackspace={() => setPin((current) => current.slice(0, -1))}
            />
            {lockRemainingMs > 0 && (
              <p role="status" className="text-center font-body text-body-sm text-error-dark">
                {t('lock.tryAgainIn', { seconds: String(Math.ceil(lockRemainingMs / 1000)) })}
              </p>
            )}
            <Button type="button" disabled={submitting || loggingOut || pin.length !== 4 || lockRemainingMs > 0} onClick={() => { void submitPin(); }} className="min-h-12 w-full">
              <MaterialIcon name="lock_open" />
              {t('lock.unlock')}
            </Button>
            <button type="button" onClick={() => { setPasswordMode(true); setError(''); }} className="min-h-11 font-body text-label-md text-primary">
              {t('lock.usePasswordInstead')}
            </button>
          </div>
        )}

        <Button type="button" variant="ghost" disabled={submitting || loggingOut || deviceBoundSession} onClick={() => { void handleLogout(); }} className="mt-4 w-full border border-outline-variant">
          <MaterialIcon name={loggingOut ? 'sync' : 'logout'} className={loggingOut ? 'animate-spin' : ''} />
          {loggingOut ? t('lock.signingOut') : t('app.logOut')}
        </Button>
        {deviceBoundSession && <p role="note" className="mt-2 text-center font-body text-body-sm text-on-surface-variant">{t('devices.deviceLogoutDisabled')}</p>}

        {error && <p role="alert" className="mt-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      </section>
    </main>
  );
}
