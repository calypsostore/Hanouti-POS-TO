import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { catalogService } from '../services/catalogService';
import { notificationService } from '../services/notificationService';
import { scheduleService } from '../services/scheduleService';
import { settingsService } from '../services/settingsService';
import { updateService } from '../services/updateService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { updateDisplaySettings, useDisplaySettings, type DisplayTheme } from '../lib/displaySettings';
import { t, type TranslationKey } from '../i18n/translations';
import { adminWorkspaceLinks, ownerWorkspaceLinks } from '../app/navigation';
import { DEFAULT_NOTIFICATION_PREFERENCES, resolveStoreSettings, type CatalogItemRecord, type CategoryRecord, type NotificationRecord, type NotificationType, type PositionRecord, type ScheduleShiftRecord, type SettlementTerms } from '../types/domain';

const notificationOptions: { type: NotificationType; label: string; description: string }[] = [
  { type: 'void_requested', label: 'Void request received', description: 'Notify the owner when staff request an order void.' },
  { type: 'void_approved', label: 'Void request approved', description: 'Notify staff when their void request is approved.' },
  { type: 'void_rejected', label: 'Void request rejected', description: 'Notify staff when their void request is rejected.' },
  { type: 'schedule_published', label: 'Schedule published', description: 'Notify staff when a schedule is published.' },
  { type: 'customer_credit_warning', label: 'Customer nearing credit limit', description: 'Alert when a customer reaches 80% of their credit limit.' },
  { type: 'customer_credit_limit', label: 'Customer credit limit reached', description: 'Alert when a customer reaches their credit limit.' },
  { type: 'customer_overdue', label: 'Customer tab overdue', description: 'Alert when a customer tab passes its settlement date.' },
  { type: 'stock_depleted', label: 'Stock depleted', description: 'Alert when tracked stock reaches zero.' },
  { type: 'item_86', label: 'Item marked 86', description: 'Alert when an item is manually marked out of stock.' },
  { type: 'low_stock', label: 'Low stock', description: 'Alert when tracked stock crosses its low-stock threshold.' },
  { type: 'shift_opened', label: 'Shift opened', description: 'Notify the owner when a staff shift opens.' },
  { type: 'shift_closed', label: 'Shift closed', description: 'Notify the owner when a staff shift closes.' },
  { type: 'cash_difference', label: 'Cash difference', description: 'Alert the owner when shift close has a cash difference.' },
  { type: 'cash_out_alert', label: 'Large cash withdrawal', description: 'Alert when a cash-out exceeds the configured threshold.' },
  { type: 'z_report_closed', label: 'Z report closed', description: 'Notify the owner when a Z report closes the business day.' },
  { type: 'app_update', label: 'New app version', description: 'Notify when a new app version is available.' },
  { type: 'subscription_expiring', label: 'Subscription expiring', description: 'Notify the owner seven days before subscription expiry.' },
];

interface StaffRuleDraft {
  maxQuantity: string;
  categoryIds: string[];
  itemIds: string[];
  compItemsEnabled: boolean;
}

interface HelpStep {
  icon: string;
  title: TranslationKey;
  body: TranslationKey;
}

const staffHelpSteps: HelpStep[] = [
  { icon: 'lock_open', title: 'help.openShift.title', body: 'help.openShift.body' },
  { icon: 'point_of_sale', title: 'help.takeOrder.title', body: 'help.takeOrder.body' },
  { icon: 'person_add', title: 'help.chargeTab.title', body: 'help.chargeTab.body' },
  { icon: 'payments', title: 'help.tabPayment.title', body: 'help.tabPayment.body' },
  { icon: 'lock', title: 'help.closeShift.title', body: 'help.closeShift.body' },
  { icon: 'undo', title: 'help.voidOrder.title', body: 'help.voidOrder.body' },
];

