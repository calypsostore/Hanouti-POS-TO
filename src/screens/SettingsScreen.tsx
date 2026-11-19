import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { notificationService } from '../services/notificationService';
import { scheduleService } from '../services/scheduleService';
import { settingsService } from '../services/settingsService';
import { updateService } from '../services/updateService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { t } from '../i18n/translations';
import { adminWorkspaceLinks, ownerWorkspaceLinks } from '../app/navigation';
import type { NotificationRecord, ScheduleShiftRecord } from '../types/domain';

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseTndAmount(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  const millimes = Math.round(parsed * 1000);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(millimes)) {
    throw new Error('Enter a non-negative cash amount.');
  }
  return millimes;
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [storeName, setStoreName] = useState(store?.name ?? '');
  const [adminPin, setAdminPin] = useState('');
  const [staffAutoLockMinutes, setStaffAutoLockMinutes] = useState('5');
  const [cashOutAlertThreshold, setCashOutAlertThreshold] = useState('50.000');
  const [savingCreditPolicy, setSavingCreditPolicy] = useState(false);
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);
  const [savingAutoLock, setSavingAutoLock] = useState(false);
  const [savingCashOutThreshold, setSavingCashOutThreshold] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [lastCheck, setLastCheck] = useState(updateService.getLastCheck());
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState('');
  const [mySchedule, setMySchedule] = useState<ScheduleShiftRecord[]>([]);
  const [scheduleNotifications, setScheduleNotifications] = useState<NotificationRecord[]>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (user?.storeId) {
      void userService.getStore(user.storeId).then((nextStore) => {
        setStore(nextStore);
        setStoreName(nextStore?.name ?? '');
        setStaffAutoLockMinutes(String(nextStore?.staffAutoLockMinutes ?? 5));
        setCashOutAlertThreshold(((nextStore?.cashOutAlertThresholdMillimes ?? 50_000) / 1000).toFixed(3));
      }).catch((storeError: unknown) => setError(storeError instanceof Error ? storeError.message : t('common.storeLoadFailed')));
    }
    void settingsService.getLanguage().then(setLanguage).catch((languageError: unknown) => {
      setError(languageError instanceof Error ? languageError.message : t('settings.languageFailed'));
    });
  }, [user?.storeId]);

  useEffect(() => {
    if (user?.role !== 'staff' || !user.storeId) return;
    let active = true;
    const staffStoreId = user.storeId;
    const staffId = user.id;
    const loadSchedule = () => {
      setScheduleDate(localDateKey(new Date()));
      void Promise.all([
        scheduleService.listForStaff(staffStoreId, staffId),
        notificationService.listForStaff(staffStoreId, staffId),
      ]).then(([shifts, notifications]) => {
        if (!active) return;
        setMySchedule(shifts);
        setScheduleNotifications(notifications);
      }).catch((scheduleError: unknown) => {
        if (active) setError(scheduleError instanceof Error ? scheduleError.message : 'Unable to load your schedule.');
      });
    };
    loadSchedule();
    window.addEventListener('focus', loadSchedule);
    return () => {
      active = false;
      window.removeEventListener('focus', loadSchedule);
    };
  }, [user?.id, user?.role, user?.storeId]);

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
      setStore(await userService.updateStorePin(store.id, adminPin));
      setAdminPin('');
      setNotice('Store admin PIN updated.');
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Unable to update the PIN.');
    }
  }

  async function changeCustomerCreditBalance(allowed: boolean) {
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingCreditPolicy(true);
    try {
      setStore(await userService.updateCustomerCreditBalanceSetting(store.id, user.id, allowed));
      setNotice(allowed ? 'Customer credit balances enabled.' : 'Customer credit balances disabled.');
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : 'Unable to save the customer credit setting.');
    } finally {
      setSavingCreditPolicy(false);
    }
  }

  async function changePaymentMethodSetting(method: 'card' | 'other', enabled: boolean) {
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingPaymentSettings(true);
    try {
      const changes = method === 'card' ? { allowCardPayments: enabled } : { allowOtherPayments: enabled };
      setStore(await userService.updateStorePaymentSettings(store.id, user.id, changes));
      setNotice('POS payment methods saved.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save POS payment methods.');
    } finally {
      setSavingPaymentSettings(false);
    }
  }

  async function saveAutoLockTimeout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingAutoLock(true);
    try {
      const minutes = Number(staffAutoLockMinutes);
      setStore(await userService.updateStoreAutoLockMinutes(store.id, user.id, minutes));
      setNotice('Staff auto-lock timeout saved.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save the auto-lock timeout.');
    } finally {
      setSavingAutoLock(false);
    }
  }

  async function saveCashOutAlertThreshold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingCashOutThreshold(true);
    try {
      setStore(await userService.updateCashOutAlertThreshold(
        store.id,
        user.id,
        parseTndAmount(cashOutAlertThreshold),
      ));
      setNotice('Cash-out alert threshold saved.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save the cash-out alert threshold.');
    } finally {
      setSavingCashOutThreshold(false);
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

  const upcomingSchedule = mySchedule.filter((shift) => shift.publishedAt && scheduleDate && shift.date >= scheduleDate);
  const content = (
    <div className="flex flex-col gap-4">
      <header className="mb-1">
        <h1 className="font-display text-headline-lg text-on-surface">{t('settings.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">{user?.name}</p>
      </header>

      {user?.role === 'staff' && (
        <>
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="calendar_month" className="text-primary" />My schedule</h2>
            {upcomingSchedule.length > 0 ? (
              <div className="flex flex-col gap-2">
                {upcomingSchedule.map((shift) => (
                  <article key={shift.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
                    <div className="min-w-0">
                      <p className="font-body text-label-md text-on-surface">{new Date(`${shift.date}T00:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                      {shift.note && <p className="mt-0.5 truncate font-body text-body-sm text-outline">{shift.note}</p>}
                    </div>
                    <p className="shrink-0 font-body text-label-md tabular-nums text-primary">{shift.startTime}–{shift.endTime}</p>
                  </article>
                ))}
              </div>
            ) : <p className="font-body text-body-sm text-outline">No published shifts coming up.</p>}
          </section>

          {scheduleNotifications.length > 0 && (
            <section className="rounded-2xl bg-warning-container p-4">
              <h2 className="mb-2 flex items-center gap-2 font-display text-headline-sm text-on-warning-container"><MaterialIcon name="notifications_active" />Notifications</h2>
              <div className="flex flex-col gap-2">
                {scheduleNotifications.slice(0, 3).map((notification) => (
                  <article key={notification.id}>
                    <p className="font-body text-label-md text-on-warning-container">{notification.title}</p>
                    <p className="font-body text-body-sm text-on-warning-container">{notification.message}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <ChangePasswordForm onError={setError} onNotice={setNotice} />

      {user?.role === 'owner' && store && (
        <>
          <form onSubmit={(event) => { void saveStoreInfo(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="font-display text-headline-md text-on-surface">{t('settings.storeInfo')}</h2>
            <label className="font-body text-label-md">{t('settings.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <p className="font-body text-body-sm text-outline">Store code: {store.code}</p>
            <Button type="submit" variant="secondary">{t('common.save')}</Button>
          </form>
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={store.allowCustomerCreditBalance ?? false}
                disabled={savingCreditPolicy}
                onChange={(event) => { void changeCustomerCreditBalance(event.target.checked); }}
                className="mt-1 h-5 w-5 accent-primary"
              />
              <span>
                <span className="block font-display text-headline-sm text-on-surface">Allow customer credit balance</span>
                <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Allow customer payments greater than the amount due. The extra amount is recorded as customer credit.</span>
              </span>
            </label>
          </section>
          <section className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">POS payment methods</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">Payment is still collected outside the app; these options only track the method on each order.</p>
            </div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={store.allowCardPayments ?? false}
                disabled={savingPaymentSettings}
                onChange={(event) => { void changePaymentMethodSetting('card', event.target.checked); }}
                className="mt-1 h-5 w-5 accent-primary"
              />
              <span className="font-body text-label-md text-on-surface">Show Card at POS</span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={store.allowOtherPayments ?? false}
                disabled={savingPaymentSettings}
                onChange={(event) => { void changePaymentMethodSetting('other', event.target.checked); }}
                className="mt-1 h-5 w-5 accent-primary"
              />
              <span className="font-body text-label-md text-on-surface">Show Other at POS</span>
            </label>
          </section>
          <form onSubmit={(event) => { void saveAutoLockTimeout(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">Staff auto-lock</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">Lock staff sessions after inactivity. Default is 5 minutes.</p>
            </div>
            <label htmlFor="staff-auto-lock" className="font-body text-label-md text-on-surface">Minutes (1–60)</label>
            <input
              id="staff-auto-lock"
              type="number"
              min={1}
              max={60}
              step={1}
              required
              value={staffAutoLockMinutes}
              onChange={(event) => setStaffAutoLockMinutes(event.target.value)}
              className="h-12 rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" variant="secondary" disabled={savingAutoLock}>{savingAutoLock ? 'Saving…' : t('common.save')}</Button>
          </form>
          <form onSubmit={(event) => { void saveCashOutAlertThreshold(event); }} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">Large cash-out alerts</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">Notify the owner when a cash-out is greater than this amount. Set to 0 to alert for every cash-out. Default: 50.000 DT.</p>
            </div>
            <label htmlFor="cash-out-alert-threshold" className="font-body text-label-md text-on-surface">Alert threshold (TND)</label>
            <input
              id="cash-out-alert-threshold"
              inputMode="decimal"
              required
              value={cashOutAlertThreshold}
              onChange={(event) => setCashOutAlertThreshold(event.target.value)}
              className="h-12 rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" variant="secondary" disabled={savingCashOutThreshold}>{savingCashOutThreshold ? 'Saving…' : t('common.save')}</Button>
          </form>
          {store.pinMustChange && <p role="alert" className="flex items-center gap-2 rounded-xl bg-warning-container p-3 font-body text-body-md text-on-warning-container"><MaterialIcon name="warning" />Set your admin PIN</p>}
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
