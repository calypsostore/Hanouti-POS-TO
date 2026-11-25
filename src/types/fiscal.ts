export type FiscalReviewStatus = 'unconfigured' | 'draft' | 'review_required' | 'confirmed';
export type FiscalTaxType = 'vat' | 'consumption' | 'stamp' | 'withholding' | 'other';
export type FiscalTaxTreatment = 'unconfigured' | 'taxable' | 'exempt' | 'outside_scope' | 'suspended' | 'special';
export type FiscalRuleStatus = 'draft' | 'active' | 'retired';
export type FiscalCalculationMethod = 'percentage' | 'fixed';
export type FiscalPriceMode = 'exclusive' | 'inclusive';

export interface FiscalProfileRecord {
  storeId: string;
  reviewStatus: FiscalReviewStatus;
  legalName?: string;
  tradingName?: string;
  taxId?: string;
  address?: string;
  activity?: string;
  activityCategory?: string;
  legalForm?: string;
  fiscalRegime?: string;
  vatStatus?: 'unknown' | 'registered' | 'not_registered' | 'exempt' | 'suspended';
  declarationPeriod?: 'monthly' | 'quarterly' | 'annual' | 'custom' | 'unknown';
  invoicePrefix?: string;
  pricingMode?: FiscalPriceMode;
  requiredTaxTypes?: FiscalTaxType[];
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  updatedAt: string;
}

