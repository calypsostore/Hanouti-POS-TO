import { isSupabaseDriver } from '../../data/driver';
import {
  getFiscalProfile,
  getCheckoutFiscalProfile,
  insertFiscalAssignment,
  insertFiscalTaxRule,
  confirmFiscalTaxRule,
  listFiscalAssignments,
  listFiscalRules,
  saveFiscalProfile,
} from '../../data/repositories/fiscalRepository';
import { catalogService } from '../catalogService';
import type {
  FiscalProfileRecord,
  FiscalTaxAssignmentRecord,
  FiscalTaxRuleRecord,
} from '../../types/fiscal';
import { activityService } from '../activityService';
import { readData, writeData } from '../storage';
import { userService } from '../userService';

const getProfiles = () => readData<FiscalProfileRecord[]>('fiscal-profiles', []);
const getRules = () => readData<FiscalTaxRuleRecord[]>('fiscal-tax-rules', []);
const getAssignments = () => readData<FiscalTaxAssignmentRecord[]>('fiscal-tax-assignments', []);

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function assertStoreOwner(storeId: string, actorId: string): Promise<void> {
  const [store, actor] = await Promise.all([
    userService.getStore(storeId),
    userService.getUser(actorId),
  ]);
  if (!store || !actor || !actor.isActive || actor.role !== 'owner' || actor.id !== store.ownerId || actor.storeId !== storeId) {
    throw new Error('Only the active owner of this store can change its fiscal configuration.');
  }
}

function validateProfile(profile: FiscalProfileRecord): void {
  if (!profile.storeId.trim()) throw new Error('Fiscal profile needs a store.');
  if (profile.requiredTaxTypes &&
    (new Set(profile.requiredTaxTypes).size !== profile.requiredTaxTypes.length ||
      profile.requiredTaxTypes.some((taxType) => !['vat', 'consumption', 'other'].includes(taxType)))) {
    throw new Error('Configured line taxes must be unique VAT, consumption, or other line tax types.');
  }
  if (profile.reviewStatus === 'confirmed' && (!profile.reviewedBy || !profile.reviewedAt)) {
    throw new Error('Confirming a fiscal profile requires an owner and review timestamp.');
  }
  for (const [label, value] of Object.entries({
    legalName: profile.legalName,
    tradingName: profile.tradingName,
    taxId: profile.taxId,
    address: profile.address,
    activity: profile.activity,
    activityCategory: profile.activityCategory,
    legalForm: profile.legalForm,
    fiscalRegime: profile.fiscalRegime,
    reviewNotes: profile.reviewNotes,
  })) {
    if (value !== undefined && value.length > 500) throw new Error(`${label} is too long.`);
  }
}

