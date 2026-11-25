import { useEffect, useState, type FormEvent } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { PageHeader } from '../components/layout';
import { catalogService } from '../services/catalogService';
import { fiscalService } from '../services/fiscal/fiscalService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CategoryRecord, CatalogItemRecord } from '../types/domain';
import type {
  FiscalProfileRecord,
  FiscalTaxAssignmentRecord,
  FiscalTaxRuleRecord,
  FiscalTaxType,
} from '../types/fiscal';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function inputClass(): string {
  return 'mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 text-on-surface';
}

function rateToPpm(value: string): number {
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(value)) throw new Error('Enter a percentage with up to four decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const ppm = Number(whole) * 10_000 + Number(fraction.padEnd(4, '0'));
  if (!Number.isSafeInteger(ppm) || ppm < 1) throw new Error('Percentage must be greater than zero.');
  return ppm;
}

function amountToMillimes(value: string): number {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error('Enter an amount with up to three decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is outside the supported range.');
  return Number(amount);
}

export function OwnerFiscalScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [storeName, setStoreName] = useState('');
  const [profile, setProfile] = useState<FiscalProfileRecord>({
    storeId,
    reviewStatus: 'draft',
    updatedAt: '',
    pricingMode: 'inclusive',
    vatStatus: 'unknown',
    declarationPeriod: 'unknown',
  });
  const [rules, setRules] = useState<FiscalTaxRuleRecord[]>([]);
  const [assignments, setAssignments] = useState<FiscalTaxAssignmentRecord[]>([]);
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [ruleName, setRuleName] = useState('Standard VAT');
  const [taxType, setTaxType] = useState<FiscalTaxType>('vat');
  const [calculationMethod, setCalculationMethod] = useState<'percentage' | 'fixed'>('percentage');
  const [rateValue, setRateValue] = useState('19');
  const [activationReference, setActivationReference] = useState('');
  const [priority, setPriority] = useState('10');
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey());
  const [compound, setCompound] = useState(false);
  const [targetType, setTargetType] = useState<'item' | 'category'>('item');
  const [targetId, setTargetId] = useState('');
  const [assignmentTaxType, setAssignmentTaxType] = useState<FiscalTaxType>('vat');
  const [treatment, setTreatment] = useState<FiscalTaxAssignmentRecord['treatment']>('exempt');
  const [assignmentRule, setAssignmentRule] = useState('');
  const [legalReference, setLegalReference] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [assignmentDate, setAssignmentDate] = useState(todayKey());
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [savedProfile, savedRules, savedAssignments, catalogItems, catalogCategories, store] = await Promise.all([
          fiscalService.getProfile(storeId),
          fiscalService.listRules(storeId),
          fiscalService.listAssignments(storeId),
          catalogService.listItems(storeId, undefined, '', true),
          catalogService.listCategories(storeId, true),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        if (savedProfile) setProfile(savedProfile);
        else setProfile((current) => ({ ...current, storeId }));
        setRules(savedRules);
        setAssignments(savedAssignments);
        setItems(catalogItems);
        setCategories(catalogCategories);
        setTargetId((current) => current || catalogItems[0]?.id || catalogCategories[0]?.id || '');
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        console.error('Unable to load fiscal configuration.', loadError);
        if (active) setError('Unable to load fiscal configuration. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    };
    if (storeId) void load();
    return () => { active = false; };
  }, [storeId]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      const { updatedAt: _updatedAt, reviewedBy: _reviewedBy, reviewedAt: _reviewedAt, ...input } = profile;
      const saved = await fiscalService.saveProfile(input, user.id);
      setProfile(saved);
      setNotice('Fiscal profile saved. Have the legal details reviewed by a Tunisian tax professional before relying on them.');
    } catch (saveError) {
      console.error('Unable to save fiscal profile.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save fiscal profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const createRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setSavingRule(true);
    setError('');
    setNotice('');
    try {
      const common = {
        storeId,
        name: ruleName.trim(),
        taxType,
        calculationMethod,
        priority: Number(priority),
        effectiveFrom,
        compoundWithPriorTaxes: compound,
        fixedAmountPerUnit: true,
        ...(calculationMethod === 'percentage' ? { ratePpm: rateToPpm(rateValue) } : { fixedAmountMillimes: amountToMillimes(rateValue) }),
      };
      const saved = await fiscalService.createDraftRule(common, user.id);
      setRules((current) => [...current, saved].sort((left, right) => left.priority - right.priority));
      setRuleName('Standard VAT');
      setRateValue('19');
      setNotice('Draft rule saved. Owner confirmation and a legal reference are required before checkout can apply it.');
    } catch (saveError) {
      console.error('Unable to save fiscal tax rule.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save fiscal tax rule.');
    } finally {
      setSavingRule(false);
    }
  };

  const createAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !targetId) return;
    setSavingAssignment(true);
    setError('');
    setNotice('');
    try {
      const selectedRule = rules.find((rule) => `${rule.id}:${rule.version}` === assignmentRule);
      const saved = await fiscalService.createAssignment({
        storeId,
        ...(targetType === 'item' ? { itemId: targetId } : { categoryId: targetId }),
        taxType: assignmentTaxType,
        treatment,
        ...(selectedRule ? { ruleId: selectedRule.id, ruleVersion: selectedRule.version } : {}),
        legalReference: legalReference.trim() || undefined,
        evidenceReference: evidenceReference.trim() || undefined,
        effectiveFrom: assignmentDate,
      }, user.id);
      setAssignments((current) => [saved, ...current]);
      setNotice('Product classification saved. Checkout uses it only for an effective tax type with an active, reviewed rule.');
    } catch (saveError) {
      console.error('Unable to save product fiscal classification.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save product fiscal classification.');
    } finally {
      setSavingAssignment(false);
    }
  };

  const confirmRule = async (rule: FiscalTaxRuleRecord) => {
    if (!user) return;
    setSavingRule(true);
    setError('');
    setNotice('');
    try {
      const confirmed = await fiscalService.confirmDraftRule(storeId, rule.id, rule.version, activationReference, user.id);
      setRules((current) => current.map((candidate) =>
        candidate.id === confirmed.id && candidate.version === confirmed.version ? confirmed : candidate));
      setActivationReference('');
      setNotice('The owner confirmed and activated this tax rule. Existing completed orders remain unchanged.');
    } catch (confirmError) {
      console.error('Unable to confirm fiscal tax rule.', confirmError);
      setError(confirmError instanceof Error ? confirmError.message : 'Unable to confirm fiscal tax rule.');
    } finally {
      setSavingRule(false);
    }
  };

  const assignableRules = rules.filter((rule) =>
    rule.taxType === assignmentTaxType && rule.status === 'active' && rule.legalReviewed);
  const targetOptions = targetType === 'item'
    ? items.map((item) => ({ id: item.id, name: item.name }))
    : categories.map((category) => ({ id: category.id, name: category.name }));

  return (
    <WorkspaceLayout title="Fiscal configuration" storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader
        title="Fiscal configuration"
        subtitle="Record store identity and prepare rule drafts. Checkout applies only effective, active, reviewed rules for configured line-tax types."
      />
      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-primary-container p-3 text-on-primary-container">{notice}</p>}
      {loading ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-6">Loading fiscal configuration…</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <form onSubmit={saveProfile} className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <h2 className="font-display text-headline-sm text-on-surface">Store fiscal identity</h2>
            <p className="text-body-sm text-on-surface-variant">
              This records owner-provided information only; it is not legal advice or a tax registration check.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md">Legal name<input className={inputClass()} value={profile.legalName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalName: event.target.value })} /></label>
              <label className="text-label-md">Trading name<input className={inputClass()} value={profile.tradingName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, tradingName: event.target.value })} /></label>
              <label className="text-label-md">Tax identifier<input className={inputClass()} value={profile.taxId ?? ''} maxLength={100} onChange={(event) => setProfile({ ...profile, taxId: event.target.value })} /></label>
              <label className="text-label-md">Activity<input className={inputClass()} value={profile.activity ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activity: event.target.value })} /></label>
              <label className="text-label-md">Activity category<input className={inputClass()} value={profile.activityCategory ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activityCategory: event.target.value })} /></label>
              <label className="text-label-md">Legal form<input className={inputClass()} value={profile.legalForm ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalForm: event.target.value })} /></label>
              <label className="text-label-md">Fiscal regime<input className={inputClass()} value={profile.fiscalRegime ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, fiscalRegime: event.target.value })} /></label>
              <label className="text-label-md">VAT status
                <select className={inputClass()} value={profile.vatStatus ?? 'unknown'} onChange={(event) => setProfile({ ...profile, vatStatus: event.target.value as FiscalProfileRecord['vatStatus'] })}>
                  <option value="unknown">Unknown / not reviewed</option><option value="registered">Registered</option><option value="not_registered">Not registered</option><option value="exempt">Exempt</option><option value="suspended">Suspended</option>
                </select>
              </label>
              <label className="text-label-md">Displayed price mode
                <select className={inputClass()} value={profile.pricingMode ?? 'inclusive'} onChange={(event) => setProfile({ ...profile, pricingMode: event.target.value as FiscalProfileRecord['pricingMode'] })}>
                  <option value="inclusive">Tax-inclusive (entered price is the customer total)</option><option value="exclusive">Tax-exclusive (VAT is added to entered HT)</option>
                </select>
              </label>
              <label className="text-label-md">Declaration period
                <select className={inputClass()} value={profile.declarationPeriod ?? 'unknown'} onChange={(event) => setProfile({ ...profile, declarationPeriod: event.target.value as FiscalProfileRecord['declarationPeriod'] })}>
                  <option value="unknown">Unknown / not reviewed</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="custom">Other</option>
                </select>
              </label>
              <label className="text-label-md">Review status
                <select className={inputClass()} value={profile.reviewStatus} onChange={(event) => setProfile({ ...profile, reviewStatus: event.target.value as FiscalProfileRecord['reviewStatus'] })}>
                  <option value="draft">Draft</option><option value="review_required">Review required</option><option value="confirmed">Owner confirmed</option>
                </select>
              </label>
            </div>
            <fieldset className="rounded-lg bg-surface-container-low p-3">
              <legend className="px-1 text-label-md">Line taxes to calculate after reviewed rules are active</legend>
              <div className="flex flex-wrap gap-4">
                {([
                  ['vat', 'VAT'],
                  ['consumption', 'Consumption duty'],
                  ['other', 'Other line tax'],
                ] as const).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-body-sm">
                    <input
                      type="checkbox"
                      checked={profile.requiredTaxTypes?.includes(value) ?? false}
                      onChange={(event) => setProfile({
                        ...profile,
                        requiredTaxTypes: event.target.checked
                          ? [...(profile.requiredTaxTypes ?? []), value]
                          : (profile.requiredTaxTypes ?? []).filter((taxType) => taxType !== value),
                      })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-label-md">Address<textarea className="mt-1 min-h-24 w-full rounded-lg bg-surface-container-low p-3" value={profile.address ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label>
            <label className="block text-label-md">Review notes<textarea className="mt-1 min-h-20 w-full rounded-lg bg-surface-container-low p-3" value={profile.reviewNotes ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, reviewNotes: event.target.value })} /></label>
            <button type="submit" disabled={savingProfile} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
              <MaterialIcon name="save" />{savingProfile ? 'Saving…' : 'Save fiscal profile'}
            </button>
          </form>

          <section className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">Tax rule drafts</h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">Rates remain inactive until legally reviewed and checkout applies verified rule snapshots.</p>
            </div>
            <form onSubmit={createRule} className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md sm:col-span-2">Rule name<input required className={inputClass()} value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>
              <label className="text-label-md">Tax type
                <select className={inputClass()} value={taxType} onChange={(event) => setTaxType(event.target.value as FiscalTaxType)}>
                  <option value="vat">VAT</option><option value="consumption">Consumption duty</option><option value="other">Other line tax</option>
                </select>
              </label>
              <label className="text-label-md">Calculation
                <select className={inputClass()} value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value as 'percentage' | 'fixed')}>
                  <option value="percentage">Percentage</option><option value="fixed">Fixed per unit</option>
                </select>
              </label>
              <label className="text-label-md">{calculationMethod === 'percentage' ? 'Rate (%)' : 'Amount (TND)'}
                <input required inputMode="decimal" className={inputClass()} value={rateValue} onChange={(event) => setRateValue(event.target.value)} />
              </label>
              <label className="text-label-md">Priority<input required type="number" min="0" step="1" className={inputClass()} value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
              <label className="text-label-md">Effective from<input required type="date" className={inputClass()} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
              <label className="flex items-center gap-2 self-end pb-3 text-label-md"><input type="checkbox" checked={compound} onChange={(event) => setCompound(event.target.checked)} />Apply after prior taxes</label>
              <button type="submit" disabled={savingRule} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60 sm:col-span-2">
                <MaterialIcon name="add" />{savingRule ? 'Saving…' : 'Save draft rule'}
              </button>
            </form>
            <label className="block text-label-md">Owner confirmation legal reference
              <input className={inputClass()} value={activationReference} maxLength={500} onChange={(event) => setActivationReference(event.target.value)} placeholder="Reference or owner confirmation note" />
            </label>
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface">Saved versions</h3>
              {rules.length === 0 ? <p className="text-body-sm text-on-surface-variant">No tax rules have been drafted.</p> : rules.map((rule) => (
                <article key={`${rule.id}:${rule.version}`} className="rounded-lg bg-surface-container-low p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-label-md text-on-surface">{rule.name} · v{rule.version}</strong>
                    <span className="rounded-full bg-warning-container px-2 py-1 text-label-sm text-on-warning-container">{rule.status}</span>
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {rule.taxType} · priority {rule.priority} · from {rule.effectiveFrom} · {rule.calculationMethod === 'percentage' ? `${((rule.ratePpm ?? 0) / 10_000).toFixed(4)}%` : `${((rule.fixedAmountMillimes ?? 0) / 1000).toFixed(3)} TND`}
                  </p>
                  {rule.status === 'draft' && (
                    <button
                      type="button"
                      disabled={savingRule || !activationReference.trim()}
                      onClick={() => void confirmRule(rule)}
                      className="mt-3 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-label-sm text-on-primary disabled:opacity-60"
                    >
                      Owner confirm and activate
                    </button>
                  )}
                </article>
              ))}
            </div>
            <p className="rounded-lg bg-warning-container p-3 text-body-sm text-on-warning-container">
              Draft rules are never applied. Invoice issuance, e-invoicing, and authoritative fiscal declarations remain out of scope; legal eligibility and current rates still require qualified review.
            </p>
          </section>

          <section className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card xl:col-span-2">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">Product tax classifications</h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">Store an effective-dated treatment and its evidence. Classifications remain informational until checkout uses them.</p>
            </div>
            <form onSubmit={createAssignment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-label-md">Scope
                <select className={inputClass()} value={targetType} onChange={(event) => {
                  const nextType = event.target.value as 'item' | 'category';
                  setTargetType(nextType);
                  setTargetId(nextType === 'item' ? items[0]?.id ?? '' : categories[0]?.id ?? '');
                }}>
                  <option value="item">Product</option><option value="category">Category</option>
                </select>
              </label>
              <label className="text-label-md">{targetType === 'item' ? 'Product' : 'Category'}
                <select required className={inputClass()} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Select…</option>
                  {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label className="text-label-md">Tax type
                <select className={inputClass()} value={assignmentTaxType} onChange={(event) => {
                  setAssignmentTaxType(event.target.value as FiscalTaxType);
                  setAssignmentRule('');
                }}>
                  <option value="vat">VAT</option><option value="consumption">Consumption duty</option><option value="other">Other line tax</option>
                </select>
              </label>
              <label className="text-label-md">Treatment
                <select className={inputClass()} value={treatment} onChange={(event) => setTreatment(event.target.value as FiscalTaxAssignmentRecord['treatment'])}>
                  <option value="taxable">Taxable</option><option value="exempt">Exempt</option><option value="outside_scope">Outside scope</option><option value="suspended">Suspended</option><option value="special">Special treatment</option>
                </select>
              </label>
              {['taxable', 'special'].includes(treatment) && (
                <label className="text-label-md">Active, reviewed rule
                  <select required className={inputClass()} value={assignmentRule} onChange={(event) => setAssignmentRule(event.target.value)}>
                    <option value="">Select rule version…</option>
                    {assignableRules.map((rule) => <option key={`${rule.id}:${rule.version}`} value={`${rule.id}:${rule.version}`}>{rule.name} · v{rule.version}</option>)}
                  </select>
                </label>
              )}
              <label className="text-label-md">Effective from<input required type="date" className={inputClass()} value={assignmentDate} onChange={(event) => setAssignmentDate(event.target.value)} /></label>
              <label className="text-label-md">Legal reference<input className={inputClass()} value={legalReference} maxLength={500} onChange={(event) => setLegalReference(event.target.value)} /></label>
              <label className="text-label-md">Evidence reference<input className={inputClass()} value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
              <button type="submit" disabled={savingAssignment || !targetId} className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                <MaterialIcon name="add" />{savingAssignment ? 'Saving…' : 'Save classification'}
              </button>
            </form>
            {['taxable', 'special'].includes(treatment) && assignableRules.length === 0 &&
              <p className="text-body-sm text-on-surface-variant">No active legally reviewed rules exist for this tax type. Draft rules cannot be assigned for checkout.</p>}
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface">Saved classifications</h3>
              {assignments.length === 0 ? <p className="text-body-sm text-on-surface-variant">No product classifications have been saved.</p> : assignments.map((assignment) => (
                <article key={assignment.id} className="rounded-lg bg-surface-container-low p-3">
                  <strong className="text-label-md text-on-surface">
                    {assignment.itemId
                      ? items.find((item) => item.id === assignment.itemId)?.name ?? 'Archived product'
                      : categories.find((category) => category.id === assignment.categoryId)?.name ?? 'Archived category'}
                  </strong>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {assignment.taxType} · {assignment.treatment} · effective {assignment.effectiveFrom}
                    {assignment.ruleId ? ` · rule ${assignment.ruleId} v${assignment.ruleVersion}` : ''}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}
