import type {
  FiscalLineSnapshot,
  FiscalOrderSnapshot,
  FiscalTaxComponentSnapshot,
  FiscalTaxRuleRecord,
  FiscalTaxType,
  FiscalLineTaxInput,
  FiscalTreatmentAssignment,
} from '../../types/fiscal';

const RATE_DENOMINATOR = 1_000_000n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function assertMillimes(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number of millimes.`);
  }
}

function toSafeNumber(value: bigint, label: string): number {
  if (value < 0n || value > MAX_SAFE_BIGINT) throw new Error(`${label} exceeds the supported money range.`);
  return Number(value);
}

function addSafe(left: number, right: number, label: string): number {
  return toSafeNumber(BigInt(left) + BigInt(right), label);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function roundedRateAmount(baseMillimes: number, ratePpm: number): number {
  const numerator = BigInt(baseMillimes) * BigInt(ratePpm);
  return toSafeNumber((numerator + RATE_DENOMINATOR / 2n) / RATE_DENOMINATOR, 'Tax amount');
}

function divideRounded(numerator: bigint, denominator: bigint, label: string): number {
  if (denominator <= 0n) throw new Error(`${label} has an invalid denominator.`);
  return toSafeNumber((numerator + denominator / 2n) / denominator, label);
}

function extractInclusiveNetAmount(
  targetAmountMillimes: number,
  quantity: number,
  rules: FiscalTaxRuleRecord[],
): number {
  const percentageRules = rules.filter((rule) => rule.calculationMethod === 'percentage');
  if (rules.length !== percentageRules.length) {
    const fixedTax = rules.reduce((sum, rule) => {
      if (rule.calculationMethod !== 'fixed' || rule.fixedAmountMillimes === undefined) return sum;
      return sum + (rule.fixedAmountPerUnit === false ? rule.fixedAmountMillimes : rule.fixedAmountMillimes * quantity);
    }, 0);
    const net = targetAmountMillimes - fixedTax;
    return net >= 0 ? net : 0;
  }
  const combinedRatePpm = percentageRules.reduce((sum, rule) => sum + BigInt(rule.ratePpm ?? 0), 0n);
  if (combinedRatePpm === 0n) return targetAmountMillimes;
  const denominator = RATE_DENOMINATOR + combinedRatePpm;
  return divideRounded(BigInt(targetAmountMillimes) * RATE_DENOMINATOR, denominator, 'Inclusive net amount');
}

function validateRule(rule: FiscalTaxRuleRecord, transactionDate: string): void {
  if (!rule.id.trim() || !rule.name.trim() || !rule.storeId.trim()) throw new Error('Every tax rule needs an ID, name, and store.');
  if (rule.taxType === 'stamp' || rule.taxType === 'withholding') {
    throw new Error(`${rule.taxType} is not a line-level sales tax and must use its dedicated document/settlement workflow.`);
  }
  if (!Number.isSafeInteger(rule.version) || rule.version < 1) throw new Error(`Tax rule ${rule.id} has an invalid version.`);
  if (!Number.isSafeInteger(rule.priority) || rule.priority < 0) throw new Error(`Tax rule ${rule.id} has an invalid priority.`);
  if (rule.status !== 'active') throw new Error(`Tax rule ${rule.id} is not active.`);
  if (rule.legalReviewed !== true) throw new Error(`Tax rule ${rule.id} has not been legally reviewed.`);
  if (!isValidDate(rule.effectiveFrom) || (rule.effectiveThrough && !isValidDate(rule.effectiveThrough))) {
    throw new Error(`Tax rule ${rule.id} has an invalid effective date.`);
  }
  if (rule.effectiveThrough && rule.effectiveThrough < rule.effectiveFrom) {
    throw new Error(`Tax rule ${rule.id} ends before it becomes effective.`);
  }
  if (transactionDate < rule.effectiveFrom || (rule.effectiveThrough && transactionDate > rule.effectiveThrough)) {
    throw new Error(`Tax rule ${rule.id} is not effective on ${transactionDate}.`);
  }
  if (rule.calculationMethod === 'percentage') {
    if (!Number.isSafeInteger(rule.ratePpm) || (rule.ratePpm ?? 0) <= 0 || rule.fixedAmountMillimes !== undefined) {
      throw new Error(`Percentage tax rule ${rule.id} needs a positive integer rate in ppm only.`);
    }
  } else if (rule.calculationMethod === 'fixed') {
    if (!Number.isSafeInteger(rule.fixedAmountMillimes) || (rule.fixedAmountMillimes ?? 0) <= 0 ||
      rule.ratePpm !== undefined) {
      throw new Error(`Fixed tax rule ${rule.id} needs a positive fixed millime amount only.`);
    }
  } else {
    throw new Error(`Tax rule ${rule.id} uses an unsupported calculation method.`);
  }
}

function calculateComponents(
  netAmountMillimes: number,
  quantity: number,
  rules: FiscalTaxRuleRecord[],
  treatments: Map<FiscalTaxType, FiscalTreatmentAssignment>,
): FiscalTaxComponentSnapshot[] {
  let priorTaxesMillimes = 0;
  const components: FiscalTaxComponentSnapshot[] = [];
  for (const rule of rules) {
    const treatmentAssignment = treatments.get(rule.taxType);
    const treatment = treatmentAssignment?.treatment;
    if (treatment !== 'taxable' && treatment !== 'special') {
      throw new Error(`Tax rule ${rule.id} conflicts with its ${rule.taxType} treatment.`);
    }
    const taxableBaseMillimes = rule.compoundWithPriorTaxes
      ? addSafe(netAmountMillimes, priorTaxesMillimes, 'Taxable base')
      : netAmountMillimes;
    const amountMillimes = rule.calculationMethod === 'percentage'
      ? roundedRateAmount(taxableBaseMillimes, rule.ratePpm!)
      : toSafeNumber(BigInt(rule.fixedAmountMillimes!) * BigInt(rule.fixedAmountPerUnit === false ? 1 : quantity), 'Fixed tax amount');
    priorTaxesMillimes = addSafe(priorTaxesMillimes, amountMillimes, 'Tax total');
    components.push({
      taxType: rule.taxType,
      treatment,
      ruleId: rule.id,
      ruleVersion: rule.version,
      ruleName: rule.name,
      calculationMethod: rule.calculationMethod,
      ratePpm: rule.ratePpm,
      fixedAmountMillimes: rule.fixedAmountMillimes,
      taxableBaseMillimes,
      amountMillimes,
      legalReference: rule.legalReference,
      evidenceReference: treatmentAssignment?.evidenceReference,
    });
  }
  return components;
}

function resolveLine(input: FiscalLineTaxInput, transactionDate: string): FiscalLineSnapshot {
  if (!input.lineId.trim() || !input.itemId.trim()) throw new Error('Every fiscal line needs a line and item ID.');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error(`Line ${input.lineId} has an invalid quantity.`);
  assertMillimes(input.unitAmountMillimes, `Line ${input.lineId} unit amount`);
  const discountMillimes = input.discountMillimes ?? 0;
  assertMillimes(discountMillimes, `Line ${input.lineId} discount`);
  if (!['exclusive', 'inclusive'].includes(input.priceMode)) throw new Error(`Line ${input.lineId} has an invalid price mode.`);
  if (new Set(input.requiredTaxTypes).size !== input.requiredTaxTypes.length) {
    throw new Error(`Line ${input.lineId} repeats a required tax type.`);
  }
  if (new Set(input.treatments.map((treatment) => treatment.taxType)).size !== input.treatments.length) {
    throw new Error(`Line ${input.lineId} has ambiguous tax treatments.`);
  }

  const treatments = new Map(input.treatments.map((treatment) => [treatment.taxType, treatment]));
  for (const taxType of input.requiredTaxTypes) {
    const treatment = treatments.get(taxType);
    if (!treatment || treatment.treatment === 'unconfigured') {
      throw new Error(`Line ${input.lineId} needs an explicit ${taxType} treatment.`);
    }
  }
  for (const treatment of input.treatments) {
    if (treatment.treatment === 'unconfigured') throw new Error(`Line ${input.lineId} has an unconfigured ${treatment.taxType} treatment.`);
    if (['exempt', 'outside_scope', 'suspended', 'special'].includes(treatment.treatment) &&
      !treatment.legalReference?.trim() && !treatment.evidenceReference?.trim()) {
      throw new Error(`Line ${input.lineId} needs legal/evidence documentation for ${treatment.taxType} ${treatment.treatment}.`);
    }
  }

  const rulesByTaxType = new Map<FiscalTaxType, FiscalTaxRuleRecord[]>();
  const ruleIds = new Set<string>();
  const rulePriorities = new Set<number>();
  for (const rule of input.rules) {
    validateRule(rule, transactionDate);
    if (ruleIds.has(rule.id)) throw new Error(`Line ${input.lineId} has duplicate tax rule ${rule.id}.`);
    if (rulePriorities.has(rule.priority)) throw new Error(`Line ${input.lineId} has ambiguous tax rules at priority ${rule.priority}.`);
    ruleIds.add(rule.id);
    rulePriorities.add(rule.priority);
    const group = rulesByTaxType.get(rule.taxType) ?? [];
    group.push(rule);
    rulesByTaxType.set(rule.taxType, group);
  }

  for (const taxType of input.requiredTaxTypes) {
    const treatment = treatments.get(taxType)!;
    const rules = (rulesByTaxType.get(taxType) ?? []).sort((left, right) => left.priority - right.priority);
    if (treatment.treatment === 'taxable' && rules.length === 0) {
      throw new Error(`Line ${input.lineId} has no active ${taxType} rule.`);
    }
    if (treatment.treatment === 'special' && rules.length === 0) {
      throw new Error(`Line ${input.lineId} has no configured ${taxType} rule for its special treatment.`);
    }
    if (treatment.treatment !== 'taxable' && treatment.treatment !== 'special' && rules.length > 0) {
      throw new Error(`Line ${input.lineId} has a ${taxType} rule that conflicts with its ${treatment.treatment} treatment.`);
    }
  }
  for (const taxType of rulesByTaxType.keys()) {
    if (!input.requiredTaxTypes.includes(taxType)) {
      throw new Error(`Line ${input.lineId} has a ${taxType} rule without a required tax assignment.`);
    }
  }
  for (const treatment of input.treatments) {
    if (!input.requiredTaxTypes.includes(treatment.taxType)) {
      throw new Error(`Line ${input.lineId} has a ${treatment.taxType} treatment without a required tax assignment.`);
    }
  }

  const grossBeforeDiscount = toSafeNumber(BigInt(input.unitAmountMillimes) * BigInt(input.quantity), 'Line gross amount');
  if (discountMillimes > grossBeforeDiscount) throw new Error(`Line ${input.lineId} discount exceeds its price.`);
  const targetAmountMillimes = grossBeforeDiscount - discountMillimes;

  const calculateForNet = (netAmountMillimes: number) => {
    const components: FiscalTaxComponentSnapshot[] = [];
    const orderedRules = [...input.rules].sort((left, right) => left.priority - right.priority);
    components.push(...calculateComponents(netAmountMillimes, input.quantity, orderedRules, treatments));
    for (const taxType of input.requiredTaxTypes) {
      const treatment = treatments.get(taxType)!;
      if (treatment.treatment !== 'taxable' && treatment.treatment !== 'special') {
        if (treatment.treatment === 'unconfigured') {
          throw new Error(`Line ${input.lineId} has an unconfigured ${taxType} treatment.`);
        }
        components.push({
          taxType,
          treatment: treatment.treatment,
          taxableBaseMillimes: netAmountMillimes,
          amountMillimes: 0,
          legalReference: treatment.legalReference,
          evidenceReference: treatment.evidenceReference,
        });
      }
    }
    const totalTaxMillimes = components.reduce((sum, component) => addSafe(sum, component.amountMillimes, 'Line tax total'), 0);
    return { components, totalTaxMillimes, totalAmountMillimes: addSafe(netAmountMillimes, totalTaxMillimes, 'Line total') };
  };

  let netAmountMillimes = targetAmountMillimes;
  let calculation = calculateForNet(netAmountMillimes);
  if (input.priceMode === 'inclusive') {
    netAmountMillimes = extractInclusiveNetAmount(targetAmountMillimes, input.quantity, input.rules);
    calculation = calculateForNet(netAmountMillimes);
    const calculatedTaxBeforeAllocation = calculation.totalTaxMillimes;
    if (calculatedTaxBeforeAllocation !== targetAmountMillimes - netAmountMillimes) {
      const taxableComponents = calculation.components.filter((component) =>
        component.treatment === 'taxable' || component.treatment === 'special');
      const residualTax = targetAmountMillimes - netAmountMillimes;
      if (taxableComponents.length === 0) {
        throw new Error(`Line ${input.lineId} inclusive price has no taxable component to reconcile.`);
      }
      let remaining = residualTax;
      const lastTaxableIndex = calculation.components.map((component) =>
        component.treatment === 'taxable' || component.treatment === 'special')
        .lastIndexOf(true);
      for (const component of taxableComponents) {
        const index = calculation.components.indexOf(component);
        if (index === lastTaxableIndex) {
          calculation.components[index] = { ...component, amountMillimes: remaining };
        } else {
          const allocated = Math.min(component.amountMillimes, remaining);
          calculation.components[index] = { ...component, amountMillimes: allocated };
          remaining -= allocated;
        }
      }
      calculation.totalTaxMillimes = residualTax;
      calculation.totalAmountMillimes = targetAmountMillimes;
    }
  }

  return {
    lineId: input.lineId,
    itemId: input.itemId,
    categoryId: input.categoryId,
    quantity: input.quantity,
    unitAmountMillimes: input.unitAmountMillimes,
    discountMillimes,
    priceMode: input.priceMode,
    netAmountMillimes,
    taxes: calculation.components,
    totalTaxMillimes: calculation.totalTaxMillimes,
    totalAmountMillimes: calculation.totalAmountMillimes,
  };
}

export function calculateFiscalOrder(
  storeId: string,
  transactionDate: string,
  lines: FiscalLineTaxInput[],
): FiscalOrderSnapshot {
  if (!storeId.trim()) throw new Error('Fiscal calculations require a store ID.');
  if (!isValidDate(transactionDate)) throw new Error('Fiscal transaction date must be a valid YYYY-MM-DD date.');
  if (lines.length === 0) throw new Error('A fiscal calculation needs at least one line.');
  const lineIds = new Set<string>();
  const snapshots = lines.map((line) => {
    if (lineIds.has(line.lineId)) throw new Error(`Duplicate fiscal line ID ${line.lineId}.`);
    lineIds.add(line.lineId);
    for (const rule of line.rules) {
      if (rule.storeId !== storeId) throw new Error(`Tax rule ${rule.id} belongs to another store.`);
    }
    return resolveLine(line, transactionDate);
  });
  const netAmountMillimes = snapshots.reduce((sum, line) => addSafe(sum, line.netAmountMillimes, 'Order net total'), 0);
  const totalTaxMillimes = snapshots.reduce((sum, line) => addSafe(sum, line.totalTaxMillimes, 'Order tax total'), 0);
  const totalAmountMillimes = snapshots.reduce((sum, line) => addSafe(sum, line.totalAmountMillimes, 'Order total'), 0);
  if (addSafe(netAmountMillimes, totalTaxMillimes, 'Order reconciliation') !== totalAmountMillimes) {
    throw new Error('Fiscal order totals do not reconcile.');
  }
  return {
    schemaVersion: 1,
    calculationVersion: 'millime-tax-v1',
    currency: 'TND',
    storeId,
    transactionDate,
    roundingPolicy: 'nearest-millime-half-up',
    lines: snapshots,
    netAmountMillimes,
    totalTaxMillimes,
    totalAmountMillimes,
  };
}
