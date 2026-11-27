import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { ChangePersonalPinForm } from '../components/ChangePersonalPinForm';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { PermissionsSettingsCard } from '../components/PermissionsSettingsCard';
import { ReceiptDocumentView } from '../components/ReceiptDocumentView';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { LogoPicker } from '../components/LogoPicker';
import { DinarInput } from '../components/DinarInput';
import { ItemLogo } from '../components/ItemLogo';
import { PageContainer } from '../components/layout';
import { catalogService } from '../services/catalogService';
import { notificationService } from '../services/notificationService';
import { scheduleService } from '../services/scheduleService';
import { settingsService, type AppLanguage } from '../services/settingsService';
import { updateService, type UpdateCheckResult } from '../services/updateService';
import { userService } from '../services/userService';
import { buildReportDocument } from '../services/reportDocument';
import { buildTicketDocument } from '../services/ticketDocument';
import { downloadThermalPdf, printOrSharePdf, shareThermalPdf } from '../services/receiptExport';
import { useAuthStore } from '../stores/authStore';
import { parseNonNegativeMillimes } from '../lib/millimes';
import { t, type TranslationKey } from '../i18n/translations';
import { getLanguage, localizeErrorMessage, subscribeToLanguage } from '../i18n';
import { isLanguageCode, LANGUAGE_OPTIONS } from '../i18n/languageConfig';
import { adminWorkspaceLinks, ownerWorkspaceLinks } from '../app/navigation';
import { DEFAULT_NOTIFICATION_PREFERENCES, resolveStoreSettings, type CatalogItemRecord, type CategoryRecord, type NotificationRecord, type NotificationType, type OrderRecord, type PositionRecord, type ReportRecord, type ScheduleShiftRecord, type SettlementTerms, type StoreType } from '../types/domain';
import { getStoreLogoGroups } from '../data/logoCatalog';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { SettingsGlassSection } from '../components/settings/SettingsGlassSection';
import { applyStoreAppearance } from '../lib/storeAppearance';
import type { StoreAppearance } from '../theme/themeRegistry';
import { NotificationSoundSettings } from '../components/NotificationSoundSettings';
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  getNotificationSoundPreferences,
  playNotificationSound,
  saveNotificationSoundPreferences,
  type NotificationSoundChoice,
  type NotificationSoundId,
  type NotificationSoundPreferences,
  type NotificationSoundPurpose,
} from '../services/notificationSounds';

const notificationOptions: { type: NotificationType; label: TranslationKey; description: TranslationKey }[] = [
  { type: 'void_requested', label: 'settings.notificationVoidRequested', description: 'settings.notificationVoidRequestedDescription' },
  { type: 'void_approved', label: 'settings.notificationVoidApproved', description: 'settings.notificationVoidApprovedDescription' },
  { type: 'void_rejected', label: 'settings.notificationVoidRejected', description: 'settings.notificationVoidRejectedDescription' },
  { type: 'schedule_published', label: 'settings.notificationSchedulePublished', description: 'settings.notificationSchedulePublishedDescription' },
  { type: 'customer_credit_warning', label: 'settings.notificationCustomerCreditWarning', description: 'settings.notificationCustomerCreditWarningDescription' },
  { type: 'customer_credit_limit', label: 'settings.notificationCustomerCreditLimit', description: 'settings.notificationCustomerCreditLimitDescription' },
  { type: 'customer_overdue', label: 'settings.notificationCustomerOverdue', description: 'settings.notificationCustomerOverdueDescription' },
  { type: 'stock_depleted', label: 'settings.notificationStockDepleted', description: 'settings.notificationStockDepletedDescription' },
  { type: 'item_86', label: 'settings.notificationItem86', description: 'settings.notificationItem86Description' },
  { type: 'low_stock', label: 'settings.notificationLowStock', description: 'settings.notificationLowStockDescription' },
  { type: 'shift_opened', label: 'settings.notificationShiftOpened', description: 'settings.notificationShiftOpenedDescription' },
  { type: 'shift_closed', label: 'settings.notificationShiftClosed', description: 'settings.notificationShiftClosedDescription' },
  { type: 'cash_difference', label: 'settings.notificationCashDifference', description: 'settings.notificationCashDifferenceDescription' },
  { type: 'cash_out_alert', label: 'settings.notificationCashOutAlert', description: 'settings.notificationCashOutAlertDescription' },
  { type: 'z_report_closed', label: 'settings.notificationZReportClosed', description: 'settings.notificationZReportClosedDescription' },
  { type: 'app_update', label: 'settings.notificationAppUpdate', description: 'settings.notificationAppUpdateDescription' },
  { type: 'subscription_expiring', label: 'settings.notificationSubscriptionExpiring', description: 'settings.notificationSubscriptionExpiringDescription' },
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

function parseMillimesAmount(value: string): number {
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined) throw new Error(t('settings.validAmount'));
  return millimes;
}

function makeSampleOrder(storeId: string): OrderRecord {
  return {
    id: 'ticket-preview',
    number: 1001,
    storeId,
    staffId: 'staff-preview',
    staffName: t('settings.sampleCashier'),
    shiftId: 'shift-preview',
    status: 'done',
    paymentMethod: 'cash',
    items: [
      { itemId: 'espresso-preview', categoryId: 'drinks', categoryName: t('settings.sampleCoffee'), name: t('settings.sampleEspresso'), quantity: 2, unitPriceMillimes: 2500, lineTotalMillimes: 5000, modifiers: [] },
      { itemId: 'latte-preview', categoryId: 'drinks', categoryName: t('settings.sampleCoffee'), name: t('settings.sampleLatte'), quantity: 1, unitPriceMillimes: 3500, lineTotalMillimes: 3500, modifiers: [t('settings.sampleOatMilk')] },
    ],
    totalMillimes: 8500,
    createdAt: new Date().toISOString(),
  };
}

