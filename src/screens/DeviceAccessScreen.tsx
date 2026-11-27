import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Keypad } from '../components/Keypad';
import { MaterialIcon } from '../components/MaterialIcon';
import { ResponsiveDialog } from '../components/layout/ResponsiveDialog';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { useAuthStore } from '../stores/authStore';
import { requiresCredentialSetup } from '../services/credentialSetup';
import { t } from '../i18n/translations';
import type { UserSummary } from '../types/domain';
import { getLanguage, localizeErrorMessage, subscribeToLanguage } from '../i18n';
import { isLanguageCode, LANGUAGE_OPTIONS } from '../i18n/languageConfig';
import { settingsService } from '../services/settingsService';
import { getDevicePinAutoLoginPreference, setDevicePinAutoLoginPreference, shouldAutoLoginWithDevicePin } from '../services/devicePinPreferences';

function destinationForUser(user: UserSummary): string {
  if (requiresCredentialSetup(user)) return '/set-password';
  return user.role === 'staff' ? '/dashboard' : user.role === 'owner' ? '/owner/dashboard' : '/admin/overview';
}

export function DeviceLoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const device = useAuthStore((state) => state.device);
  const loginDevice = useAuthStore((state) => state.loginDevice);
  const loginWithDevicePin = useAuthStore((state) => state.loginWithDevicePin);
  const changeDevicePassword = useAuthStore((state) => state.changeDevicePassword);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [languageError, setLanguageError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [autoLogin, setAutoLogin] = useState(getDevicePinAutoLoginPreference);
  const language = useSyncExternalStore(subscribeToLanguage, getLanguage);

  if (user) {
    return <Navigate to={destinationForUser(user)} replace />;
  }
  if (!device && location.pathname === '/device-pin') {
    return <Navigate to="/device-login" replace />;
  }
  if (device && location.pathname === '/device-login') {
    return <Navigate to="/device-pin" replace />;
  }

  async function submitDeviceLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await loginDevice(username.trim(), password);
      navigate('/device-pin', { replace: true });
    } catch (loginError) {
      setError(localizeErrorMessage(loginError, t('devices.loginFailed')));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < 10) {
      setError(t('devices.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmation) {
      setError(t('devices.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changeDevicePassword(newPassword);
      setNewPassword('');
      setConfirmation('');
    } catch (passwordError) {
      setError(localizeErrorMessage(passwordError, t('devices.passwordChangeFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(pinValue = pin) {
    if (busy || pinValue.length !== 4) return;
    setBusy(true);
    setError('');
    try {
      const account = await loginWithDevicePin(pinValue);
      navigate(destinationForUser(account), { replace: true });
    } catch (pinError) {
      setPin('');
      setError(localizeErrorMessage(pinError, t('devices.pinFailed')));
    } finally {
      setBusy(false);
    }
  }

  function handlePinPress(digit: string) {
    if (busy || pin.length >= 4) return;
    const nextPin = `${pin}${digit}`;
    setPin(nextPin);
    if (shouldAutoLoginWithDevicePin(nextPin, autoLogin)) void submitPin(nextPin);
  }

  async function changeLanguage(value: string) {
    if (!isLanguageCode(value)) return;
    setLanguageError('');
    try {
      await settingsService.setLanguage(value);
      setLanguageDialogOpen(false);
    } catch (languageChangeError) {
      console.error('[devices] Could not change the PIN screen language.', languageChangeError);
      setLanguageError(localizeErrorMessage(languageChangeError, t('settings.languageFailed')));
    }
  }

  function updateAutoLogin(enabled: boolean) {
    setSettingsError('');
    try {
      setDevicePinAutoLoginPreference(enabled);
      setAutoLogin(enabled);
    } catch (preferenceError) {
      console.error('[devices] Could not save the PIN sign-in preference.', preferenceError);
      setSettingsError(localizeErrorMessage(preferenceError, t('devices.autoLoginSaveFailed')));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <section className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-6 shadow-card tablet:p-8">
        <header className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-fixed text-primary">
            <MaterialIcon name={device ? 'point_of_sale' : 'devices'} className="text-3xl" filled />
          </span>
          <h1 className="mt-4 font-display text-headline-lg text-on-surface">
            {device ? device.name : t('devices.loginTitle')}
          </h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {device
              ? device.mustChangePassword ? t('devices.changePasswordFirst') : t('devices.enterStaffPin')
              : t('devices.loginDescription')}
          </p>
        </header>

        {device && !device.mustChangePassword && (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              aria-label={t('settings.language')}
              title={t('settings.language')}
              onClick={() => { setLanguageError(''); setLanguageDialogOpen(true); }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container text-primary"
            >
              <MaterialIcon name="language" />
            </button>
            <button
              type="button"
              aria-label={t('devices.pinLoginSettings')}
              title={t('devices.pinLoginSettings')}
              onClick={() => { setSettingsError(''); setSettingsDialogOpen(true); }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container text-primary"
            >
              <MaterialIcon name="settings" />
            </button>
          </div>
        )}

        {!device ? (
          <form onSubmit={(event) => { void submitDeviceLogin(event); }} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-2 font-body text-label-md text-on-surface">
              {t('devices.username')}
              <input
                autoFocus
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-12 rounded-xl border border-outline-variant bg-surface px-4 font-body text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-2 font-body text-label-md text-on-surface">
              {t('login.password')}
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-xl border border-outline-variant bg-surface px-4 font-body text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <Button type="submit" disabled={busy || !username.trim() || !password} className="min-h-12 w-full">
              <MaterialIcon name={busy ? 'sync' : 'login'} className={busy ? 'animate-spin' : ''} />
              {busy ? t('login.verifying') : t('devices.signInDevice')}
            </Button>
            <button type="button" onClick={() => navigate('/')} className="min-h-11 font-body text-label-md text-primary">
              {t('devices.backToStaffLogin')}
            </button>
          </form>
        ) : device.mustChangePassword ? (
          <form onSubmit={(event) => { void submitPasswordChange(event); }} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-2 font-body text-label-md text-on-surface">
              {t('devices.newPassword')}
              <input
                autoFocus
                autoComplete="new-password"
                type="password"
                minLength={10}
                maxLength={128}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="h-12 rounded-xl border border-outline-variant bg-surface px-4 font-body text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-2 font-body text-label-md text-on-surface">
              {t('devices.confirmPassword')}
              <input
                autoComplete="new-password"
                type="password"
                minLength={10}
                maxLength={128}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="h-12 rounded-xl border border-outline-variant bg-surface px-4 font-body text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <Button type="submit" disabled={busy || newPassword.length < 10 || newPassword !== confirmation} className="min-h-12 w-full">
              <MaterialIcon name={busy ? 'sync' : 'lock_reset'} className={busy ? 'animate-spin' : ''} />
              {busy ? t('devices.savingPassword') : t('devices.savePassword')}
            </Button>
          </form>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-center font-body text-label-md text-on-surface-variant">{t('devices.staffPinLabel')}</p>
            <div className="flex h-8 items-center justify-center gap-3" aria-label={t('devices.pinDigitsEntered', { entered: String(pin.length), total: '4' })}>
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className={`h-3 w-3 rounded-full ${index < pin.length ? 'bg-primary' : 'bg-outline-variant'}`} />
              ))}
            </div>
            <Keypad
              disabled={busy}
              onPress={handlePinPress}
              onClear={() => setPin('')}
              onBackspace={() => setPin((current) => current.slice(0, -1))}
            />
            <Button type="button" disabled={busy || pin.length !== 4} onClick={() => { void submitPin(); }} className="min-h-12 w-full">
              <MaterialIcon name={busy ? 'sync' : 'login'} className={busy ? 'animate-spin' : ''} />
              {busy ? t('login.verifying') : t('devices.signInStaff')}
            </Button>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      </section>
      <ResponsiveDialog
        open={languageDialogOpen}
        onClose={() => setLanguageDialogOpen(false)}
        title={t('settings.language')}
        subtitle={t('settings.languageDescription')}
        icon="language"
      >
        <label htmlFor="device-pin-language" className="mb-2 block font-body text-label-md text-on-surface">
          {t('settings.language')}
        </label>
        <select
          id="device-pin-language"
          aria-label={t('settings.language')}
          value={language}
          onChange={(event) => { void changeLanguage(event.currentTarget.value); }}
          className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md outline-none focus:ring-2 focus:ring-primary"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>{option.name}</option>
          ))}
        </select>
        {languageError && <p role="alert" className="mt-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{languageError}</p>}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        title={t('devices.pinLoginSettings')}
        icon="settings"
      >
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low p-3">
          <div>
            <p className="font-body text-label-md text-on-surface">{t('devices.autoLogin')}</p>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('devices.autoLoginDescription')}</p>
          </div>
          <ToggleSwitch
            checked={autoLogin}
            label={t('devices.autoLogin')}
            onChange={() => updateAutoLogin(!autoLogin)}
          />
        </div>
        {settingsError && <p role="alert" className="mt-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{settingsError}</p>}
      </ResponsiveDialog>
    </main>
  );
}
