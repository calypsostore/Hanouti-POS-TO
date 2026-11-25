import type {
  FiscalProfileRecord,
  FiscalTaxAssignmentRecord,
  FiscalTaxRuleRecord,
} from '../../types/fiscal';
import { getSupabaseClient } from '../supabaseClient';

interface ProfileRow {
  store_id: string;
  review_status: FiscalProfileRecord['reviewStatus'];
  data: unknown;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

interface RuleRow {
  store_id: string;
  rule_id: string;
  version: number;
  name: string;
  tax_type: FiscalTaxRuleRecord['taxType'];
  calculation_method: FiscalTaxRuleRecord['calculationMethod'];
  rate_ppm: number | null;
  fixed_amount_millimes: number | null;
  fixed_amount_per_unit: boolean;
  compound_with_prior_taxes: boolean;
  priority: number;
  effective_from: string;
  effective_through: string | null;
  status: FiscalTaxRuleRecord['status'];
  legal_reference: string | null;
  legal_reviewed: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

interface AssignmentRow {
  id: string;
  store_id: string;
  item_id: string | null;
  category_id: string | null;
  tax_type: FiscalTaxAssignmentRecord['taxType'];
  treatment: FiscalTaxAssignmentRecord['treatment'];
  rule_id: string | null;
  rule_version: number | null;
  legal_reference: string | null;
  evidence_reference: string | null;
  note: string | null;
  effective_from: string;
  effective_through: string | null;
  created_by: string | null;
  created_at: string;
}

const RULE_COLUMNS = 'store_id, rule_id, version, name, tax_type, calculation_method, rate_ppm, fixed_amount_millimes, fixed_amount_per_unit, compound_with_prior_taxes, priority, effective_from, effective_through, status, legal_reference, legal_reviewed, notes, created_by, created_at';
const ASSIGNMENT_COLUMNS = 'id, store_id, item_id, category_id, tax_type, treatment, rule_id, rule_version, legal_reference, evidence_reference, note, effective_from, effective_through, created_by, created_at';

function raise(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapProfile(row: ProfileRow): FiscalProfileRecord {
  const data = isRecord(row.data) ? row.data : {};
  const text = (key: string) => typeof data[key] === 'string' ? data[key] : undefined;
  const vatStatus = ['unknown', 'registered', 'not_registered', 'exempt', 'suspended'].includes(String(data.vatStatus))
    ? data.vatStatus as FiscalProfileRecord['vatStatus']
    : undefined;
  const declarationPeriod = ['monthly', 'quarterly', 'annual', 'custom', 'unknown'].includes(String(data.declarationPeriod))
    ? data.declarationPeriod as FiscalProfileRecord['declarationPeriod']
    : undefined;
  const pricingMode = ['inclusive', 'exclusive'].includes(String(data.pricingMode))
    ? data.pricingMode as FiscalProfileRecord['pricingMode']
    : undefined;
  const requiredTaxTypes = data.requiredTaxTypes === undefined
    ? undefined
    : Array.isArray(data.requiredTaxTypes) &&
      data.requiredTaxTypes.every((value) => ['vat', 'consumption', 'other'].includes(String(value)))
      ? data.requiredTaxTypes as NonNullable<FiscalProfileRecord['requiredTaxTypes']>
      : (() => { throw new Error('Stored fiscal profile has invalid required line-tax types.'); })();
  return {
    storeId: row.store_id,
    reviewStatus: row.review_status,
    legalName: text('legalName'),
    tradingName: text('tradingName'),
    taxId: text('taxId'),
    address: text('address'),
    activity: text('activity'),
    activityCategory: text('activityCategory'),
    legalForm: text('legalForm'),
    fiscalRegime: text('fiscalRegime'),
    vatStatus,
    declarationPeriod,
    invoicePrefix: text('invoicePrefix'),
    pricingMode,
    requiredTaxTypes,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewNotes: text('reviewNotes'),
    updatedAt: row.updated_at,
  };
}

function mapRule(row: RuleRow): FiscalTaxRuleRecord {
  return {
    id: row.rule_id,
    storeId: row.store_id,
    version: Number(row.version),
    name: row.name,
    taxType: row.tax_type,
    calculationMethod: row.calculation_method,
    ratePpm: row.rate_ppm === null ? undefined : Number(row.rate_ppm),
    fixedAmountMillimes: row.fixed_amount_millimes === null ? undefined : Number(row.fixed_amount_millimes),
    fixedAmountPerUnit: row.fixed_amount_per_unit,
    compoundWithPriorTaxes: row.compound_with_prior_taxes,
    priority: row.priority,
    effectiveFrom: row.effective_from,
    effectiveThrough: row.effective_through ?? undefined,
    status: row.status,
    legalReference: row.legal_reference ?? undefined,
    legalReviewed: row.legal_reviewed,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
  };
}

function mapAssignment(row: AssignmentRow): FiscalTaxAssignmentRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    itemId: row.item_id ?? undefined,
    categoryId: row.category_id ?? undefined,
    taxType: row.tax_type,
    treatment: row.treatment,
    ruleId: row.rule_id ?? undefined,
    ruleVersion: row.rule_version === null ? undefined : Number(row.rule_version),
    legalReference: row.legal_reference ?? undefined,
    evidenceReference: row.evidence_reference ?? undefined,
    note: row.note ?? undefined,
    effectiveFrom: row.effective_from,
    effectiveThrough: row.effective_through ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
  };
}

export async function getFiscalProfile(storeId: string): Promise<FiscalProfileRecord | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('fiscal_profiles')
    .select('store_id, review_status, data, reviewed_by, reviewed_at, updated_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) raise(error, 'Could not load fiscal profile');
  return data ? mapProfile(data as ProfileRow) : undefined;
}

export async function getCheckoutFiscalProfile(storeId: string): Promise<FiscalProfileRecord | undefined> {
  const { data, error } = await getSupabaseClient().rpc('get_checkout_fiscal_profile', {
    p_store_id: storeId,
  });
  if (error) raise(error, 'Could not load checkout fiscal settings');
  if (data === null) return undefined;
  if (!isRecord(data) || data.storeId !== storeId ||
    !['unconfigured', 'draft', 'review_required', 'confirmed'].includes(String(data.reviewStatus)) ||
    typeof data.updatedAt !== 'string' ||
    !Array.isArray(data.requiredTaxTypes) ||
    !data.requiredTaxTypes.every((taxType) => ['vat', 'consumption', 'other'].includes(String(taxType))) ||
    (data.pricingMode !== null && data.pricingMode !== undefined &&
      !['inclusive', 'exclusive'].includes(String(data.pricingMode)))) {
    throw new Error('Checkout fiscal settings response is invalid.');
  }
  return {
    storeId,
    reviewStatus: data.reviewStatus as FiscalProfileRecord['reviewStatus'],
    requiredTaxTypes: data.requiredTaxTypes as NonNullable<FiscalProfileRecord['requiredTaxTypes']>,
    pricingMode: data.pricingMode as FiscalProfileRecord['pricingMode'],
    updatedAt: data.updatedAt,
  };
}

export async function saveFiscalProfile(profile: FiscalProfileRecord, updatedBy: string): Promise<FiscalProfileRecord> {
  const { storeId, reviewStatus, reviewedBy, reviewedAt, updatedAt, ...data } = profile;
  const { data: row, error } = await getSupabaseClient()
    .from('fiscal_profiles')
    .upsert({
      store_id: storeId,
      review_status: reviewStatus,
      data,
      reviewed_by: reviewedBy ?? null,
      reviewed_at: reviewedAt ?? null,
      updated_by: updatedBy,
      updated_at: updatedAt,
    }, { onConflict: 'store_id' })
    .select('store_id, review_status, data, reviewed_by, reviewed_at, updated_at')
    .single();
  if (error) raise(error, 'Could not save fiscal profile');
  return mapProfile(row as ProfileRow);
}

export async function listFiscalRules(storeId: string): Promise<FiscalTaxRuleRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('fiscal_tax_rules')
    .select(RULE_COLUMNS)
    .eq('store_id', storeId)
    .order('rule_id')
    .order('version', { ascending: false });
  if (error) raise(error, 'Could not load fiscal tax rules');
  return (data ?? []).map((row) => mapRule(row as RuleRow));
}