const ownerHelpSteps: HelpStep[] = [
  { icon: 'group_add', title: 'help.addStaff.title', body: 'help.addStaff.body' },
  { icon: 'inventory_2', title: 'help.addProducts.title', body: 'help.addProducts.body' },
  { icon: 'analytics', title: 'help.xReport.title', body: 'help.xReport.body' },
  { icon: 'summarize', title: 'help.zReport.title', body: 'help.zReport.body' },
];

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
  const displaySettings = useDisplaySettings();
  const storeId = user?.storeId;
  const userRole = user?.role;
  const logout = useAuthStore((state) => state.logout);
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [storeName, setStoreName] = useState(store?.name ?? '');
  const [dailySalesTarget, setDailySalesTarget] = useState('0.000');
  const [adminPin, setAdminPin] = useState('');
  const [staffAutoLockMinutes, setStaffAutoLockMinutes] = useState('5');
  const [cashOutAlertThreshold, setCashOutAlertThreshold] = useState('50.000');
  const [defaultSettlementTerms, setDefaultSettlementTerms] = useState<SettlementTerms>('monthly');
  const [notificationPreferences, setNotificationPreferences] = useState<Partial<Record<NotificationType, boolean>>>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [userNotificationPreferences, setUserNotificationPreferences] = useState<Partial<Record<NotificationType, boolean>>>({});
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [staffRuleDrafts, setStaffRuleDrafts] = useState<Record<string, StaffRuleDraft>>({});
  const [savingCreditPolicy, setSavingCreditPolicy] = useState(false);
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);
  const [savingAutoLock, setSavingAutoLock] = useState(false);
  const [savingCashOutThreshold, setSavingCashOutThreshold] = useState(false);
  const [savingSettlementTerms, setSavingSettlementTerms] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [lastCheck, setLastCheck] = useState(updateService.getLastCheck());
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState('');
  const [mySchedule, setMySchedule] = useState<ScheduleShiftRecord[]>([]);
  const [scheduleNotifications, setScheduleNotifications] = useState<NotificationRecord[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function saveDisplayPreference(changes: { theme?: DisplayTheme; largeButtons?: boolean }) {
    setError('');
    try {
      updateDisplaySettings(changes);
    } catch (displayError) {
      console.error('Unable to save display settings.', displayError);
      setError('Unable to save display settings. Please try again.');
    }
  }

  useEffect(() => {
    if (storeId) {
      const isOwner = userRole === 'owner';
      void Promise.all([
        userService.getStore(storeId),
        isOwner ? userService.listPositions(storeId) : Promise.resolve([]),
        isOwner ? catalogService.listCategories(storeId) : Promise.resolve([]),
        isOwner ? catalogService.listItems(storeId) : Promise.resolve([]),
      ]).then(([nextStore, nextPositions, nextCategories, nextItems]) => {
        setStore(nextStore);
        setStoreName(nextStore?.name ?? '');
        setDailySalesTarget(((nextStore?.dailySalesTargetMillimes ?? 0) / 1000).toFixed(3));
        setStaffAutoLockMinutes(String(nextStore?.staffAutoLockMinutes ?? 5));
        setCashOutAlertThreshold(((nextStore?.cashOutAlertThresholdMillimes ?? 50_000) / 1000).toFixed(3));
        const storeSettings = resolveStoreSettings(nextStore?.settings);
        setDefaultSettlementTerms(storeSettings.defaultSettlementTerms);
        setNotificationPreferences(storeSettings.notificationPreferences);
        setPositions(nextPositions);
        setCategories(nextCategories);
        setCatalogItems(nextItems);
        setStaffRuleDrafts(Object.fromEntries(nextPositions.map((position) => [position.id, {
          maxQuantity: String(position.maxStaffDrinkQuantityPerShift ?? 0),
          categoryIds: [...(position.selfServiceCategoryIds ?? [])],
          itemIds: [...(position.selfServiceItemIds ?? [])],
          compItemsEnabled: position.permissionIds.includes('comp_items'),
        }])));
      }).catch((storeError: unknown) => {
        console.error('Unable to load settings data.', storeError);
        setError(t('common.storeLoadFailed'));
      });
    }
    void settingsService.getLanguage().then(setLanguage).catch((languageError: unknown) => {
      console.error('Unable to load the language preference.', languageError);
      setError(t('settings.languageFailed'));
    });
  }, [storeId, userRole]);

  useEffect(() => {
    if (user?.role !== 'staff' || !user.storeId) return;
    let active = true;
    const staffStoreId = user.storeId;
    const staffId = user.id;
    const loadSchedule = () => {
      setScheduleLoading(true);
      setScheduleDate(localDateKey(new Date()));
      void Promise.all([
        scheduleService.listForStaff(staffStoreId, staffId),
        user ? notificationService.listFor(user) : Promise.resolve([]),
      ]).then(([shifts, notifications]) => {
        if (!active) return;
        setMySchedule(shifts);
        setScheduleNotifications(notifications);
      }).catch((scheduleError: unknown) => {
        console.error('Unable to load your schedule.', scheduleError);
        if (active) setError('Unable to load your schedule. Please try again.');
      }).finally(() => {
        if (active) setScheduleLoading(false);
      });
    };
    loadSchedule();
    window.addEventListener('focus', loadSchedule);
    return () => {
      active = false;
      window.removeEventListener('focus', loadSchedule);
    };
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'staff') return;
    let active = true;
    setPreferencesLoading(true);
    void Promise.all(notificationOptions.map(async ({ type }) =>
      [type, await notificationService.getPreference(user.id, type)] as const,
    )).then((entries) => {
      if (active) setUserNotificationPreferences(Object.fromEntries(entries));
    }).catch((preferenceError: unknown) => {
      console.error('Unable to load notification preferences.', preferenceError);
      if (active) setError('Unable to load notification preferences. Please try again.');
    }).finally(() => {
      if (active) setPreferencesLoading(false);
    });
    return () => { active = false; };
  }, [user]);

  async function saveStoreInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    try {
      setStore(await userService.updateStoreInfo(store.id, user.id, {
        name: storeName,
        dailySalesTargetMillimes: parseTndAmount(dailySalesTarget),
      }));
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

  async function saveDefaultSettlementTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingSettlementTerms(true);
    try {
      const updated = await userService.updateStoreSettings(store.id, user.id, { defaultSettlementTerms });
      setStore(updated);
      setNotice('Default customer settlement terms saved.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save default settlement terms.');
    } finally {
      setSavingSettlementTerms(false);
    }
  }

  async function changeNotificationPreference(type: NotificationType, enabled: boolean) {
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingNotifications(true);
    const nextPreferences = { ...notificationPreferences, [type]: enabled };
    try {
      const updated = await userService.updateStoreSettings(store.id, user.id, { notificationPreferences: nextPreferences });
      setStore(updated);
      setNotificationPreferences(resolveStoreSettings(updated.settings).notificationPreferences);
      setNotice('Notification preferences saved.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save notification preferences.');
    } finally {
      setSavingNotifications(false);
    }
  }

  async function changeUserNotificationPreference(type: NotificationType, enabled: boolean) {
    if (!user || user.role !== 'staff') return;
    setError('');
    setNotice('');
    setSavingNotifications(true);
    try {
      await notificationService.setPreference(user.id, type, enabled);
      setUserNotificationPreferences((current) => ({ ...current, [type]: enabled }));
      setNotice('Notification preferences saved on this device.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Unable to save notification preferences.');
    } finally {
      setSavingNotifications(false);
    }
  }

  function updateStaffRule(
    positionId: string,
    change: Partial<StaffRuleDraft>,
  ) {
    setStaffRuleDrafts((current) => ({
      ...current,
      [positionId]: { ...current[positionId], ...change },
    }));
  }

  async function saveStaffRules(position: PositionRecord) {
    const draft = staffRuleDrafts[position.id];
    if (!draft) return;
    setError('');
    setNotice('');
    try {
      const maxQuantity = Number(draft.maxQuantity);
      if (!draft.maxQuantity.trim() || !Number.isInteger(maxQuantity) || maxQuantity < 0) {
        throw new Error('Staff-item limit must be a non-negative whole number.');
      }
      const updated = await userService.updatePosition(position.id, {
        permissionIds: draft.compItemsEnabled
          ? [...new Set([...position.permissionIds, 'comp_items'])]
          : position.permissionIds.filter((permissionId) => permissionId !== 'comp_items'),
        maxStaffDrinkQuantityPerShift: maxQuantity,
        selfServiceCategoryIds: draft.categoryIds,
        selfServiceItemIds: draft.itemIds,
      });
      setPositions((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setNotice(`${position.name} staff-item rules saved.`);
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Unable to save staff-item rules.');
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

      <section aria-labelledby="display-settings-heading" className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div>
          <h2 id="display-settings-heading" className="font-display text-headline-md text-on-surface">Display</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Choose how 7anouti-POS looks on this device.</p>
        </div>
        <label htmlFor="display-theme" className="font-body text-label-md text-on-surface">Theme</label>
        <select
          id="display-theme"
          value={displaySettings.theme}
          onChange={(event) => {
            const theme = event.currentTarget.value;
            if (theme === 'light' || theme === 'dark' || theme === 'system') {
              saveDisplayPreference({ theme });
            }
          }}
          className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={displaySettings.largeButtons}
            onChange={(event) => saveDisplayPreference({ largeButtons: event.currentTarget.checked })}
            className="h-5 w-5 accent-primary"
          />
          <span>
            <span className="block">Large buttons</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Use larger product cards, quantity controls and action buttons in the POS.</span>
          </span>
        </label>
      </section>

      {user?.role === 'staff' && (
        <>
          <section aria-labelledby="staff-notification-settings-heading" className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 id="staff-notification-settings-heading" className="font-display text-headline-md text-on-surface">Notifications</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">These preferences are saved on this device.</p>
            </div>
            {preferencesLoading ? <ListSkeleton rows={3} label="Loading notification preferences" /> : notificationOptions.filter(({ type }) => [
              'void_approved', 'void_rejected', 'schedule_published', 'stock_depleted', 'item_86', 'app_update',
            ].includes(type)).map((option) => (
              <label key={option.type} className="flex min-h-14 items-start gap-3 rounded-xl bg-surface-container-low p-3">
                <input
                  type="checkbox"
                  checked={userNotificationPreferences[option.type] ?? true}
                  disabled={savingNotifications}
                  onChange={(event) => { void changeUserNotificationPreference(option.type, event.target.checked); }}
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                />
                <span>
                  <span className="block font-body text-label-md text-on-surface">{option.label}</span>
                  <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{option.description}</span>
                </span>
              </label>
            ))}
          </section>
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="calendar_month" className="text-primary" />My schedule</h2>
            {scheduleLoading ? <ListSkeleton rows={2} label="Loading your schedule" /> : upcomingSchedule.length > 0 ? (
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
                    <p className="font-body text-body-sm text-on-warning-container">{notification.body}</p>
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
          <section aria-labelledby="store-settings-heading" className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 id="store-settings-heading" className="font-display text-headline-md text-on-surface">Store</h2>
            <form onSubmit={(event) => { void saveStoreInfo(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md">{t('settings.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <label className="font-body text-label-md">Store code<input readOnly value={store.code} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 text-on-surface-variant" /></label>
              <label className="font-body text-label-md">{t('settings.dailySalesTarget')} (DT)<input required type="number" min="0" step="0.001" inputMode="decimal" value={dailySalesTarget} onChange={(event) => setDailySalesTarget(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <p className="-mt-2 font-body text-body-sm text-outline">{t('settings.dailySalesTargetHelp')}</p>
              <Button type="submit" variant="secondary">{t('common.save')}</Button>
            </form>
          </section>

          <section aria-labelledby="security-settings-heading" className="flex flex-col gap-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 id="security-settings-heading" className="font-display text-headline-md text-on-surface">Security</h2>
            {store.pinMustChange && <p role="alert" className="flex items-center gap-2 rounded-xl bg-warning-container p-3 font-body text-body-md text-on-warning-container"><MaterialIcon name="warning" />Set your admin PIN</p>}
            <form onSubmit={(event) => { void savePin(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md">{t('settings.adminPin')}<input aria-label={t('settings.adminPin')} required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" value={adminPin} onChange={(event) => setAdminPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary" /></label>
              <Keypad onPress={(digit) => setAdminPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setAdminPin('')} onBackspace={() => setAdminPin((current) => current.slice(0, -1))} />
              <Button type="submit" variant="secondary">{t('common.save')}</Button>
            </form>
            <form onSubmit={(event) => { void saveAutoLockTimeout(event); }} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
              <div>
                <h3 className="font-body text-label-lg text-on-surface">Staff auto-lock</h3>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">Lock staff sessions after inactivity. Default is 5 minutes.</p>
              </div>
              <label htmlFor="staff-auto-lock" className="font-body text-label-md text-on-surface">Minutes (1–60)</label>
              <input id="staff-auto-lock" type="number" min={1} max={60} step={1} required value={staffAutoLockMinutes} onChange={(event) => setStaffAutoLockMinutes(event.target.value)} className="h-12 rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
              <Button type="submit" variant="secondary" disabled={savingAutoLock}>{savingAutoLock ? 'Saving…' : t('common.save')}</Button>
            </form>
            <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
              <div>
                <h3 className="font-body text-label-lg text-on-surface">POS payment methods</h3>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">Payment is collected outside the app; these options track the method on each order. Both are off by default.</p>
              </div>
              <label className="flex min-h-12 items-center gap-3 font-body text-label-md text-on-surface">
                <input type="checkbox" checked={store.allowCardPayments ?? false} disabled={savingPaymentSettings} onChange={(event) => { void changePaymentMethodSetting('card', event.target.checked); }} className="h-5 w-5 accent-primary" />
                Show Card at POS
              </label>
              <label className="flex min-h-12 items-center gap-3 font-body text-label-md text-on-surface">
                <input type="checkbox" checked={store.allowOtherPayments ?? false} disabled={savingPaymentSettings} onChange={(event) => { void changePaymentMethodSetting('other', event.target.checked); }} className="h-5 w-5 accent-primary" />
                Show Other at POS
              </label>
            </div>
          </section>

          <section aria-labelledby="customer-settings-heading" className="flex flex-col gap-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 id="customer-settings-heading" className="font-display text-headline-md text-on-surface">Customers</h2>
            <label className="flex min-h-12 items-start gap-3 rounded-xl bg-surface-container-low p-3">
              <input type="checkbox" checked={store.allowCustomerCreditBalance ?? false} disabled={savingCreditPolicy} onChange={(event) => { void changeCustomerCreditBalance(event.target.checked); }} className="mt-1 h-5 w-5 accent-primary" />
              <span>
                <span className="block font-body text-label-md text-on-surface">Allow customer credit balance</span>
                <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Allow customer payments greater than the amount due. Off by default.</span>
              </span>
            </label>
            <form onSubmit={(event) => { void saveDefaultSettlementTerms(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md text-on-surface">Default settlement terms for new customers
                <select value={defaultSettlementTerms} onChange={(event) => setDefaultSettlementTerms(event.target.value as SettlementTerms)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="anytime">Anytime</option>
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={savingSettlementTerms}>{savingSettlementTerms ? 'Saving…' : t('common.save')}</Button>
            </form>
          </section>

          <section aria-labelledby="staff-rules-heading" className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 id="staff-rules-heading" className="font-display text-headline-md text-on-surface">Staff rules</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">Configure staff-drink comp limits and eligible items for each position.</p>
            </div>
            {positions.map((position) => {
              const draft = staffRuleDrafts[position.id];
              if (!draft) return null;
              return (
                <article key={position.id} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
                  <h3 className="font-body text-label-lg text-on-surface">{position.name}</h3>
                  <label className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-label-md text-on-surface">
                    <input type="checkbox" checked={draft.compItemsEnabled} onChange={(event) => updateStaffRule(position.id, { compItemsEnabled: event.target.checked })} className="h-5 w-5 accent-primary" />
                    Allow this position to comp items
                  </label>
                  <label className="font-body text-label-md text-on-surface">Maximum staff-item comps per shift
                    <input type="number" min="0" step="1" required value={draft.maxQuantity} onChange={(event) => updateStaffRule(position.id, { maxQuantity: event.target.value })} className="mt-1 h-12 w-full rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
                  </label>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 font-body text-label-md text-on-surface">Allowed categories</legend>
                    {categories.map((category) => (
                      <label key={category.id} className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-body-sm text-on-surface">
                        <input type="checkbox" checked={draft.categoryIds.includes(category.id)} onChange={() => updateStaffRule(position.id, {
                          categoryIds: draft.categoryIds.includes(category.id)
                            ? draft.categoryIds.filter((id) => id !== category.id)
                            : [...draft.categoryIds, category.id],
                        })} className="h-5 w-5 accent-primary" />
                        {category.name}
                      </label>
                    ))}
                    {categories.length === 0 && <p className="font-body text-body-sm text-outline">No categories available.</p>}
                  </fieldset>
                  <fieldset className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                    <legend className="mb-1 font-body text-label-md text-on-surface">Allowed items</legend>
                    {catalogItems.map((item) => (
                      <label key={item.id} className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-body-sm text-on-surface">
                        <input type="checkbox" checked={draft.itemIds.includes(item.id)} onChange={() => updateStaffRule(position.id, {
                          itemIds: draft.itemIds.includes(item.id)
                            ? draft.itemIds.filter((id) => id !== item.id)
                            : [...draft.itemIds, item.id],
                        })} className="h-5 w-5 accent-primary" />
                        {item.name}
                      </label>
                    ))}
                    {catalogItems.length === 0 && <p className="font-body text-body-sm text-outline">No active items available.</p>}
                  </fieldset>
                  <Button variant="secondary" className="min-h-12 w-full" onClick={() => { void saveStaffRules(position); }}>Save {position.name} rules</Button>
                </article>
              );
            })}
            {positions.length === 0 && <p className="rounded-xl bg-surface-container-low p-3 font-body text-body-sm text-outline">Create a staff position before setting staff-item rules.</p>}
          </section>

          <section aria-labelledby="notification-settings-heading" className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div>
              <h2 id="notification-settings-heading" className="font-display text-headline-md text-on-surface">Notifications</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">Choose which notification types are created. All are enabled by default.</p>
            </div>
            {notificationOptions.map((option) => (
              <label key={option.type} className="flex min-h-14 items-start gap-3 rounded-xl bg-surface-container-low p-3">
                <input
                  type="checkbox"
                  checked={notificationPreferences[option.type] ?? true}
                  disabled={savingNotifications}
                  onChange={(event) => { void changeNotificationPreference(option.type, event.target.checked); }}
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                />
                <span>
                  <span className="block font-body text-label-md text-on-surface">{option.label}</span>
                  <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{option.description}</span>
                </span>
              </label>
            ))}
            <form onSubmit={(event) => { void saveCashOutAlertThreshold(event); }} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
              <div>
                <h3 className="font-body text-label-lg text-on-surface">Large cash-out threshold</h3>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">Notify the owner when a cash-out is greater than this amount. Set to 0 to alert for every cash-out. Default: 50.000 DT.</p>
              </div>
              <label htmlFor="cash-out-alert-threshold" className="font-body text-label-md text-on-surface">Alert threshold (DT)</label>
              <input id="cash-out-alert-threshold" type="number" min="0" step="0.001" inputMode="decimal" required value={cashOutAlertThreshold} onChange={(event) => setCashOutAlertThreshold(event.target.value)} className="h-12 rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
              <Button type="submit" variant="secondary" disabled={savingCashOutThreshold}>{savingCashOutThreshold ? 'Saving…' : t('common.save')}</Button>
            </form>
          </section>
        </>
      )}

      <section aria-labelledby="help-section-heading" className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 id="help-section-heading" className="flex items-center gap-2 font-display text-headline-md text-on-surface">
          <MaterialIcon name="help" className="text-primary" />{t('settings.help')}
        </h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('help.intro')}</p>
        <HelpGuide title={t('help.staff')} steps={staffHelpSteps} />
        {user?.role === 'owner' && <HelpGuide title={t('help.owner')} steps={ownerHelpSteps} />}
      </section>

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

function HelpGuide({ title, steps }: { title: string; steps: HelpStep[] }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 font-body text-label-lg text-on-surface">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((step, index) => (
          <article key={step.title} className="flex items-start gap-3 rounded-xl bg-surface-container-low p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary">
              <MaterialIcon name={step.icon} className="text-lg" />
            </span>
            <div className="min-w-0">
              <p className="font-body text-label-md text-on-surface">
                <span className="mr-1 text-outline">{index + 1}.</span>{t(step.title)}
              </p>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t(step.body)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
