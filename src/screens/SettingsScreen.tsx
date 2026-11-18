import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { authService } from '../services/authService';
import { settingsService } from '../services/settingsService';
import { updateService } from '../services/updateService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { t } from '../i18n/translations';
import { adminWorkspaceLinks, ownerWorkspaceLinks } from '../app/navigation';

export function SettingsScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [storeName, setStoreName] = useState(store?.name ?? '');
  const [adminPin, setAdminPin] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [lastCheck, setLastCheck] = useState(updateService.getLastCheck());
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (user?.storeId) {
      void userService.getStore(user.storeId).then((nextStore) => {
        setStore(nextStore);
        setStoreName(nextStore?.name ?? '');
      }).catch((storeError: unknown) => setError(storeError instanceof Error ? storeError.message : t('common.storeLoadFailed')));
    }
    void settingsService.getLanguage().then(setLanguage).catch((languageError: unknown) => {
      setError(languageError instanceof Error ? languageError.message : t('settings.languageFailed'));
    });
  }, [user?.storeId]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirmation) {
      setError('New passwords do not match.');
      return;
    }
    if (!user) return;
    try {
      await authService.changePassword(user.id, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice(t('settings.passwordChanged'));
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'Unable to change password.');
    }
  }

  async function saveStoreInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store) return;
    setError('');
    setNotice('');
    try {
      await userService.updateStoreInfo(store.id, { name: storeName });
      setNotice('Store information saved.');
    } catch (storeError) {
      setError(storeError instanceof Error ? storeError.message : 'Unable to save store information.');
    }
  }

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store) return;
    setError('');
    setNotice('');
    try {
      await userService.updateStorePin(store.id, adminPin);
      setAdminPin('');
      setNotice('Store admin PIN updated.');
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Unable to update the PIN.');
    }
  }

  async function changeLanguage(value: 'en') {
    try {
      await settingsService.setLanguage(value);
      setLanguage(value);
      setNotice(t('settings.englishOnly'));
    } catch (languageError) {
      setError(languageError instanceof Error ? languageError.message : t('settings.languageFailed'));
    }
  }

  async function checkForUpdates() {
    setChecking(true);
    setError('');
    setNotice('');
    try {
      const result = await updateService.checkForUpdates();
      setLastCheck(result.checkedAt);
      setUpdateResult(result.updateAvailable ? t('settings.updateAvailable') : t('settings.upToDate'));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to check for updates.');
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  const content = (
    <div className="flex flex-col gap-4">
      <header className="mb-1">
        <h1 className="font-display text-headline-lg text-on-surface">{t('settings.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">{user?.name}</p>
      </header>

      <form onSubmit={changePassword} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="lock_reset" className="text-primary" />{t('settings.password')}</h2>
        <label className="font-body text-label-md">{t('settings.currentPassword')}<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('settings.newPassword')}<input required minLength={6} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('settings.confirmPassword')}<input required minLength={6} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <Button type="submit" className="self-start">{t('settings.password')}</Button>
      </form>

      {user?.role === 'owner' && store && (
        <>
          <form onSubmit={(event) => { void saveStoreInfo(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md text-on-surface">{t('settings.storeInfo')}</h2>
            <label className="font-body text-label-md">{t('settings.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <p className="font-body text-body-sm text-outline">Store code: {store.code}</p>
            <Button type="submit" variant="secondary">{t('common.save')}</Button>
          </form>
          <form onSubmit={(event) => { void savePin(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md text-on-surface">{t('settings.adminPin')}</h2>
            <input aria-label={t('settings.adminPin')} required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" value={adminPin} onChange={(event) => setAdminPin(event.target.value)} placeholder="••••" className="h-12 rounded-lg bg-surface-container-low px-3 tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary" />
            <Button type="submit" variant="secondary">{t('common.save')}</Button>
          </form>
        </>
      )}

      <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="language" className="text-primary" />{t('settings.language')}</h2>
        <select value={language} onChange={(event) => { void changeLanguage(event.target.value as 'en'); }} className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md outline-none focus:ring-2 focus:ring-primary">
          <option value="en">{t('settings.englishOnly')}</option>
        </select>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="system_update" className="text-primary" />{t('settings.appUpdates')}</h2>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.currentVersion')}</span>
          <span className="font-semibold text-on-surface">v{updateService.getCurrentVersion()}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.lastCheck')}</span>
          <span className="text-right text-on-surface">{lastCheck ? new Date(lastCheck).toLocaleString() : t('settings.neverChecked')}</span>
        </div>
        <Button onClick={checkForUpdates} disabled={checking} variant="secondary" className="w-full">
          <MaterialIcon name={checking ? 'sync' : 'refresh'} className={`text-lg ${checking ? 'animate-spin' : ''}`} />
          {checking ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
        </Button>
        {updateResult && <p role="status" className="font-body text-body-sm text-on-surface-variant">{updateResult}</p>}
      </section>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
      <Button variant="danger" onClick={() => { void handleLogout(); }} className="w-full"><MaterialIcon name="logout" />{t('app.logOut')}</Button>
    </div>
  );

  if (user?.role === 'owner') return <WorkspaceLayout title={t('settings.title')} storeName={store?.name} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>;
  if (user?.role === 'super_admin') return <WorkspaceLayout title={t('settings.title')} links={adminWorkspaceLinks}>{content}</WorkspaceLayout>;
  return <div className="min-h-screen bg-surface px-4 pb-24 pt-5"><div className="mx-auto max-w-3xl">{content}</div><BottomNav /></div>;
}