export async function insertFiscalTaxRule(rule: FiscalTaxRuleRecord): Promise<FiscalTaxRuleRecord> {
  const { data, error } = await getSupabaseClient()
    .from('fiscal_tax_rules')
    .insert({
      store_id: rule.storeId,
      rule_id: rule.id,
      version: rule.version,
      name: rule.name,
      tax_type: rule.taxType,
      calculation_method: rule.calculationMethod,
      rate_ppm: rule.ratePpm ?? null,
      fixed_amount_millimes: rule.fixedAmountMillimes ?? null,
      fixed_amount_per_unit: rule.fixedAmountPerUnit ?? true,
      compound_with_prior_taxes: rule.compoundWithPriorTaxes ?? false,
      priority: rule.priority,
      effective_from: rule.effectiveFrom,
      effective_through: rule.effectiveThrough ?? null,
      status: rule.status,
      legal_reference: rule.legalReference ?? null,
      legal_reviewed: rule.legalReviewed ?? false,
      notes: rule.notes ?? null,
      created_by: rule.createdBy ?? null,
    })
    .select(RULE_COLUMNS)
    .single();
  if (error) raise(error, 'Could not create fiscal tax rule version');
  return mapRule(data as RuleRow);
}

export async function listFiscalAssignments(storeId: string): Promise<FiscalTaxAssignmentRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('catalog_item_tax_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('store_id', storeId)
    .order('effective_from', { ascending: false });
  if (error) raise(error, 'Could not load product fiscal classifications');
  return (data ?? []).map((row) => mapAssignment(row as AssignmentRow));
}

export async function insertFiscalAssignment(
  assignment: FiscalTaxAssignmentRecord,
): Promise<FiscalTaxAssignmentRecord> {
  const { data, error } = await getSupabaseClient()
    .from('catalog_item_tax_assignments')
    .insert({
      id: assignment.id,
      store_id: assignment.storeId,
      item_id: assignment.itemId ?? null,
      category_id: assignment.categoryId ?? null,
      tax_type: assignment.taxType,
      treatment: assignment.treatment,
      rule_id: assignment.ruleId ?? null,
      rule_version: assignment.ruleVersion ?? null,
      legal_reference: assignment.legalReference ?? null,
      evidence_reference: assignment.evidenceReference ?? null,
      note: assignment.note ?? null,
      effective_from: assignment.effectiveFrom,
      effective_through: assignment.effectiveThrough ?? null,
      created_by: assignment.createdBy ?? null,
    })
    .select(ASSIGNMENT_COLUMNS)
    .single();
  if (error) raise(error, 'Could not save product fiscal classification');
  return mapAssignment(data as AssignmentRow);
}
