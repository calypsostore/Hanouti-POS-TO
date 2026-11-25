import type { OrderLineRecord } from '../../types/domain';
import type {
  FiscalOrderSnapshot,
  FiscalProfileRecord,
  FiscalTaxAssignmentRecord,
  FiscalTaxRuleRecord,
  FiscalTaxType,
} from '../../types/fiscal';
import { calculateFiscalOrder } from './taxEngine';

const LINE_TAX_TYPES: FiscalTaxType[] = ['vat', 'consumption', 'other'];

function isEffective(date: string, from: string, through?: string): boolean {
  return from <= date && (!through || through >= date);
}

function resolveAssignment(
  storeId: string,
  item: OrderLineRecord,
  taxType: FiscalTaxType,
  date: string,
  assignments: FiscalTaxAssignmentRecord[],
): FiscalTaxAssignmentRecord {
  const effective = assignments.filter((assignment) =>
    assignment.storeId === storeId &&
    assignment.taxType === taxType &&
    isEffective(date, assignment.effectiveFrom, assignment.effectiveThrough));
  const itemMatches = effective.filter((assignment) => assignment.itemId === item.itemId);
  const matches = itemMatches.length ? itemMatches : effective.filter((assignment) =>
    !assignment.itemId && assignment.categoryId === item.categoryId);
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `Order line ${item.itemId} has ambiguous ${taxType} classifications.`
      : `Order line ${item.itemId} needs an effective ${taxType} classification.`);
  }
  return matches[0];
}

export function calculateFiscalCheckoutSnapshot(input: {
  storeId: string;
  transactionDate: string;
  lines: OrderLineRecord[];
  profile?: FiscalProfileRecord;
  rules: FiscalTaxRuleRecord[];
  assignments: FiscalTaxAssignmentRecord[];
}): FiscalOrderSnapshot | undefined {
  const requiredTaxTypes = input.profile?.requiredTaxTypes ?? [];
  const hasActiveRules = input.rules.some((rule) =>
    rule.storeId === input.storeId &&
    rule.status === 'active' &&
    isEffective(input.transactionDate, rule.effectiveFrom, rule.effectiveThrough));
  if (requiredTaxTypes.length === 0) {
    if (hasActiveRules) {
      throw new Error('Active fiscal rules exist, but the store has no configured line-tax types.');
    }
    return undefined;
  }
  if (input.profile?.storeId !== input.storeId) {
    throw new Error('Fiscal profile belongs to another store.');
  }
  if (input.profile.reviewStatus !== 'confirmed') {
    throw new Error('Confirm the store fiscal profile before applying configured line taxes.');
  }
  if (new Set(requiredTaxTypes).size !== requiredTaxTypes.length ||
    requiredTaxTypes.some((taxType) => !LINE_TAX_TYPES.includes(taxType))) {
    throw new Error('Configured line taxes contain a duplicate or unsupported tax type.');
  }
  if (!input.lines.length) throw new Error('A fiscal calculation needs at least one order line.');

  const lines = input.lines.map((line, index) => {
    const resolved = requiredTaxTypes.map((taxType) => ({
      taxType,
      assignment: resolveAssignment(
        input.storeId,
        line,
        taxType,
        input.transactionDate,
        input.assignments,
      ),
    }));
    const treatments = resolved.map(({ taxType, assignment }) => ({
      taxType,
      treatment: assignment.treatment,
      legalReference: assignment.legalReference,
      evidenceReference: assignment.evidenceReference,
    }));
    const rules = resolved.flatMap(({ taxType, assignment }) => {
      if (!assignment.ruleId || !assignment.ruleVersion) return [];
      const rule = input.rules.find((candidate) =>
        candidate.storeId === input.storeId &&
        candidate.id === assignment.ruleId &&
        candidate.version === assignment.ruleVersion);
      if (!rule) {
        throw new Error(`Fiscal classification for ${line.itemId} references a missing ${taxType} rule version.`);
      }
      return [rule];
    });
    return {
      lineId: `line-${index + 1}`,
      itemId: line.itemId,
      categoryId: line.categoryId,
      quantity: line.quantity,
      unitAmountMillimes: line.unitPriceMillimes,
      priceMode: input.profile?.pricingMode ?? 'inclusive',
      requiredTaxTypes,
      treatments,
      rules,
    };
  });
  return calculateFiscalOrder(input.storeId, input.transactionDate, lines);
}