export interface FiscalTaxRuleRecord {
  id: string;
  storeId: string;
  version: number;
  name: string;
  taxType: FiscalTaxType;
  calculationMethod: FiscalCalculationMethod;
  ratePpm?: number;
  fixedAmountMillimes?: number;
  fixedAmountPerUnit?: boolean;
  compoundWithPriorTaxes?: boolean;
  priority: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  status: FiscalRuleStatus;
  legalReference?: string;
  legalReviewed?: boolean;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export interface FiscalTreatmentAssignment {
  taxType: FiscalTaxType;
  treatment: FiscalTaxTreatment;
  legalReference?: string;
  evidenceReference?: string;
  note?: string;
}

export interface FiscalTaxAssignmentRecord extends FiscalTreatmentAssignment {
  id: string;
  storeId: string;
  itemId?: string;
  categoryId?: string;
  ruleId?: string;
  ruleVersion?: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  createdAt: string;
  createdBy?: string;
}

export interface FiscalLineTaxInput {
  lineId: string;
  itemId: string;
  categoryId?: string;
  quantity: number;
  unitAmountMillimes: number;
  discountMillimes?: number;
  priceMode: FiscalPriceMode;
  requiredTaxTypes: FiscalTaxType[];
  treatments: FiscalTreatmentAssignment[];
  rules: FiscalTaxRuleRecord[];
}

export interface FiscalTaxComponentSnapshot {
  taxType: FiscalTaxType;
  treatment: Exclude<FiscalTaxTreatment, 'unconfigured'>;
  ruleId?: string;
  ruleVersion?: number;
  ruleName?: string;
  calculationMethod?: FiscalCalculationMethod;
  ratePpm?: number;
  fixedAmountMillimes?: number;
  taxableBaseMillimes: number;
  amountMillimes: number;
  legalReference?: string;
  evidenceReference?: string;
}

export interface FiscalLineSnapshot {
  lineId: string;
  itemId: string;
  categoryId?: string;
  quantity: number;
  unitAmountMillimes: number;
  discountMillimes: number;
  priceMode: FiscalPriceMode;
  netAmountMillimes: number;
  taxes: FiscalTaxComponentSnapshot[];
  totalTaxMillimes: number;
  totalAmountMillimes: number;
}

export interface FiscalOrderSnapshot {
  schemaVersion: 1;
  calculationVersion: 'millime-tax-v1';
  currency: 'TND';
  storeId: string;
  transactionDate: string;
  roundingPolicy: 'nearest-millime-half-up';
  lines: FiscalLineSnapshot[];
  netAmountMillimes: number;
  totalTaxMillimes: number;
  totalAmountMillimes: number;
}

export interface FiscalDocumentRecord {
  id: string;
  storeId: string;
  orderId?: string;
  documentType: 'invoice' | 'detailed_invoice' | 'quote' | 'purchase_order' | 'delivery_note' | 'credit_note' | 'other';
  documentNumber?: string;
  status: 'draft' | 'issued' | 'cancelled' | 'corrected';
  issuedAt?: string;
  correctsDocumentId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
}

export interface FiscalTrackingRecord {
  id: string;
  storeId: string;
  recordType: 'declaration' | 'payment' | 'notice' | 'certificate' | 'legal_document' | 'compliance_note';
  status: 'draft' | 'prepared' | 'reviewed' | 'filed' | 'paid' | 'pending' | 'overdue' | 'not_applicable';
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  legalReference?: string;
  evidenceReference?: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export interface FiscalTaxReportLine {
  taxType: FiscalTaxType;
  treatment: Exclude<FiscalTaxTreatment, 'unconfigured'>;
  ruleId?: string;
  ruleVersion?: number;
  taxableBaseMillimes: number;
  amountMillimes: number;
}

export interface FiscalReportSummary {
  completedOrderCount: number;
  ordersWithFiscalSnapshot: number;
  ordersMissingFiscalSnapshot: number;
  voidedOrderCount: number;
  voidedOrdersWithFiscalSnapshot: number;
  voidedOrdersMissingFiscalSnapshot: number;
  netAmountMillimes: number;
  taxAmountMillimes: number;
  grossAmountMillimes: number;
  taxes: FiscalTaxReportLine[];
  reversedNetAmountMillimes: number;
  reversedTaxAmountMillimes: number;
  reversedGrossAmountMillimes: number;
  reversedTaxes: FiscalTaxReportLine[];
}

function isNonNegativeMillimes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isFiscalOrderSnapshot(value: unknown): value is FiscalOrderSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1 || snapshot.calculationVersion !== 'millime-tax-v1' ||
    snapshot.currency !== 'TND' || typeof snapshot.storeId !== 'string' || !snapshot.storeId ||
    typeof snapshot.transactionDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.transactionDate) ||
    snapshot.roundingPolicy !== 'nearest-millime-half-up' ||
    !Array.isArray(snapshot.lines) || snapshot.lines.length === 0 || !isNonNegativeMillimes(snapshot.netAmountMillimes) ||
    !isNonNegativeMillimes(snapshot.totalTaxMillimes) || !isNonNegativeMillimes(snapshot.totalAmountMillimes)) {
    return false;
  }
  const parsedDate = new Date(`${snapshot.transactionDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== snapshot.transactionDate) return false;

  let netAmountMillimes = 0;
  let totalTaxMillimes = 0;
  let totalAmountMillimes = 0;
  const lineIds = new Set<string>();
  for (const rawLine of snapshot.lines) {
    if (!rawLine || typeof rawLine !== 'object') return false;
    const line = rawLine as Record<string, unknown>;
    if (typeof line.lineId !== 'string' || !line.lineId || lineIds.has(line.lineId) ||
      typeof line.itemId !== 'string' || !line.itemId ||
      !Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1 ||
      !isNonNegativeMillimes(line.unitAmountMillimes) || !isNonNegativeMillimes(line.discountMillimes) ||
      !isNonNegativeMillimes(line.netAmountMillimes) || !isNonNegativeMillimes(line.totalTaxMillimes) ||
      !isNonNegativeMillimes(line.totalAmountMillimes) ||
      !['exclusive', 'inclusive'].includes(String(line.priceMode)) || !Array.isArray(line.taxes)) {
      return false;
    }
    lineIds.add(line.lineId);
    let lineTaxMillimes = 0;
    for (const rawTax of line.taxes) {
      if (!rawTax || typeof rawTax !== 'object') return false;
      const tax = rawTax as Record<string, unknown>;
      if (!isNonNegativeMillimes(tax.taxableBaseMillimes) || !isNonNegativeMillimes(tax.amountMillimes) ||
        !['vat', 'consumption', 'stamp', 'withholding', 'other'].includes(String(tax.taxType)) ||
        !['taxable', 'exempt', 'outside_scope', 'suspended', 'special'].includes(String(tax.treatment))) return false;
      lineTaxMillimes += tax.amountMillimes;
    }
    const grossAmount = (line.unitAmountMillimes as number) * (line.quantity as number);
    if (!Number.isSafeInteger(grossAmount) || line.discountMillimes > grossAmount) return false;
    if (lineTaxMillimes !== line.totalTaxMillimes ||
      line.netAmountMillimes + line.totalTaxMillimes !== line.totalAmountMillimes ||
      (line.priceMode === 'exclusive' && line.netAmountMillimes !== grossAmount - (line.discountMillimes as number)) ||
      (line.priceMode === 'inclusive' && line.totalAmountMillimes !== grossAmount - (line.discountMillimes as number))) return false;
    netAmountMillimes += line.netAmountMillimes;
    totalTaxMillimes += line.totalTaxMillimes;
    totalAmountMillimes += line.totalAmountMillimes;
  }
  return Number.isSafeInteger(netAmountMillimes) && Number.isSafeInteger(totalTaxMillimes) &&
    Number.isSafeInteger(totalAmountMillimes) &&
    netAmountMillimes === snapshot.netAmountMillimes &&
    totalTaxMillimes === snapshot.totalTaxMillimes &&
    totalAmountMillimes === snapshot.totalAmountMillimes &&
    netAmountMillimes + totalTaxMillimes === totalAmountMillimes;
}