function makeSampleReport(type: 'X' | 'Z'): ReportRecord {
  const createdAt = new Date().toISOString();
  const closed = type === 'Z';
  return {
    id: `preview-${type.toLowerCase()}`,
    storeId: 'preview-store',
    type,
    businessDate: localDateKey(new Date()),
    createdAt,
    salesMillimes: 8500,
    salesCollectedMillimes: 7500,
    expensesMillimes: 1200,
    netProfitMillimes: 6300,
    grossMillimes: 8500,
    netMillimes: 8500,
    orderCount: 3,
    cashDifferenceMillimes: closed ? -200 : 0,
    zNumber: closed ? 12 : undefined,
    reportNumber: closed ? 'Z-000012' : 'X-000018',
    dayOpenedAt: createdAt,
    dayClosedAt: closed ? createdAt : undefined,
    periodFrom: createdAt,
    periodTo: createdAt,
    generatedBy: t('settings.sampleOwner'),
    firstTicketNumber: 1001,
    lastTicketNumber: 1003,
    salesByCategory: [
      { categoryId: 'drinks', name: t('settings.sampleCoffee'), quantity: 3, totalMillimes: 8500 },
    ],
    itemsSold: [
      { itemId: 'espresso-preview', name: t('settings.sampleEspresso'), quantity: 2, unitPriceMillimes: 2500, totalMillimes: 5000, categoryId: 'drinks', categoryName: t('settings.sampleCoffee') },
      { itemId: 'latte-preview', name: t('settings.sampleLatte'), quantity: 1, unitPriceMillimes: 3500, totalMillimes: 3500, categoryId: 'drinks', categoryName: t('settings.sampleCoffee') },
    ],
    paymentSplit: { cash: 5000, card: 2000, other: 0, tab: 1500 },
    cashSalesMillimes: 5000,
    tabSalesMillimes: 1500,
    tabPaymentsReceivedMillimes: 500,
    cashFloatMillimes: 10000,
    cashInMillimes: 2000,
    cashOutMillimes: 1500,
    cashMovements: [
      { shiftId: 'shift-preview', staffName: t('settings.sampleCashier'), kind: 'in', reason: 'change', amountMillimes: 2000, createdAt },
      { shiftId: 'shift-preview', staffName: t('settings.sampleCashier'), kind: 'out', reason: 'expense', amountMillimes: 1500, createdAt },
    ],
    totalExpectedCashMillimes: 16000,
    totalCountedMillimes: 15800,
    totalDifferenceMillimes: -200,
    countedCashMillimes: closed ? 15800 : undefined,
    cashDifference: closed ? -200 : undefined,
    pinVerified: closed,
    shifts: [{
      shiftId: 'shift-preview',
      staffName: t('settings.sampleCashier'),
      orderCount: 3,
      status: 'closed',
      openedAt: createdAt,
      closedAt: createdAt,
      startingCashMillimes: 10000,
      cashSalesMillimes: 5000,
      cardSalesMillimes: 2000,
      tabSalesMillimes: 1500,
      tabPaymentsMillimes: 500,
      cashInMillimes: 2000,
      cashOutMillimes: 1500,
      expectedCashMillimes: 16000,
      countedCashMillimes: 15800,
      differenceMillimes: -200,
      forceClosedByOwner: false,
    }],
    employeeBreakdown: [{ staffId: 'staff-preview', name: t('settings.sampleCashier'), orderCount: 3, salesMillimes: 8500 }],
    voids: {
      count: 1,
      totalMillimes: 1200,
      orders: [{ ticketNumber: 1000, reason: t('settings.sampleVoid'), totalMillimes: 1200, approvedBy: t('settings.sampleOwner') }],
    },
    expenseDetails: [{
      expenseId: 'expense-preview',
      category: 'supplier',
      amountMillimes: 1200,
      paidMillimes: 800,
      date: localDateKey(new Date()),
      supplierId: 'supplier-preview',
      note: t('settings.sampleSupplies'),
      createdBy: t('settings.sampleOwner'),
    }],
    customerTabs: [{
      customerId: 'customer-preview',
      customerName: t('settings.sampleCustomer'),
      issuedMillimes: 1500,
      paymentsMillimes: 500,
      outstandingMillimes: 1000,
    }],
    tabsIssuedMillimes: 1500,
    tabsSettledMillimes: 500,
    tabsOutstandingMillimes: 1000,
    comps: {
      count: 1,
      quantity: 1,
      totalMillimes: 2500,
      records: [{
        staffName: t('settings.sampleCashier'),
        itemName: t('settings.sampleCoffee'),
        quantity: 1,
        valueMillimes: 2500,
        reason: 'staff_drink',
        note: t('settings.sampleComp'),
        createdAt,
      }],
    },
  };
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const updateOwnerProfile = useAuthStore((state) => state.updateOwnerProfile);
  const storeId = user?.storeId;
  const userRole = user?.role;
  const settingsSections: Array<{ id: string; title: TranslationKey; description: TranslationKey; icon: string }> = userRole === 'owner'
    ? [
        { id: 'display', title: 'settings.theme', description: 'settings.sharedAppearanceDescription', icon: 'palette' },
        { id: 'store', title: 'settings.storeProfile', description: 'settings.storeProfileDescription', icon: 'storefront' },
        { id: 'receipts', title: 'settings.receiptsReports', description: 'settings.receiptsReportsDescription', icon: 'receipt_long' },
        { id: 'security', title: 'settings.securityTitle', description: 'settings.securityDescription', icon: 'shield_lock' },
        { id: 'customers', title: 'settings.customers', description: 'settings.customersDescription', icon: 'groups' },
        { id: 'staff', title: 'settings.staffRules', description: 'settings.staffRulesDescription', icon: 'badge' },
        { id: 'notifications', title: 'nav.notifications', description: 'settings.notificationsDescription', icon: 'notifications' },
        { id: 'help', title: 'settings.help', description: 'settings.helpDescription', icon: 'help' },
        { id: 'language', title: 'settings.language', description: 'settings.languageDescription', icon: 'language' },
        { id: 'permissions', title: 'settings.permissions', description: 'settings.permissionsDescription', icon: 'lock_open' },
        { id: 'updates', title: 'settings.appUpdates', description: 'settings.appUpdatesDescription', icon: 'system_update' },
      ]
    : userRole === 'staff'
      ? [
          { id: 'display', title: 'settings.theme', description: 'settings.sharedAppearanceDescription', icon: 'palette' },
          { id: 'security', title: 'settings.securityTitle', description: 'settings.passwordDescription', icon: 'shield_lock' },
          { id: 'notifications', title: 'settings.notificationsAndSchedule', description: 'settings.scheduleDescription', icon: 'notifications' },
          { id: 'help', title: 'settings.help', description: 'settings.helpDescription', icon: 'help' },
          { id: 'language', title: 'settings.language', description: 'settings.languageDescription', icon: 'language' },
          { id: 'permissions', title: 'settings.permissions', description: 'settings.permissionsDescription', icon: 'lock_open' },
          { id: 'updates', title: 'settings.appUpdates', description: 'settings.appUpdatesDescription', icon: 'system_update' },
        ]
      : [
          { id: 'display', title: 'settings.theme', description: 'settings.sharedAppearanceDescription', icon: 'palette' },
          { id: 'security', title: 'settings.securityTitle', description: 'settings.accountDescription', icon: 'shield_lock' },
          { id: 'notifications', title: 'nav.notifications', description: 'settings.notificationSoundsDescription', icon: 'notifications' },
          { id: 'help', title: 'settings.help', description: 'settings.helpDescription', icon: 'help' },
          { id: 'language', title: 'settings.language', description: 'settings.languageDescription', icon: 'language' },
          { id: 'permissions', title: 'settings.permissions', description: 'settings.permissionsDescription', icon: 'lock_open' },
          { id: 'updates', title: 'settings.appUpdates', description: 'settings.appUpdatesDescription', icon: 'system_update' },
        ];
  const activeSection = settingsSections.find((section) => section.id === searchParams.get('section'));
  const logout = useAuthStore((state) => state.logout);
  const device = useAuthStore((state) => state.device);
  const deviceBoundSession = Boolean(device && user);
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  const [storeName, setStoreName] = useState(store?.name ?? '');
  const [ownerName, setOwnerName] = useState(user?.name ?? '');
  const [ownerPhone, setOwnerPhone] = useState(user?.phone ?? '');
  const [dailySalesTarget, setDailySalesTarget] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [staffAutoLockMinutes, setStaffAutoLockMinutes] = useState('');
  const [ownerAutoLockMinutes, setOwnerAutoLockMinutes] = useState('');
  const [cashOutAlertThreshold, setCashOutAlertThreshold] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeTaxId, setStoreTaxId] = useState('');
  const [ticketHeaderText, setTicketHeaderText] = useState<string[]>([]);
  const [ticketFooterText, setTicketFooterText] = useState<string[]>([t('settings.defaultTicketThankYou')]);
  const [reportFooterText, setReportFooterText] = useState<string[]>([]);
  const [storeLogoId, setStoreLogoId] = useState('');
  const [storeType, setStoreType] = useState<StoreType>('general');
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [showLogo, setShowLogo] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [showStaffName, setShowStaffName] = useState(true);
  const [showDateTime, setShowDateTime] = useState(true);
  const [paperWidth, setPaperWidth] = useState<58 | 80>(80);
  const [receiptPreviewType, setReceiptPreviewType] = useState<'ticket' | 'x' | 'z'>('ticket');
  const receiptPreviewTarget = useRef<HTMLElement>(null);
  const [defaultSettlementTerms, setDefaultSettlementTerms] = useState<SettlementTerms>('monthly');
  const [notificationPreferences, setNotificationPreferences] = useState<Partial<Record<NotificationType, boolean>>>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [userNotificationPreferences, setUserNotificationPreferences] = useState<Partial<Record<NotificationType, boolean>>>({});
  const [notificationSoundPreferences, setNotificationSoundPreferences] = useState<NotificationSoundPreferences>(DEFAULT_NOTIFICATION_SOUND_PREFERENCES);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [staffRuleDrafts, setStaffRuleDrafts] = useState<Record<string, StaffRuleDraft>>({});
  const [savingCreditPolicy, setSavingCreditPolicy] = useState(false);
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);
  const [savingBlindClosing, setSavingBlindClosing] = useState(false);
  const [savingAutoLock, setSavingAutoLock] = useState(false);
  const [savingCashOutThreshold, setSavingCashOutThreshold] = useState(false);
  const [savingSettlementTerms, setSavingSettlementTerms] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [soundPreferencesLoading, setSoundPreferencesLoading] = useState(false);
  const [savingSoundPreferences, setSavingSoundPreferences] = useState(false);
  const language = useSyncExternalStore(subscribeToLanguage, getLanguage);
  const [lastCheck, setLastCheck] = useState(updateService.getLastCheck());
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(() => updateService.getLastResult());
  const [mySchedule, setMySchedule] = useState<ScheduleShiftRecord[]>([]);
  const [scheduleNotifications, setScheduleNotifications] = useState<NotificationRecord[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => updateService.subscribeResults((result) => {
    setLastCheck(result.checkedAt);
    setUpdateResult(result);
  }), []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setNotificationSoundPreferences(DEFAULT_NOTIFICATION_SOUND_PREFERENCES);
    setSoundPreferencesLoading(true);
    void getNotificationSoundPreferences(user.id).then((preferences) => {
      if (active) setNotificationSoundPreferences(preferences);
    }).catch((preferenceError: unknown) => {
      console.error('Unable to load notification sound preferences.', preferenceError);
      if (active) setError(t('settings.loadSoundPreferencesFailed'));
    }).finally(() => {
      if (active) setSoundPreferencesLoading(false);
    });
    return () => { active = false; };
  }, [user?.id]);

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
        setDailySalesTarget('');
        setStaffAutoLockMinutes(String(nextStore?.staffAutoLockMinutes ?? 5));
        setOwnerAutoLockMinutes(String(nextStore?.ownerAutoLockMinutes ?? 0));
        setCashOutAlertThreshold('');
        setStoreAddress(nextStore?.address ?? '');
        setStorePhone(nextStore?.phone ?? '');
        setStoreTaxId(nextStore?.taxId ?? '');
        const storeSettings = resolveStoreSettings(nextStore?.settings);
        setDefaultSettlementTerms(storeSettings.defaultSettlementTerms);
        setNotificationPreferences(storeSettings.notificationPreferences);
        setTicketHeaderText(storeSettings.ticketHeaderText);
        setTicketFooterText(storeSettings.ticketFooterText);
        setReportFooterText(storeSettings.reportFooterText);
        setStoreLogoId(storeSettings.storeLogoId);
        setStoreType(storeSettings.storeType);
        setShowLogo(storeSettings.showLogo);
        setShowAddress(storeSettings.showAddress);
        setShowPhone(storeSettings.showPhone);
        setShowStaffName(storeSettings.showStaffName);
        setShowDateTime(storeSettings.showDateTime);
        setPaperWidth(storeSettings.paperWidth);
        setPositions(nextPositions);
        setCategories(nextCategories);
        setCatalogItems(nextItems);
        setStaffRuleDrafts(Object.fromEntries(nextPositions.map((position) => [position.id, {
          maxQuantity: '',
          categoryIds: [...(position.selfServiceCategoryIds ?? [])],
          itemIds: [...(position.selfServiceItemIds ?? [])],
          compItemsEnabled: position.permissionIds.includes('comp_items'),
        }])));
      }).catch((storeError: unknown) => {
        console.error('Unable to load settings data.', storeError);
        setError(t('common.storeLoadFailed'));
      });
    }
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
        if (active) setError(t('settings.loadScheduleFailed'));
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
      if (active) setError(t('settings.loadNotificationPreferencesFailed'));
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
        dailySalesTargetMillimes: parseMillimesAmount(dailySalesTarget),
        address: storeAddress,
        phone: storePhone,
        taxId: storeTaxId,
      }));
      setStore(await userService.updateStoreSettings(store.id, user.id, {
        ticketHeaderText: ticketHeaderText.map((line) => line.trim().slice(0, 60)).slice(0, 2),
        ticketFooterText: ticketFooterText.map((line) => line.trim().slice(0, 60)).slice(0, 2),
        reportFooterText: reportFooterText.map((line) => line.trim().slice(0, 60)).slice(0, 2),
        storeLogoId,
        storeType,
        showLogo,
        showAddress,
        showPhone,
        showStaffName,
        showDateTime,
        paperWidth,
      }));
      window.dispatchEvent(new Event('hanouti:store-settings-updated'));
      setNotice(t('settings.storeInfoSaved'));
    } catch (storeError) {
      setError(localizeErrorMessage(storeError, t('settings.saveStoreInfoFailed')));
    }
  }

  async function saveStoreAppearance(appearance: StoreAppearance): Promise<StoreAppearance> {
    if (!store || !user || user.role !== 'owner' || store.ownerId !== user.id) {
      throw new Error(t('settings.ownerOnlyTheme'));
    }
    const updated = await userService.updateStoreSettings(store.id, user.id, { appearance });
    setStore(updated);
    const savedAppearance = resolveStoreSettings(updated.settings).appearance;
    applyStoreAppearance(savedAppearance);
    return savedAppearance;
  }

  async function saveOwnerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    try {
      const updatedOwner = await updateOwnerProfile({ name: ownerName, phone: ownerPhone });
      setOwnerName(updatedOwner.name);
      setOwnerPhone(updatedOwner.phone ?? '');
      setNotice(t('settings.ownerProfileSaved'));
    } catch (profileError) {
      setError(localizeErrorMessage(profileError, t('settings.saveOwnerProfileFailed')));
    }
  }

  async function printSampleTicket() {
    setError('');
    setNotice('');
    try {
      await printOrSharePdf(
        receiptPreviewTarget.current,
        'sample-ticket',
        t('settings.sampleTicket'),
        sampleTicketDocument.width,
      );
    } catch (printError) {
      if (printError instanceof Error && printError.name === 'AbortError') return;
      setError(localizeErrorMessage(printError, t('settings.printTestTicketFailed')));
    }
  }

  async function exportSampleTicket(action: 'download' | 'share') {
    setError('');
    setNotice('');
    try {
      const exportPdf = action === 'download' ? downloadThermalPdf : shareThermalPdf;
      await exportPdf(
        receiptPreviewTarget.current,
        'sample-ticket',
        t('settings.sampleTicket'),
        sampleTicketDocument.width,
      );
      setNotice(action === 'download' ? t('settings.sampleTicketDownloaded') : t('settings.sampleTicketShared'));
    } catch (exportError) {
      if (exportError instanceof Error && exportError.name === 'AbortError') return;
      setError(localizeErrorMessage(exportError, t('settings.exportSampleTicketFailed')));
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
      setNotice(t('settings.storeAdminPinUpdated'));
    } catch (pinError) {
      setError(localizeErrorMessage(pinError, t('settings.updatePinFailed')));
    }
  }

  async function changeCustomerCreditBalance(allowed: boolean) {
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingCreditPolicy(true);
    try {
      setStore(await userService.updateCustomerCreditBalanceSetting(store.id, user.id, allowed));
      setNotice(t(allowed ? 'settings.customerCreditEnabled' : 'settings.customerCreditDisabled'));
    } catch (policyError) {
      setError(localizeErrorMessage(policyError, t('settings.saveCustomerCreditFailed')));
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
      setNotice(t('settings.paymentMethodsSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.savePaymentMethodsFailed')));
    } finally {
      setSavingPaymentSettings(false);
    }
  }

  async function changeBlindClosing(enabled: boolean) {
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingBlindClosing(true);
    try {
      setStore(await userService.updateStoreSettings(store.id, user.id, { blindShiftClosing: enabled }));
      setNotice(t(enabled ? 'settings.blindClosingEnabled' : 'settings.normalClosingRestored'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveBlindClosingFailed')));
    } finally {
      setSavingBlindClosing(false);
    }
  }

  async function saveAutoLockTimeout(event: FormEvent<HTMLFormElement>, audience: 'staff' | 'owner') {
    event.preventDefault();
    if (!store || !user || user.role !== 'owner') return;
    setError('');
    setNotice('');
    setSavingAutoLock(true);
    try {
      const minutes = Number(audience === 'staff' ? staffAutoLockMinutes : ownerAutoLockMinutes);
      setStore(await userService.updateStoreAutoLockMinutes(store.id, user.id, audience, minutes));
      setNotice(t('settings.autoLockSaved', { audience: t(audience === 'staff' ? 'settings.staffAudience' : 'settings.ownerAudience') }));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveAutoLockFailed')));
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
        parseMillimesAmount(cashOutAlertThreshold),
      ));
      setNotice(t('settings.cashOutThresholdSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveCashOutThresholdFailed')));
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
      setNotice(t('settings.settlementTermsSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveSettlementTermsFailed')));
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
      setNotice(t('settings.notificationPreferencesSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveNotificationPreferencesFailed')));
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
      setNotice(t('settings.notificationPreferencesDeviceSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveNotificationPreferencesFailed')));
    } finally {
      setSavingNotifications(false);
    }
  }

  async function changeNotificationSound(purpose: NotificationSoundPurpose, soundId: NotificationSoundChoice) {
    if (!user?.id) return;
    setError('');
    setNotice('');
    setSavingSoundPreferences(true);
    const nextPreferences = { ...notificationSoundPreferences, [purpose]: soundId };
    try {
      await saveNotificationSoundPreferences(user.id, nextPreferences);
      setNotificationSoundPreferences(nextPreferences);
      setNotice(t('settings.notificationSoundsSaved'));
    } catch (settingsError) {
      setError(localizeErrorMessage(settingsError, t('settings.saveNotificationSoundsFailed')));
    } finally {
      setSavingSoundPreferences(false);
    }
  }

  async function testNotificationSound(soundId: NotificationSoundId, onFinish: () => void) {
    setError('');
    try {
      await playNotificationSound(soundId, onFinish);
    } catch (soundError) {
      onFinish();
      setError(localizeErrorMessage(soundError, t('settings.playNotificationSoundFailed')));
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
        throw new Error(t('settings.staffItemLimitInvalid'));
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
      setNotice(t('settings.staffRulesSaved', { name: position.name }));
    } catch (ruleError) {
      setError(localizeErrorMessage(ruleError, t('settings.saveStaffRulesFailed')));
    }
  }

  async function changeLanguage(value: AppLanguage) {
    setError('');
    setNotice('');
    try {
      await settingsService.setLanguage(value);
      setNotice(t('settings.languageChanged'));
    } catch (languageError) {
      setError(localizeErrorMessage(languageError, t('settings.languageFailed')));
    }
  }

  async function checkForUpdates() {
    setChecking(true);
    setError('');
    setNotice('');
    try {
      const result = await updateService.checkForUpdates();
      setLastCheck(result.checkedAt);
      setUpdateResult(result);
    } catch (updateError) {
      console.error('[updates] Manual update check failed.', updateError);
      setError(localizeErrorMessage(updateError, t('settings.checkUpdatesFailed')));
    } finally {
      setChecking(false);
    }
  }

  async function applyAvailableUpdate() {
    setError('');
    try {
      await updateService.applyUpdate();
    } catch (updateError) {
      console.error('[updates] Could not apply the available update.', updateError);
      setError(localizeErrorMessage(updateError, t('settings.applyUpdateFailed')));
    }
  }

  async function forceRefresh() {
    setError('');
    try {
      await updateService.forceRefresh();
    } catch (refreshError) {
      console.error('[updates] Could not force-refresh the app.', refreshError);
      setError(localizeErrorMessage(refreshError, t('settings.forceRefreshFailed')));
    }
  }

  const updateStatus = updateResult?.error
    ?? (updateResult?.mode === 'bundled' && updateResult.updateAvailable
      ? t('settings.statusNewApkRequired')
      : updateResult?.updateAvailable
        ? t('settings.statusUpdateAvailable')
        : updateResult
          ? t('settings.statusUpToDate', { version: updateResult.currentVersion, build: updateResult.currentBuild })
          : t('settings.statusNotChecked'));

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  const upcomingSchedule = mySchedule.filter((shift) => shift.publishedAt && scheduleDate && shift.date >= scheduleDate);
  const previewSettings = {
    ...resolveStoreSettings(store?.settings),
    ticketHeaderText,
    ticketFooterText,
    reportFooterText,
    storeLogoId,
    showLogo,
    showAddress,
    showPhone,
    showStaffName,
    showDateTime,
    paperWidth,
  };
  const previewStore = {
    name: storeName || store?.name || t('settings.sampleStore'),
    address: storeAddress,
    phone: storePhone,
    taxId: storeTaxId,
  };
  const sampleTicketDocument = buildTicketDocument(
    makeSampleOrder(storeId ?? 'sample-store'),
    previewStore,
    user?.name ?? t('settings.sampleCashier'),
    previewSettings,
  );
  const previewDocument = (() => {
    if (receiptPreviewType === 'ticket') return sampleTicketDocument;
    const reportType = receiptPreviewType === 'x' ? 'X' : 'Z';
    return buildReportDocument(makeSampleReport(reportType), previewStore, previewSettings);
  })();
  const content = (
    <div className="settings-content">
      <header className="settings-page-header">
        <div className="settings-page-header__icon"><MaterialIcon name="tune" /></div>
        <div className="min-w-0">
          <p className="settings-page-header__eyebrow">{user?.name}</p>
          <h1 className="font-display text-headline-lg text-on-surface">{t('settings.title')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {t(activeSection?.description ?? 'settings.managePreferences')}
          </p>
        </div>
      </header>

      {!activeSection ? (
        <section className="settings-dashboard" aria-label={t('settings.categoriesAria')}>
          <div className="settings-dashboard__intro">
            <div>
              <p className="settings-dashboard__eyebrow">{t('settings.yourWorkspace')}</p>
              <h2 className="font-display text-headline-md text-on-surface">{t('settings.updatePrompt')}</h2>
            </div>
            <span className="settings-dashboard__count">{t('settings.categoriesCount', { count: settingsSections.length })}</span>
          </div>
          <div className="settings-dashboard-grid">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className="settings-dashboard-card"
                onClick={() => setSearchParams({ section: section.id })}
              >
                <span className="settings-dashboard-card__icon"><MaterialIcon name={section.icon} /></span>
                <span className="settings-dashboard-card__content">
                  <span className="settings-dashboard-card__title">{t(section.title)}</span>
                  <span className="settings-dashboard-card__description">{t(section.description)}</span>
                </span>
                <MaterialIcon name="arrow_forward" className="settings-dashboard-card__arrow" />
              </button>
            ))}
          </div>
        </section>
      ) : (
      <>
      <button type="button" className="settings-back-button" onClick={() => setSearchParams({}, { replace: true })}>
        <MaterialIcon name="arrow_back" className="text-lg" />
        {t('settings.allSettings')}
      </button>
      <div className="settings-section-content">
      {activeSection.id === 'display' && user?.id && (
        <AppearanceSettings
          key={user.id}
          appearance={resolveStoreSettings(store?.settings).appearance}
          canEdit={user.role === 'owner' && store?.ownerId === user.id}
          onSave={saveStoreAppearance}
        />
      )}

      {user?.id && activeSection.id === 'notifications' && (
        <SettingsGlassSection
          heading={t('settings.notificationSounds')}
          description={t('settings.notificationSoundsChoose')}
          icon="volume_up"
          headingId="notification-sound-settings-heading"
        >
          {soundPreferencesLoading ? (
            <ListSkeleton rows={5} label={t('settings.loadingSoundPreferences')} />
          ) : (
            <NotificationSoundSettings
              preferences={notificationSoundPreferences}
              disabled={savingSoundPreferences}
              onChange={(purpose, soundId) => { void changeNotificationSound(purpose, soundId); }}
              onTest={testNotificationSound}
            />
          )}
        </SettingsGlassSection>
      )}

      {user?.role === 'staff' && activeSection.id === 'notifications' && (
        <>
          <SettingsGlassSection
            id="settings-notifications"
            heading={t('nav.notifications')}
            description={t('settings.staffNotificationDeviceDescription')}
            icon="notifications"
            headingId="staff-notification-settings-heading"
          >
            {preferencesLoading ? <ListSkeleton rows={3} label={t('settings.loadingNotificationPreferences')} /> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {notificationOptions.filter(({ type }) => [
                  'void_approved', 'void_rejected', 'schedule_published', 'stock_depleted', 'item_86', 'app_update',
                ].includes(type)).map((option) => {
                  const isEnabled = userNotificationPreferences[option.type] ?? true;
                  return (
                    <label
                      key={option.type}
                      className={`flex min-h-24 items-start gap-3 rounded-2xl border p-4 transition-colors ${
                        isEnabled
                          ? 'border-primary/30 bg-primary-container/40'
                          : 'border-outline-variant bg-surface-container-lowest hover:border-primary/40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        disabled={savingNotifications}
                        onChange={(event) => { void changeUserNotificationPreference(option.type, event.target.checked); }}
                        className="mt-1 h-5 w-5 shrink-0 accent-primary"
                      />
                      <span>
                        <span className="block font-body text-label-md text-on-surface">{t(option.label)}</span>
                        <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{t(option.description)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </SettingsGlassSection>
          <SettingsGlassSection heading={t('settings.mySchedule')} description={t('settings.upcomingShifts')} icon="calendar_month">
            {scheduleLoading ? <ListSkeleton rows={2} label={t('settings.loadingSchedule')} /> : upcomingSchedule.length > 0 ? (
              <div className="flex flex-col gap-2">
                {upcomingSchedule.map((shift) => (
                  <article key={shift.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
                    <div className="min-w-0">
                      <p className="font-body text-label-md text-on-surface">{new Date(`${shift.date}T00:00:00`).toLocaleDateString({ en: 'en-US', fr: 'fr-FR', ar: 'ar-TN' }[language], { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                      {shift.note && <p className="mt-0.5 truncate font-body text-body-sm text-outline">{shift.note}</p>}
                    </div>
                    <p className="shrink-0 font-body text-label-md tabular-nums text-primary">{shift.startTime}–{shift.endTime}</p>
                  </article>
                ))}
              </div>
            ) : <p className="font-body text-body-sm text-outline">{t('settings.noUpcomingShifts')}</p>}
          </SettingsGlassSection>

          {scheduleNotifications.length > 0 && (
            <SettingsGlassSection heading={t('nav.notifications')} description={t('settings.recentScheduleUpdates')} icon="notifications_active" className="settings-warning-section">
              <div className="flex flex-col gap-2">
                {scheduleNotifications.slice(0, 3).map((notification) => (
                  <article key={notification.id}>
                    <p className="font-body text-label-md text-on-warning-container">{notification.title}</p>
                    <p className="font-body text-body-sm text-on-warning-container">{notification.body}</p>
                  </article>
                ))}
              </div>
            </SettingsGlassSection>
          )}
        </>
      )}

      {activeSection.id === 'security' && <>
        {user?.role === 'owner' && <ChangePersonalPinForm userId={user.id} />}
        <ChangePasswordForm onError={setError} onNotice={setNotice} />
        {user?.role === 'owner' && <p className="font-body text-body-sm text-on-surface-variant">{t('settings.passwordResetHelp')}</p>}
      </>}

      {user?.role === 'owner' && store && (
        <>
          <div className="settings-owner-store-grid" id="settings-store" hidden={activeSection.id !== 'store'}>
          <SettingsGlassSection heading={t('settings.ownerProfile')} icon="account_circle" headingId="owner-profile-settings-heading">
            <form onSubmit={(event) => { void saveOwnerProfile(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md">{t('settings.ownerName')}<input required maxLength={200} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <label className="font-body text-label-md">{t('settings.ownerEmail')}<input readOnly value={user.email ?? ''} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 text-on-surface-variant" /></label>
              <label className="font-body text-label-md">{t('settings.ownerPhone')}<input type="tel" maxLength={100} value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <Button type="submit" variant="secondary">{t('common.save')}</Button>
            </form>
          </SettingsGlassSection>
          <SettingsGlassSection heading={t('settings.store')} icon="storefront" headingId="store-settings-heading">
            <form id="store-settings-form" onSubmit={(event) => { void saveStoreInfo(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md">{t('settings.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <label className="font-body text-label-md">{t('settings.storeType')}
                <select value={storeType} onChange={(event) => setStoreType(event.target.value as StoreType)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3">
                  <option value="general">{t('settings.storeTypeGeneral')}</option>
                  <option value="coffee">{t('settings.storeTypeCoffee')}</option>
                  <option value="restaurant">{t('settings.storeTypeRestaurant')}</option>
                  <option value="bakery">{t('settings.storeTypeBakery')}</option>
                  <option value="grocery">{t('settings.storeTypeGrocery')}</option>
                </select>
              </label>
              <div className="flex flex-col gap-2">
                <span className="font-body text-label-md">{t('settings.storeLogo')}</span>
                <button
                  type="button"
                  onClick={() => setLogoPickerOpen(true)}
                  className="flex min-h-14 items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-3 text-left"
                >
                  {storeLogoId ? <ItemLogo id={storeLogoId} size="sm" /> : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary"><MaterialIcon name="storefront" className="text-lg" /></span>
                  )}
                  <span className="flex-1 font-body text-label-md text-on-surface">{storeLogoId ? t('settings.changeStoreLogo') : t('settings.chooseStoreLogo')}</span>
                  <MaterialIcon name="chevron_right" className="text-outline" />
                </button>
              </div>
              <label className="font-body text-label-md">{t('settings.storeAddress')}<input value={storeAddress} maxLength={200} onChange={(event) => setStoreAddress(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
              <label className="font-body text-label-md">{t('settings.storePhone')}<input value={storePhone} maxLength={50} onChange={(event) => setStorePhone(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
              <label className="font-body text-label-md">{t('settings.taxId')}<input value={storeTaxId} maxLength={50} onChange={(event) => setStoreTaxId(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
              <label className="font-body text-label-md">{t('settings.storeId')}<input readOnly value={store.code.toUpperCase()} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 text-on-surface-variant" /></label>
              <label className="font-body text-label-md">{t('settings.dailySalesTarget')} (TND)<DinarInput required value={dailySalesTarget} onChange={(event) => setDailySalesTarget(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
              <p className="-mt-2 font-body text-body-sm text-outline">{t('settings.dailySalesTargetHelp')}</p>
              <Button type="submit" variant="secondary">{t('common.save')}</Button>
            </form>
          </SettingsGlassSection>
          </div>

          <SettingsGlassSection id="settings-receipts" hidden={activeSection.id !== 'receipts'} heading={t('settings.receiptsReports')} description={t('settings.receiptDescription')} icon="receipt_long" headingId="ticket-report-settings-heading">
            <label className="font-body text-label-md">{t('settings.ticketHeaderLine1')}<input maxLength={60} value={ticketHeaderText[0] ?? ''} onChange={(event) => setTicketHeaderText([event.target.value, ticketHeaderText[1] ?? ''])} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
            <label className="font-body text-label-md">{t('settings.ticketHeaderLine2')}<input maxLength={60} value={ticketHeaderText[1] ?? ''} onChange={(event) => setTicketHeaderText([ticketHeaderText[0] ?? '', event.target.value])} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
            <label className="font-body text-label-md">{t('settings.ticketFooterLine1')}<input maxLength={60} value={ticketFooterText[0] ?? ''} onChange={(event) => setTicketFooterText([event.target.value, ticketFooterText[1] ?? ''])} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
            <label className="font-body text-label-md">{t('settings.ticketFooterLine2')}<input maxLength={60} value={ticketFooterText[1] ?? ''} onChange={(event) => setTicketFooterText([ticketFooterText[0] ?? '', event.target.value])} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
            <label className="font-body text-label-md">{t('settings.reportFooter')}<input maxLength={60} value={reportFooterText[0] ?? ''} onChange={(event) => setReportFooterText([event.target.value])} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
            <label className="font-body text-label-md">{t('settings.thermalPaperWidth')}
              <select value={paperWidth} onChange={(event) => setPaperWidth(event.target.value === '58' ? 58 : 80)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3"><option value={80}>80 mm</option><option value={58}>58 mm</option></select>
            </label>
            {([
              ['showLogo', showLogo, setShowLogo, 'settings.showLogo'],
              ['showAddress', showAddress, setShowAddress, 'settings.showAddress'],
              ['showPhone', showPhone, setShowPhone, 'settings.showPhone'],
              ['showStaffName', showStaffName, setShowStaffName, 'settings.showStaffName'],
              ['showDateTime', showDateTime, setShowDateTime, 'settings.showDateTime'],
            ] as const).map(([key, checked, setter, label]) => (
              <label key={key} className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-container-low p-3"><input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} className="h-5 w-5 accent-primary" />{t(label)}</label>
            ))}
            <label className="font-body text-label-md">{t('settings.livePreview')}
              <select value={receiptPreviewType} onChange={(event) => setReceiptPreviewType(event.target.value as 'ticket' | 'x' | 'z')} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3">
                <option value="ticket">{t('settings.customerTicket')}</option>
                <option value="x">{t('reports.xReport')}</option>
                <option value="z">{t('reports.zReport')}</option>
              </select>
            </label>
            <p className="font-body text-body-sm text-outline">{t('settings.previewHelp')}</p>
            <div className="rounded-xl bg-surface-container-high p-3">
              <ReceiptDocumentView ref={receiptPreviewTarget} document={previewDocument} />
            </div>
            {receiptPreviewType === 'ticket' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => { void printSampleTicket(); }}>{t('settings.printTestTicket')}</Button>
                <Button variant="secondary" onClick={() => { void exportSampleTicket('download'); }}>{t('settings.downloadPdf')}</Button>
                <Button variant="secondary" onClick={() => { void exportSampleTicket('share'); }}>{t('settings.sharePdf')}</Button>
              </div>
            )}
            <Button type="submit" form="store-settings-form" variant="secondary">{t('settings.saveReceiptSettings')}</Button>
          </SettingsGlassSection>

          <SettingsGlassSection id="settings-security" hidden={activeSection.id !== 'security'} heading={t('settings.securityTitle')} description={t('settings.securityDescriptionFull')} icon="shield_lock" headingId="security-settings-heading">
            {store.pinMustChange && <p role="alert" className="flex items-center gap-2 rounded-xl bg-warning-container p-3 font-body text-body-md text-on-warning-container"><MaterialIcon name="warning" />{t('settings.setAdminPin')}</p>}
            <form onSubmit={(event) => { void savePin(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md">{t('settings.adminPin')}<input aria-label={t('settings.adminPin')} required type="password" pattern="[0-9]{4}" maxLength={4} inputMode="numeric" value={adminPin} onChange={(event) => setAdminPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary" /></label>
              <Keypad onPress={(digit) => setAdminPin((current) => current.length < 4 ? `${current}${digit}` : current)} onClear={() => setAdminPin('')} onBackspace={() => setAdminPin((current) => current.slice(0, -1))} />
              <Button type="submit" variant="secondary">{t('common.save')}</Button>
            </form>
            {user?.role === 'owner' && (
              <>
                <form onSubmit={(event) => { void saveAutoLockTimeout(event, 'staff'); }} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
                  <div>
                    <h3 className="font-body text-label-lg text-on-surface">{t('settings.staffAutoLock')}</h3>
                    <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('settings.staffAutoLockHelp')}</p>
                  </div>
                  <label htmlFor="staff-auto-lock" className="font-body text-label-md text-on-surface">{t('settings.minutesRange')}</label>
                  <input id="staff-auto-lock" type="number" min={0} max={60} step={1} required value={staffAutoLockMinutes} onChange={(event) => setStaffAutoLockMinutes(event.target.value)} className="h-12 rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
                  <Button type="submit" variant="secondary" disabled={savingAutoLock}>{savingAutoLock ? t('settings.savingSettings') : t('common.save')}</Button>
                </form>
                <form onSubmit={(event) => { void saveAutoLockTimeout(event, 'owner'); }} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
                  <div>
                    <h3 className="font-body text-label-lg text-on-surface">{t('settings.ownerAutoLock')}</h3>
                    <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('settings.ownerAutoLockHelp')}</p>
                  </div>
                  <label htmlFor="owner-auto-lock" className="font-body text-label-md text-on-surface">{t('settings.minutesRange')}</label>
                  <input id="owner-auto-lock" type="number" min={0} max={60} step={1} required value={ownerAutoLockMinutes} onChange={(event) => setOwnerAutoLockMinutes(event.target.value)} className="h-12 rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
                  <Button type="submit" variant="secondary" disabled={savingAutoLock}>{savingAutoLock ? t('settings.savingSettings') : t('common.save')}</Button>
                </form>
              </>
            )}
            <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
              <div>
                <h3 className="font-body text-label-lg text-on-surface">{t('settings.posPaymentMethods')}</h3>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('settings.posPaymentHelp')}</p>
              </div>
              <label className="flex min-h-12 items-center gap-3 font-body text-label-md text-on-surface">
                <input type="checkbox" checked={store.allowCardPayments ?? false} disabled={savingPaymentSettings} onChange={(event) => { void changePaymentMethodSetting('card', event.target.checked); }} className="h-5 w-5 accent-primary" />
                {t('settings.showCardAtPos')}
              </label>
              <label className="flex min-h-12 items-center gap-3 font-body text-label-md text-on-surface">
                <input type="checkbox" checked={store.allowOtherPayments ?? false} disabled={savingPaymentSettings} onChange={(event) => { void changePaymentMethodSetting('other', event.target.checked); }} className="h-5 w-5 accent-primary" />
                {t('settings.showOtherAtPos')}
              </label>
            </div>
            <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-3">
              <label className="flex min-h-12 items-start gap-3 font-body text-label-md text-on-surface">
                <input
                  type="checkbox"
                  checked={resolveStoreSettings(store.settings).blindShiftClosing}
                  disabled={savingBlindClosing}
                  onChange={(event) => { void changeBlindClosing(event.target.checked); }}
                  className="mt-0.5 h-5 w-5 accent-primary"
                />
                <span>
                  <strong className="block">{t('settings.blindClosing')}</strong>
                  <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
                    {t('settings.blindClosingHelp')}
                  </span>
                </span>
              </label>
            </div>
          </SettingsGlassSection>

          <SettingsGlassSection id="settings-customers" hidden={activeSection.id !== 'customers'} heading={t('settings.customers')} description={t('settings.customerSettingsDescription')} icon="groups" headingId="customer-settings-heading">
            <label className="flex min-h-12 items-start gap-3 rounded-xl bg-surface-container-low p-3">
              <input type="checkbox" checked={store.allowCustomerCreditBalance ?? false} disabled={savingCreditPolicy} onChange={(event) => { void changeCustomerCreditBalance(event.target.checked); }} className="mt-1 h-5 w-5 accent-primary" />
              <span>
                <span className="block font-body text-label-md text-on-surface">{t('settings.allowCustomerCredit')}</span>
                <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{t('settings.allowCustomerCreditHelp')}</span>
              </span>
            </label>
            <form onSubmit={(event) => { void saveDefaultSettlementTerms(event); }} className="flex flex-col gap-3">
              <label className="font-body text-label-md text-on-surface">{t('settings.defaultSettlementTerms')}
                <select value={defaultSettlementTerms} onChange={(event) => setDefaultSettlementTerms(event.target.value as SettlementTerms)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
                  <option value="weekly">{t('settings.weekly')}</option>
                  <option value="monthly">{t('settings.monthly')}</option>
                  <option value="anytime">{t('settings.anytime')}</option>
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={savingSettlementTerms}>{savingSettlementTerms ? t('settings.savingSettings') : t('common.save')}</Button>
            </form>
          </SettingsGlassSection>

          <SettingsGlassSection id="settings-staff" hidden={activeSection.id !== 'staff'} heading={t('settings.staffRules')} description={t('settings.staffRulesDescriptionFull')} icon="badge" headingId="staff-rules-heading">
            {positions.map((position) => {
              const draft = staffRuleDrafts[position.id];
              if (!draft) return null;
              return (
                <article key={position.id} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
                  <h3 className="font-body text-label-lg text-on-surface">{position.name}</h3>
                  <label className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-label-md text-on-surface">
                    <input type="checkbox" checked={draft.compItemsEnabled} onChange={(event) => updateStaffRule(position.id, { compItemsEnabled: event.target.checked })} className="h-5 w-5 accent-primary" />
                    {t('settings.allowCompItems')}
                  </label>
                  <label className="font-body text-label-md text-on-surface">{t('settings.maxCompQuantity')}
                    <input type="number" min="0" step="1" required value={draft.maxQuantity} onChange={(event) => updateStaffRule(position.id, { maxQuantity: event.target.value })} className="mt-1 h-12 w-full rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
                  </label>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 font-body text-label-md text-on-surface">{t('settings.allowedCategories')}</legend>
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
                    {categories.length === 0 && <p className="font-body text-body-sm text-outline">{t('settings.noCategories')}</p>}
                  </fieldset>
                  <fieldset className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                    <legend className="mb-1 font-body text-label-md text-on-surface">{t('settings.allowedItems')}</legend>
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
                    {catalogItems.length === 0 && <p className="font-body text-body-sm text-outline">{t('settings.noActiveItems')}</p>}
                  </fieldset>
                  <Button variant="secondary" className="min-h-12 w-full" onClick={() => { void saveStaffRules(position); }}>{t('settings.savePositionRules', { name: position.name })}</Button>
                </article>
              );
            })}
            {positions.length === 0 && <p className="rounded-xl bg-surface-container-low p-3 font-body text-body-sm text-outline">{t('settings.createPositionFirst')}</p>}
          </SettingsGlassSection>

          <SettingsGlassSection id="settings-notifications" hidden={activeSection.id !== 'notifications'} heading={t('nav.notifications')} description={t('settings.notificationTypesDescription')} icon="notifications" headingId="notification-settings-heading">
            <div className="grid gap-3 sm:grid-cols-2">
              {notificationOptions.map((option) => {
                const isEnabled = notificationPreferences[option.type] ?? true;
                return (
                  <label
                    key={option.type}
                    className={`flex min-h-24 items-start gap-3 rounded-2xl border p-4 transition-colors ${
                      isEnabled
                        ? 'border-primary/30 bg-primary-container/40'
                        : 'border-outline-variant bg-surface-container-lowest hover:border-primary/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={savingNotifications}
                      onChange={(event) => { void changeNotificationPreference(option.type, event.target.checked); }}
                      className="mt-1 h-5 w-5 shrink-0 accent-primary"
                    />
                    <span>
                      <span className="block font-body text-label-md text-on-surface">{t(option.label)}</span>
                      <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{t(option.description)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <form onSubmit={(event) => { void saveCashOutAlertThreshold(event); }} className="rounded-2xl border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                  <MaterialIcon name="payments" />
                </span>
                <div>
                  <h3 className="font-body text-label-lg text-on-surface">{t('settings.largeCashOutThreshold')}</h3>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('settings.cashOutThresholdHelp')}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label htmlFor="cash-out-alert-threshold" className="font-body text-label-md text-on-surface">
                  {t('settings.alertThreshold')}
                  <DinarInput
                    id="cash-out-alert-threshold"
                    required
                    value={cashOutAlertThreshold}
                    onChange={(event) => setCashOutAlertThreshold(event.target.value)}
                    className="mt-1.5 h-12 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <Button type="submit" variant="secondary" disabled={savingCashOutThreshold} className="w-full sm:w-auto">
                  {savingCashOutThreshold ? t('settings.savingSettings') : t('common.save')}
                </Button>
              </div>
            </form>
          </SettingsGlassSection>
        </>
      )}

      <div id="settings-help" hidden={activeSection.id !== 'help'}>
      <SettingsGlassSection
        heading={t('settings.help')}
        description={t('help.intro')}
        icon="help"
        headingId="help-section-heading"
      >
        <HelpGuide title={t('help.staff')} steps={staffHelpSteps} />
        {user?.role === 'owner' && <HelpGuide title={t('help.owner')} steps={ownerHelpSteps} />}
      </SettingsGlassSection>
      </div>

      <div id="settings-language" hidden={activeSection.id !== 'language'}>
      <SettingsGlassSection
        heading={t('settings.language')}
        description={t('settings.languageDescription')}
        icon="language"
      >
        <select
          value={language}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (isLanguageCode(value)) void changeLanguage(value);
          }}
          className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md outline-none focus:ring-2 focus:ring-primary"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>{option.name}</option>
          ))}
        </select>
      </SettingsGlassSection>
      </div>

      <div id="settings-permissions" hidden={activeSection.id !== 'permissions'}>
      <PermissionsSettingsCard />
      </div>

      <div id="settings-updates" hidden={activeSection.id !== 'updates'}>
      <SettingsGlassSection
        heading={t('settings.appUpdates')}
        description={t('settings.updateDescription')}
        icon="system_update"
      >
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.currentVersion')}</span>
          <span className="font-semibold text-on-surface">v{updateService.getCurrentVersion()}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.buildId')}</span>
          <span className="font-semibold text-on-surface">{updateService.getCurrentBuild()}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.mode')}</span>
          <span className="font-semibold capitalize text-on-surface">{t(`settings.mode${updateService.getMode()[0].toUpperCase()}${updateService.getMode().slice(1)}` as TranslationKey)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.lastCheck')}</span>
          <span className="text-right text-on-surface">{lastCheck ? new Date(lastCheck).toLocaleString(getLanguage()) : t('settings.neverChecked')}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.latestVersion')}</span>
          <span className="text-right text-on-surface">{updateResult?.latestVersion ? `v${updateResult.latestVersion}` : t('settings.notChecked')}</span>
        </div>
        <div className="flex items-center justify-between gap-2 font-body text-body-sm">
          <span className="text-on-surface-variant">{t('settings.latestBuild')}</span>
          <span className="text-right text-on-surface">{updateResult?.latestBuild ?? t('settings.notChecked')}</span>
        </div>
        <p role={updateResult?.error ? 'alert' : 'status'} className={`font-body text-body-sm ${updateResult?.error ? 'text-error' : 'text-on-surface-variant'}`}>{updateStatus}</p>
        <Button onClick={checkForUpdates} disabled={checking} variant="secondary" className="w-full">
          <MaterialIcon name={checking ? 'sync' : 'refresh'} className={`text-lg ${checking ? 'animate-spin' : ''}`} />
          {checking ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
        </Button>
        <Button onClick={() => { void applyAvailableUpdate(); }} disabled={!updateResult?.updateAvailable} className="w-full">
          {t('settings.updateNow')}
        </Button>
        {updateResult?.mode === 'bundled' && (
          <Button onClick={() => { void updateService.openHostedApp().catch((openError: unknown) => setError(localizeErrorMessage(openError, t('settings.openHostedAppFailed')))); }} variant="secondary" className="w-full">
            {t('settings.openHostedApp')}
          </Button>
        )}
        <Button onClick={() => { void forceRefresh(); }} variant="secondary" className="w-full">
          {t('settings.forceRefresh')}
        </Button>
        <details className="rounded-lg bg-surface-container-low p-3">
          <summary className="cursor-pointer font-body text-label-md text-on-surface">{t('settings.updateDiagnostics')}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-on-surface-variant">
            {updateResult ? JSON.stringify(updateResult, null, 2) : t('settings.noUpdateCheck')}
          </pre>
        </details>
      </SettingsGlassSection>
      </div>
      </div>
      </>
      )}
      {user?.role === 'owner' && (
        <LogoPicker
          open={logoPickerOpen}
          value={storeLogoId}
          allowedGroups={getStoreLogoGroups(storeType)}
          onChange={setStoreLogoId}
          onClose={() => setLogoPickerOpen(false)}
          panelClassName="settings-logo-picker-panel"
        />
      )}
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
      {!deviceBoundSession && <Button variant="danger" onClick={() => { void handleLogout(); }} className="w-full"><MaterialIcon name="logout" />{t('app.logOut')}</Button>}
    </div>
  );

  if (user?.role === 'owner') return <WorkspaceLayout title={t('settings.title')} storeName={store?.name} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>;
  if (user?.role === 'super_admin') return <WorkspaceLayout title={t('settings.title')} links={adminWorkspaceLinks}>{content}</WorkspaceLayout>;
  return <div className="store-themed-screen min-h-screen bg-surface pb-24"><main className="p-0"><PageContainer>{content}</PageContainer></main><BottomNav /></div>;
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
