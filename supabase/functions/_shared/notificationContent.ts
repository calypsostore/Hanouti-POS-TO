import { arNotifications } from '../../../src/i18n/locales/ar/notifications.ts';
import { enNotifications } from '../../../src/i18n/locales/en/notifications.ts';
import { frNotifications } from '../../../src/i18n/locales/fr/notifications.ts';

type LanguageCode = 'en' | 'fr' | 'ar';
type Values = Record<string, string | number>;
type Catalog = Readonly<Record<string, string>>;

const catalogs: Record<LanguageCode, Catalog> = {
  en: enNotifications,
  fr: frNotifications,
  ar: arNotifications,
};

const locales: Record<LanguageCode, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  ar: 'ar-TN',
};

const contentKeys: Record<string, { title: string; body: string }> = {
  void_requested: { title: 'notificationsContent.voidRequestedTitle', body: 'notificationsContent.voidRequestedBody' },
  void_approved: { title: 'notificationsContent.voidApprovedTitle', body: 'notificationsContent.voidApprovedBody' },
  void_rejected: { title: 'notificationsContent.voidRejectedTitle', body: 'notificationsContent.voidRejectedBody' },
  schedule_published: { title: 'notificationsContent.schedulePublishedTitle', body: 'notificationsContent.schedulePublishedBody' },
  customer_credit_warning: { title: 'notificationsContent.customerCreditWarningTitle', body: 'notificationsContent.customerCreditWarningBody' },
  customer_credit_limit: { title: 'notificationsContent.customerCreditLimitTitle', body: 'notificationsContent.customerCreditLimitBody' },
  customer_overdue: { title: 'notificationsContent.customerOverdueTitle', body: 'notificationsContent.customerOverdueBody' },
  stock_depleted: { title: 'notificationsContent.stockDepletedTitle', body: 'notificationsContent.stockDepletedBody' },
  item_86: { title: 'notificationsContent.item86Title', body: 'notificationsContent.item86Body' },
  low_stock: { title: 'notificationsContent.lowStockTitle', body: 'notificationsContent.lowStockBody' },
  shift_opened: { title: 'notificationsContent.shiftOpenedTitle', body: 'notificationsContent.shiftOpenedBody' },
  shift_closed: { title: 'notificationsContent.shiftClosedTitle', body: 'notificationsContent.shiftClosedBody' },
  cash_difference: { title: 'notificationsContent.cashDifferenceTitle', body: 'notificationsContent.cashDifferenceBody' },
  cash_out_alert: { title: 'notificationsContent.cashOutTitle', body: 'notificationsContent.cashOutBody' },
  z_report_closed: { title: 'notificationsContent.zReportClosedTitle', body: 'notificationsContent.zReportClosedBody' },
  app_update: { title: 'notificationsContent.appUpdateTitle', body: 'notificationsContent.appUpdateBody' },
  subscription_expiring: { title: 'notificationsContent.subscriptionExpiringTitle', body: 'notificationsContent.subscriptionExpiringBody' },
};

function isLanguageCode(value: unknown): value is LanguageCode {
  return value === 'en' || value === 'fr' || value === 'ar';
}

function valuesFromUnknown(value: unknown): Values | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const values = Object.fromEntries(Object.entries(value).filter(([, entry]) =>
    typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)),
  ));
  return values;
}

function formatWeekRange(values: Values, locale: string): string | undefined {
  if (typeof values.weekStart !== 'string' || typeof values.weekEnd !== 'string') return undefined;
  const start = new Date(`${values.weekStart}T12:00:00`);
  const end = new Date(`${values.weekEnd}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(locale, options)} – ${end.toLocaleDateString(locale, options)}`;
}

function localizeContent(
  language: LanguageCode,
  type: string,
  title: string,
  body: string,
  entityId: string | null,
  rawValues: unknown,
): { title: string; body: string } {
  const keys = contentKeys[type];
  if (!keys) return { title, body };

  const values = valuesFromUnknown(rawValues);
  if (!values) {
    if (type !== 'app_update' || !entityId) return { title, body };
    const version = body.match(/\d+[.]\d+[.]\d+/)?.[0];
    if (!version) return { title, body };
    const fallbackValues = { version, build: entityId };
    return render(language, type, keys, fallbackValues);
  }
  return render(language, type, keys, values);
}

function render(
  language: LanguageCode,
  type: string,
  keys: { title: string; body: string },
  values: Values,
): { title: string; body: string } {
  const catalog = catalogs[language];
  const interpolation = { ...values };
  if (typeof values.amount === 'number') {
    interpolation.amount = new Intl.NumberFormat(locales[language], {
      useGrouping: true,
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(values.amount);
  }
  if (type === 'subscription_expiring' && typeof values.date === 'string') {
    const date = new Date(`${values.date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) interpolation.date = date.toLocaleDateString(locales[language]);
  }
  if (type === 'schedule_published') {
    interpolation.week = formatWeekRange(values, locales[language]) ?? String(values.week ?? '');
  }
  if (type === 'cash_out_alert') {
    const reasonKeys: Record<string, string> = {
      supplier: 'shift.reasonBoughtMilk',
      change: 'shift.reasonChangeFloat',
      expense: 'shift.reasonExpense',
      other: 'shift.reasonOther',
    };
    const reasonKey = typeof values.reason === 'string' ? reasonKeys[values.reason] : undefined;
    if (reasonKey) interpolation.reason = catalog[reasonKey] ?? values.reason;
    const note = typeof values.note === 'string' ? values.note : '';
    interpolation.note = note
      ? (catalog['notificationsContent.noteSuffix'] ?? ': {note}').replace('{note}', note)
      : '.';
  }
  const bodyKey = type === 'z_report_closed' && values.number === undefined
    ? 'notificationsContent.zReportClosedWithoutNumber'
    : keys.body;
  const translate = (key: string) => catalog[key] ?? catalogs.en[key] ?? key;
  const interpolate = (template: string) => template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(interpolation[name] ?? `{${name}}`),
  );
  return { title: translate(keys.title), body: interpolate(translate(bodyKey)) };
}

export function getPushNotificationContent(
  languageValue: unknown,
  type: string,
  title: string,
  body: string,
  entityId: string | null,
  contentValues: unknown,
): { title: string; body: string } {
  const language = isLanguageCode(languageValue) ? languageValue : 'en';
  return localizeContent(language, type, title, body, entityId, contentValues);
}