export const fiscalService = {
  async getProfile(storeId: string): Promise<FiscalProfileRecord | undefined> {
    if (isSupabaseDriver()) return getFiscalProfile(storeId);
    return getProfiles().find((profile) => profile.storeId === storeId);
  },

  async getCheckoutProfile(storeId: string): Promise<FiscalProfileRecord | undefined> {
    if (isSupabaseDriver()) return getCheckoutFiscalProfile(storeId);
    return getProfiles().find((profile) => profile.storeId === storeId);
  },

  async listRules(storeId: string): Promise<FiscalTaxRuleRecord[]> {
    if (isSupabaseDriver()) return listFiscalRules(storeId);
    return getRules().filter((rule) => rule.storeId === storeId);
  },

  async listAssignments(storeId: string): Promise<FiscalTaxAssignmentRecord[]> {
    if (isSupabaseDriver()) return listFiscalAssignments(storeId);
    return getAssignments().filter((assignment) => assignment.storeId === storeId);
  },

  async saveProfile(input: Omit<FiscalProfileRecord, 'updatedAt' | 'reviewedBy' | 'reviewedAt'> & {
    reviewedBy?: string;
    reviewedAt?: string;
  }, actorId: string): Promise<FiscalProfileRecord> {
    await assertStoreOwner(input.storeId, actorId);
    const previous = await this.getProfile(input.storeId);
    const now = new Date().toISOString();
    const profile: FiscalProfileRecord = {
      ...input,
      reviewedBy: input.reviewStatus === 'confirmed' ? actorId : undefined,
      reviewedAt: input.reviewStatus === 'confirmed' ? now : undefined,
      updatedAt: now,
    };
    validateProfile(profile);
    const saved = isSupabaseDriver()
      ? await saveFiscalProfile(profile, actorId)
      : (() => {
          const profiles = getProfiles().filter((candidate) => candidate.storeId !== profile.storeId);
          writeData('fiscal-profiles', [...profiles, profile]);
          return profile;
        })();
    await activityService.log({
      storeId: input.storeId,
      actorId,
      action: 'fiscal.profile_updated',
      summary: 'Updated the store fiscal profile.',
      entityType: 'fiscal_profile',
      entityId: input.storeId,
      meta: {
        before: { reviewStatus: previous?.reviewStatus },
        after: {
          reviewStatus: saved.reviewStatus,
          fieldsPresent: Object.entries(saved)
            .filter(([key, value]) => key !== 'storeId' && key !== 'updatedAt' && value !== undefined && value !== '')
            .map(([key]) => key),
        },
      },
    });
    return saved;
  },

  async createDraftRule(
    input: Omit<FiscalTaxRuleRecord, 'id' | 'version' | 'status' | 'legalReviewed' | 'createdAt' | 'createdBy'> & {
      id?: string;
    },
    actorId: string,
  ): Promise<FiscalTaxRuleRecord> {
    await assertStoreOwner(input.storeId, actorId);
    if (!input.name.trim() || input.name.length > 200 || !isDate(input.effectiveFrom) ||
      (input.effectiveThrough && !isDate(input.effectiveThrough)) ||
      (input.effectiveThrough && input.effectiveThrough < input.effectiveFrom)) {
      throw new Error('Fiscal tax rule name and effective dates are invalid.');
    }
    if (input.taxType === 'stamp' || input.taxType === 'withholding') {
      throw new Error(`${input.taxType} requires a dedicated document or settlement workflow and cannot be drafted as a line tax.`);
    }
    if (!Number.isSafeInteger(input.priority) || input.priority < 0) throw new Error('Tax rule priority must be a non-negative whole number.');
    if (input.calculationMethod === 'percentage' &&
      (!Number.isSafeInteger(input.ratePpm) || (input.ratePpm ?? 0) <= 0 || input.fixedAmountMillimes !== undefined)) {
      throw new Error('Percentage rules need a positive integer rate in ppm only.');
    }
    if (input.calculationMethod === 'fixed' &&
      (!Number.isSafeInteger(input.fixedAmountMillimes) || (input.fixedAmountMillimes ?? 0) <= 0 || input.ratePpm !== undefined)) {
      throw new Error('Fixed rules need a positive fixed millime amount only.');
    }

    const id = input.id?.trim() || `fiscal-rule-${crypto.randomUUID()}`;
    const versions = await this.listRules(input.storeId);
    const version = versions.filter((rule) => rule.id === id).reduce((max, rule) => Math.max(max, rule.version), 0) + 1;
    const rule: FiscalTaxRuleRecord = {
      ...input,
      id,
      version,
      status: 'draft',
      legalReviewed: false,
      createdAt: new Date().toISOString(),
      createdBy: actorId,
    };
    if (isSupabaseDriver()) {
      await insertFiscalTaxRule(rule);
    } else {
      writeData('fiscal-tax-rules', [...getRules(), rule]);
    }
    await activityService.log({
      storeId: rule.storeId,
      actorId,
      action: 'fiscal.tax_rule_drafted',
      summary: `Created draft fiscal tax rule "${rule.name}" version ${rule.version}.`,
      entityType: 'fiscal_tax_rule',
      entityId: `${rule.id}:${rule.version}`,
      meta: { after: { id: rule.id, version: rule.version, status: rule.status, taxType: rule.taxType, effectiveFrom: rule.effectiveFrom } },
    });
    return rule;
  },

  async confirmDraftRule(
    storeId: string,
    ruleId: string,
    version: number,
    legalReference: string,
    actorId: string,
  ): Promise<FiscalTaxRuleRecord> {
    await assertStoreOwner(storeId, actorId);
    const reference = legalReference.trim();
    if (!reference) throw new Error('A legal reference is required to activate a fiscal tax rule.');
    const rule = (await this.listRules(storeId)).find((candidate) =>
      candidate.id === ruleId && candidate.version === version);
    if (!rule || rule.status !== 'draft') {
      throw new Error('The requested tax rule is not an available draft.');
    }
    if (isSupabaseDriver()) {
      await confirmFiscalTaxRule(storeId, ruleId, version, reference);
    } else {
      const rules = getRules().map((candidate) =>
        candidate.storeId === storeId && candidate.id === ruleId && candidate.version === version
          ? { ...candidate, status: 'active' as const, legalReviewed: true, legalReference: reference }
          : candidate);
      writeData('fiscal-tax-rules', rules);
    }
    const confirmed = {
      ...rule,
      status: 'active' as const,
      legalReviewed: true,
      legalReference: reference,
    };
    await activityService.log({
      storeId,
      actorId,
      action: 'fiscal.tax_rule_confirmed',
      summary: `Owner confirmed fiscal tax rule "${rule.name}" version ${rule.version}.`,
      entityType: 'fiscal_tax_rule',
      entityId: `${ruleId}:${version}`,
      meta: { after: { status: 'active', legalReference: reference } },
    });
    return confirmed;
  },

  async createAssignment(
    input: Omit<FiscalTaxAssignmentRecord, 'id' | 'createdAt' | 'createdBy'>,
    actorId: string,
  ): Promise<FiscalTaxAssignmentRecord> {
    await assertStoreOwner(input.storeId, actorId);
    if ((!input.itemId && !input.categoryId) || (input.itemId && input.categoryId)) {
      throw new Error('A fiscal classification must target exactly one item or category.');
    }
    if (!isDate(input.effectiveFrom) || (input.effectiveThrough && !isDate(input.effectiveThrough)) ||
      (input.effectiveThrough && input.effectiveThrough < input.effectiveFrom)) {
      throw new Error('Fiscal classification effective dates are invalid.');
    }
    if (['exempt', 'outside_scope', 'suspended', 'special'].includes(input.treatment) &&
      !input.legalReference?.trim() && !input.evidenceReference?.trim()) {
      throw new Error('This fiscal treatment requires a legal or evidence reference.');
    }
    if (['taxable', 'special'].includes(input.treatment) && (!input.ruleId || !input.ruleVersion)) {
      throw new Error('Taxable and special treatments require a specific fiscal rule version.');
    }
    if (!['taxable', 'special'].includes(input.treatment) && (input.ruleId || input.ruleVersion)) {
      throw new Error('Only taxable and special treatments can reference a tax rule.');
    }
    if (input.itemId) {
      const item = await catalogService.listItems(input.storeId, undefined, '', true);
      if (!item.some((candidate) => candidate.id === input.itemId && candidate.storeId === input.storeId)) {
        throw new Error('Fiscal classification item does not belong to this store.');
      }
    } else if (input.categoryId) {
      const categories = await catalogService.listCategories(input.storeId, true);
      if (!categories.some((category) => category.id === input.categoryId && category.storeId === input.storeId)) {
        throw new Error('Fiscal classification category does not belong to this store.');
      }
    }
    if (input.ruleId && input.ruleVersion) {
      const rule = (await this.listRules(input.storeId)).find((candidate) =>
        candidate.id === input.ruleId && candidate.version === input.ruleVersion);
      if (!rule || rule.taxType !== input.taxType || rule.status !== 'active' || !rule.legalReviewed ||
        input.effectiveFrom < rule.effectiveFrom ||
        (rule.effectiveThrough && (!input.effectiveThrough || input.effectiveThrough > rule.effectiveThrough))) {
        throw new Error('Fiscal classification must reference a legally reviewed active rule covering its effective dates.');
      }
    }
    const existing = (await this.listAssignments(input.storeId)).filter((candidate) =>
      candidate.taxType === input.taxType &&
      candidate.itemId === input.itemId &&
      candidate.categoryId === input.categoryId);
    if (existing.some((candidate) =>
      (!input.effectiveThrough || candidate.effectiveFrom <= input.effectiveThrough) &&
      (!candidate.effectiveThrough || input.effectiveFrom <= candidate.effectiveThrough))) {
      throw new Error('This item/category already has an overlapping treatment for this tax type.');
    }
    const assignment: FiscalTaxAssignmentRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdBy: actorId,
    };
    if (isSupabaseDriver()) {
      await insertFiscalAssignment(assignment);
    } else {
      writeData('fiscal-tax-assignments', [...getAssignments(), assignment]);
    }
    await activityService.log({
      storeId: assignment.storeId,
      actorId,
      action: 'fiscal.product_classified',
      summary: `Recorded ${assignment.taxType} treatment "${assignment.treatment}".`,
      entityType: 'fiscal_tax_assignment',
      entityId: assignment.id,
      meta: { after: { taxType: assignment.taxType, treatment: assignment.treatment, itemId: assignment.itemId, categoryId: assignment.categoryId } },
    });
    return assignment;
  },
};
