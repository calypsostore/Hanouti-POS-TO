import { resolveStoreSettings, type StoreRecord, type StoreSettings, type SubscriptionPlan } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface StoreRow {
  id: string;
  store_id: string;
  owner_id: string | null;
  code: string;
  name: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  tax_id: string | null;
  is_active: boolean;
  archived_at: string | null;
  day_closed_on: string | null;
  allow_customer_credit_balance: boolean;
  allow_card_payments: boolean;
  allow_other_payments: boolean;
  staff_auto_lock_minutes: number;
  cash_out_alert_threshold_millimes: number;
  daily_sales_target_millimes: number;
  pin_must_change: boolean;
  subscription_plan: SubscriptionPlan;
  subscription_paid_until: string | null;
  subscription_notes: string;
  created_at: string;
}

interface StoreSettingsRow {
  settings: StoreSettings;
}

export function mapStore(row: StoreRow, settings?: StoreSettings): StoreRecord {
  return {
    id: row.store_id,
    ownerId: row.owner_id ?? '',
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    taxId: row.tax_id ?? undefined,
    allowCustomerCreditBalance: row.allow_customer_credit_balance,
    allowCardPayments: row.allow_card_payments,
    allowOtherPayments: row.allow_other_payments,
    settings: resolveStoreSettings(settings),
    subscription: {
      plan: row.subscription_plan,
      paidUntil: row.subscription_paid_until,
      notes: row.subscription_notes,
    },
    archivedAt: row.archived_at ?? undefined,
    staffAutoLockMinutes: row.staff_auto_lock_minutes,
    cashOutAlertThresholdMillimes: Number(row.cash_out_alert_threshold_millimes),
    dailySalesTargetMillimes: Number(row.daily_sales_target_millimes),
    pinMustChange: row.pin_must_change,
    isActive: row.is_active,
    dayClosedOn: row.day_closed_on ?? undefined,
    createdAt: row.created_at,
  };
}

export async function getStore(storeId: string): Promise<StoreRecord | undefined> {
  const client = getSupabaseClient();
  const { data: row, error } = await client
    .from('stores')
    .select('id, store_id, owner_id, code, name, timezone, address, phone, tax_id, is_active, archived_at, day_closed_on, allow_customer_credit_balance, allow_card_payments, allow_other_payments, staff_auto_lock_minutes, cash_out_alert_threshold_millimes, daily_sales_target_millimes, pin_must_change, subscription_plan, subscription_paid_until, subscription_notes, created_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) throw new Error(`Could not load store: ${error.message}`, { cause: error });
  if (!row) return undefined;
  const { data: settingsRow, error: settingsError } = await client
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not load store settings: ${settingsError.message}`, { cause: settingsError });
  return mapStore(row as StoreRow, (settingsRow as StoreSettingsRow | null)?.settings);
}

export async function listStores(): Promise<StoreRecord[]> {
  const client = getSupabaseClient();
  const { data: rows, error } = await client
    .from('stores')
    .select('id, store_id, owner_id, code, name, timezone, address, phone, tax_id, is_active, archived_at, day_closed_on, allow_customer_credit_balance, allow_card_payments, allow_other_payments, staff_auto_lock_minutes, cash_out_alert_threshold_millimes, daily_sales_target_millimes, pin_must_change, subscription_plan, subscription_paid_until, subscription_notes, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load stores: ${error.message}`, { cause: error });
  if (!rows?.length) return [];
  const { data: settingsRows, error: settingsError } = await client
    .from('store_settings')
    .select('store_id, settings')
    .in('store_id', rows.map((row) => row.store_id));
  if (settingsError) throw new Error(`Could not load store settings: ${settingsError.message}`, { cause: settingsError });
  const settingsByStoreId = new Map((settingsRows ?? []).map((row) => [row.store_id, row.settings as StoreSettings]));
  return rows.map((row) => mapStore(row as StoreRow, settingsByStoreId.get(row.store_id)));
}
