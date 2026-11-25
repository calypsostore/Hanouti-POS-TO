import { useEffect, useState, type FormEvent } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { ContextualHelp, HelpLabel } from '../components/ContextualHelp';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { PageHeader } from '../components/layout';
import { ResponsiveDialog } from '../components/layout/ResponsiveDialog';
import { authService } from '../services/authService';
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
  const [profileLocked, setProfileLocked] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'password'>('pin');
  const [unlockCredential, setUnlockCredential] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
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
        if (savedProfile) {
          setProfile(savedProfile);
          setProfileLocked(true);
        } else {
          setProfile((current) => ({ ...current, storeId }));
          setProfileLocked(false);
        }
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
      setProfileLocked(true);
      setNotice('Fiscal profile saved and locked. Have the legal details reviewed by a Tunisian tax professional before relying on them. The store owner must verify their PIN or password before editing it again.');
    } catch (saveError) {
      console.error('Unable to save fiscal profile.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save fiscal profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const unlockProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUnlockBusy(true);
    setUnlockError('');
    try {
      await authService.verifyFiscalProfileOwnerCredential(storeId, unlockMethod, unlockCredential);
      setProfileLocked(false);
      setUnlockDialogOpen(false);
      setUnlockCredential('');
    } catch (verificationError) {
      setUnlockError(verificationError instanceof Error ? verificationError.message : 'Unable to verify the store owner.');
    } finally {
      setUnlockBusy(false);
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
          <form onSubmit={saveProfile} className="rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <fieldset disabled={profileLocked} className="min-w-0 space-y-4 border-0 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title="Store fiscal identity" description="These details describe the business and the tax settings used by this store. Enter information from your own records; the screen does not verify registration or provide legal advice.">Store fiscal identity</HelpLabel>
              </h2>
              <div role="group" aria-label="Tunisian fiscal references" className="ml-auto flex shrink-0 items-center gap-2">
                <a
                  href="https://homologation.nacef.tn/#how-it-works"
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label="Open the NACEF fiscal homologation portal, Ministry of Finance"
                  title="NACEF fiscal homologation portal · Ministry of Finance"
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-surface-container-lowest p-1 shadow-card transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <img
                    src="https://homologation.nacef.tn/build/media/logos/ministerefinance-fr.png"
                    alt="Tunisian Ministry of Finance"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full rounded-full object-cover object-left"
                  />
                </a>
                <span
                  role="img"
                  aria-label="Flag of Tunisia"
                  title="Tunisia"
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-surface-container-lowest p-1 shadow-card"
                >
                  <svg aria-hidden="true" viewBox="0 0 40 40" className="h-full w-full rounded-full">
                    <circle cx="20" cy="20" r="20" fill="#e70013" />
                    <circle cx="20" cy="20" r="11.5" fill="#ffffff" />
                    <circle cx="17.5" cy="20" r="7" fill="#e70013" />
                    <circle cx="20.5" cy="18.5" r="6" fill="#ffffff" />
                    <path d="M25 14.2 26.4 18.1 30.5 18.2 27.3 20.6 28.5 24.5 25 22.2 21.6 24.5 22.8 20.6 19.5 18.2 23.6 18.1Z" fill="#e70013" />
                  </svg>
                </span>
                <a
                  href="https://commons.wikimedia.org/wiki/File:Coat_of_arms_of_Tunisia.svg"
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label="Coat of arms of Tunisia by FXXX and Graphics Lab, licensed CC BY-SA 3.0 on Wikimedia Commons"
                  title="Coat of arms of Tunisia · FXXX / Graphics Lab · CC BY-SA 3.0"
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-surface-container-lowest p-1 shadow-card transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/8/80/Coat_of_arms_of_Tunisia.svg"
                    alt="Coat of arms of Tunisia"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full rounded-full object-contain"
                  />
                </a>
              </div>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              This records owner-provided information only; it is not legal advice or a tax registration check.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md"><HelpLabel title="Legal name" description="The official name of the business as recorded in its legal or tax documents. Enter it as it appears on those documents.">Legal name</HelpLabel><input className={inputClass()} value={profile.legalName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalName: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Trading name" description="The name customers know the business by. It may differ from the legal name; enter the name used on your shop or receipts.">Trading name</HelpLabel><input className={inputClass()} value={profile.tradingName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, tradingName: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Tax identifier" description="The business identifier recorded for tax purposes. Copy it from your tax registration documents, including its letters and numbers.">Tax identifier</HelpLabel><input className={inputClass()} value={profile.taxId ?? ''} maxLength={100} onChange={(event) => setProfile({ ...profile, taxId: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Activity" description="A short description of what the business does. Use the activity wording from your business records if available, for example, grocery retail.">Activity</HelpLabel><input className={inputClass()} value={profile.activity ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activity: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Activity category" description="A broader grouping for the business activity. Enter the category used in your own business records; this field does not determine tax treatment.">Activity category</HelpLabel><input className={inputClass()} value={profile.activityCategory ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activityCategory: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Legal form" description="The business structure shown in its official records, such as a sole proprietorship or company. Enter the wording from your documents.">Legal form</HelpLabel><input className={inputClass()} value={profile.legalForm ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalForm: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="Fiscal regime" description="The tax regime recorded for this business. Enter the regime shown in your records; ask a qualified tax professional if you are unsure which applies.">Fiscal regime</HelpLabel><input className={inputClass()} value={profile.fiscalRegime ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, fiscalRegime: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title="VAT status" description="Records the VAT status selected for this business. Choose the option that matches your current records, or leave it as unknown until it has been checked.">VAT status</HelpLabel>
                <select className={inputClass()} value={profile.vatStatus ?? 'unknown'} onChange={(event) => setProfile({ ...profile, vatStatus: event.target.value as FiscalProfileRecord['vatStatus'] })}>
                  <option value="unknown">Unknown / not reviewed</option><option value="registered">Registered</option><option value="not_registered">Not registered</option><option value="exempt">Exempt</option><option value="suspended">Suspended</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Displayed price mode" description="Controls how checkout treats the product price: inclusive means the entered price already includes tax and stays the customer total; exclusive means applicable tax is added to the entered price.">Displayed price mode</HelpLabel>
                <select className={inputClass()} value={profile.pricingMode ?? 'inclusive'} onChange={(event) => setProfile({ ...profile, pricingMode: event.target.value as FiscalProfileRecord['pricingMode'] })}>
                  <option value="inclusive">Tax-inclusive (entered price is the customer total)</option><option value="exclusive">Tax-exclusive (VAT is added to entered HT)</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Declaration period" description="Records how often the business expects to prepare its tax declarations. Select the period shown in your records, or keep it unknown if it has not been confirmed.">Declaration period</HelpLabel>
                <select className={inputClass()} value={profile.declarationPeriod ?? 'unknown'} onChange={(event) => setProfile({ ...profile, declarationPeriod: event.target.value as FiscalProfileRecord['declarationPeriod'] })}>
                  <option value="unknown">Unknown / not reviewed</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="custom">Other</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Review status" description="Tracks whether these owner-entered details are still a draft, need review, or have been confirmed by the owner. It does not mean a tax authority or professional has verified them.">Review status</HelpLabel>
                <select className={inputClass()} value={profile.reviewStatus} onChange={(event) => setProfile({ ...profile, reviewStatus: event.target.value as FiscalProfileRecord['reviewStatus'] })}>
                  <option value="draft">Draft</option><option value="review_required">Review required</option><option value="confirmed">Owner confirmed</option>
                </select>
              </label>
            </div>
            <fieldset className="rounded-lg bg-surface-container-low p-3">
              <legend className="px-1 text-label-md"><HelpLabel title="Line taxes to calculate" description="Choose which tax types checkout should calculate for sale lines. A selected type is only calculated when an applicable rule is active, reviewed, and effective.">Line taxes to calculate after reviewed rules are active</HelpLabel></legend>
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
                    <HelpLabel
                      title={label}
                      description={`Include ${label} in the tax types this store can calculate. Select it only when this tax type is relevant to your setup and has an applicable reviewed rule.`}
                    >{label}</HelpLabel>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-label-md"><HelpLabel title="Business address" description="The address recorded for the business profile. Enter the business address as it appears in your records; this app does not check it against official sources.">Address</HelpLabel><textarea className="mt-1 min-h-24 w-full rounded-lg bg-surface-container-low p-3" value={profile.address ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label>
            <label className="block text-label-md"><HelpLabel title="Review notes" description="Optional notes about this fiscal profile, such as details that still need checking. Use this to help the owner or reviewer understand what remains unresolved.">Review notes</HelpLabel><textarea className="mt-1 min-h-20 w-full rounded-lg bg-surface-container-low p-3" value={profile.reviewNotes ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, reviewNotes: event.target.value })} /></label>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={savingProfile} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                <MaterialIcon name="save" />{savingProfile ? 'Saving…' : 'Save fiscal profile'}
              </button>
              <ContextualHelp title="Save fiscal profile" description="Save the fiscal identity and options shown in this form. Saving records your entries; it does not verify legal details or activate tax rules." />
            </div>
            </fieldset>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (profileLocked) {
                    setUnlockMethod('pin');
                    setUnlockCredential('');
                    setUnlockError('');
                    setUnlockDialogOpen(true);
                  } else {
                    setProfileLocked(true);
                  }
                }}
                className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${
                  profileLocked
                    ? 'border-primary/20 bg-primary-container text-on-primary-container hover:bg-primary/15'
                    : 'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container'
                }`}
              >
                <MaterialIcon name={profileLocked ? 'lock' : 'lock_open'} />
                {profileLocked ? 'Unlock to edit' : 'Lock fiscal information'}
              </button>
            </div>
          </form>

          <ResponsiveDialog
            open={unlockDialogOpen}
            onClose={() => {
              setUnlockDialogOpen(false);
              setUnlockError('');
              setUnlockCredential('');
            }}
            title="Unlock fiscal information"
            subtitle="Verify with the store owner's personal PIN or password to edit the saved profile."
            icon="lock_open"
            panelClassName="max-w-md"
          >
            <form onSubmit={unlockProfile} className="space-y-4">
              <div className="flex gap-2">
                {(['pin', 'password'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={unlockMethod === method}
                    onClick={() => {
                      setUnlockMethod(method);
                      setUnlockCredential('');
                      setUnlockError('');
                    }}
                    className={`min-h-10 rounded-lg px-4 text-label-md transition-colors ${
                      unlockMethod === method
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {method === 'pin' ? 'Personal PIN' : 'Password'}
                  </button>
                ))}
              </div>
              <label className="block text-label-md">
                {unlockMethod === 'pin' ? 'Owner personal PIN' : 'Owner password'}
                <input
                  required
                  autoFocus
                  type="password"
                  inputMode={unlockMethod === 'pin' ? 'numeric' : 'text'}
                  pattern={unlockMethod === 'pin' ? '[0-9]{4}' : undefined}
                  maxLength={unlockMethod === 'pin' ? 4 : undefined}
                  autoComplete={unlockMethod === 'pin' ? 'off' : 'current-password'}
                  value={unlockCredential}
                  onChange={(event) => setUnlockCredential(
                    unlockMethod === 'pin'
                      ? event.target.value.replace(/\D/g, '').slice(0, 4)
                      : event.target.value,
                  )}
                  className={inputClass()}
                />
              </label>
              {unlockError && <p role="alert" className="rounded-lg bg-error-container p-3 text-body-sm text-on-error-container">{unlockError}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={unlockBusy || (unlockMethod === 'pin' && !/^\d{4}$/.test(unlockCredential))}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60"
                >
                  <MaterialIcon name="lock_open" />
                  {unlockBusy ? 'Verifying…' : 'Unlock'}
                </button>
              </div>
            </form>
          </ResponsiveDialog>

          <section className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title="Tax rule drafts" description="Create and review tax rule versions here. A new rule remains a draft and is not used by checkout until it is owner-confirmed and active.">Tax rule drafts</HelpLabel>
              </h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">Rates remain inactive until legally reviewed and checkout applies verified rule snapshots.</p>
            </div>
            <form onSubmit={createRule} className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md sm:col-span-2"><HelpLabel title="Rule name" description="A name to help you recognize this tax rule in saved versions and product classifications. Use a short description, for example, Standard VAT.">Rule name</HelpLabel><input required className={inputClass()} value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title="Tax type" description="Select which line tax this rule calculates: VAT, consumption duty, or another line tax. It must match the tax type selected for the store or product classification.">Tax type</HelpLabel>
                <select className={inputClass()} value={taxType} onChange={(event) => setTaxType(event.target.value as FiscalTaxType)}>
                  <option value="vat">VAT</option><option value="consumption">Consumption duty</option><option value="other">Other line tax</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Calculation method" description="Choose whether the rule calculates a percentage of the taxable base or a fixed amount per unit. Use the method that matches the tax rule being recorded.">Calculation</HelpLabel>
                <select className={inputClass()} value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value as 'percentage' | 'fixed')}>
                  <option value="percentage">Percentage</option><option value="fixed">Fixed per unit</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={calculationMethod === 'percentage' ? 'Rate' : 'Amount per unit'} description={calculationMethod === 'percentage' ? 'The percentage this rule applies to its taxable base. Enter a number such as 19 for 19%; confirm the correct rate for your business before activation.' : 'The fixed tax amount applied to each unit. Enter the amount in TND, for example 0.500 for 500 millimes per unit; confirm the correct amount before activation.'}>{calculationMethod === 'percentage' ? 'Rate (%)' : 'Amount (TND)'}</HelpLabel>
                <input required inputMode="decimal" className={inputClass()} value={rateValue} onChange={(event) => setRateValue(event.target.value)} />
              </label>
              <label className="text-label-md"><HelpLabel title="Priority" description="Sets the order in which tax rules are processed. A smaller number is processed earlier; use the order specified by the reviewed tax setup.">Priority</HelpLabel><input required type="number" min="0" step="1" className={inputClass()} value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title="Effective from" description="The first date on which this rule can apply. Enter the date provided by the reviewed tax setup; the rule will not apply before it.">Effective from</HelpLabel><input required type="date" className={inputClass()} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
              <label className="flex items-center gap-2 self-end pb-3 text-label-md"><input type="checkbox" checked={compound} onChange={(event) => setCompound(event.target.checked)} /><HelpLabel title="Apply after prior taxes" description="When selected, this rule includes taxes already calculated earlier in its taxable base. Leave it off when the rule should use only the original base amount.">Apply after prior taxes</HelpLabel></label>
              <div className="flex items-center justify-start gap-2 sm:col-span-2">
                <button type="submit" disabled={savingRule} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                  <MaterialIcon name="add" />{savingRule ? 'Saving…' : 'Save draft rule'}
                </button>
                <ContextualHelp title="Save draft rule" description="Save a new version as a draft for review. Saving does not activate the rule or make checkout apply it." />
              </div>
            </form>
            <label className="block text-label-md"><HelpLabel title="Owner confirmation legal reference" description="Enter the reference or owner confirmation note used when confirming a rule. Provide a clear source or note from your reviewed setup; this field does not validate legal eligibility.">Owner confirmation legal reference</HelpLabel>
              <input className={inputClass()} value={activationReference} maxLength={500} onChange={(event) => setActivationReference(event.target.value)} placeholder="Reference or owner confirmation note" />
            </label>
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface"><HelpLabel title="Saved versions" description="Each row is a saved version of a tax rule, including its current status, tax type, priority, effective date, and calculation. A draft is not applied at checkout.">Saved versions</HelpLabel></h3>
              {rules.length === 0 ? <p className="text-body-sm text-on-surface-variant">No tax rules have been drafted.</p> : rules.map((rule) => (
                <article key={`${rule.id}:${rule.version}`} className="rounded-lg bg-surface-container-low p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-label-md text-on-surface">{rule.name} · v{rule.version}</strong>
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-container px-2 py-1 text-label-sm text-on-warning-container">{rule.status}<ContextualHelp title="Rule status" description="Shows the current state of this saved rule version. Draft rules are inactive; an active rule may be used only when it is also reviewed, effective, and applicable to the sale." /></span>
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {rule.taxType} · priority {rule.priority} · from {rule.effectiveFrom} · {rule.calculationMethod === 'percentage' ? `${((rule.ratePpm ?? 0) / 10_000).toFixed(4)}%` : `${((rule.fixedAmountMillimes ?? 0) / 1000).toFixed(3)} TND`}
                  </p>
                  {rule.status === 'draft' && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={savingRule || !activationReference.trim()}
                        onClick={() => void confirmRule(rule)}
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-label-sm text-on-primary disabled:opacity-60"
                      >
                        Owner confirm and activate
                      </button>
                      <ContextualHelp title="Owner confirm and activate" description="Record the owner's confirmation and activate this saved rule version using the reference above. Only proceed after the rule details and reference have been checked." />
                    </div>
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
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title="Product tax classifications" description="Record which treatment applies to a product or category for a selected tax type. These entries are date-based and need supporting references where available.">Product tax classifications</HelpLabel>
              </h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">Store an effective-dated treatment and its evidence. Classifications remain informational until checkout uses them.</p>
            </div>
            <form onSubmit={createAssignment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-label-md"><HelpLabel title="Scope" description="Choose whether this classification applies to one product or to a whole category. Select the narrower scope that matches the reviewed classification.">Scope</HelpLabel>
                <select className={inputClass()} value={targetType} onChange={(event) => {
                  const nextType = event.target.value as 'item' | 'category';
                  setTargetType(nextType);
                  setTargetId(nextType === 'item' ? items[0]?.id ?? '' : categories[0]?.id ?? '');
                }}>
                  <option value="item">Product</option><option value="category">Category</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={targetType === 'item' ? 'Product' : 'Category'} description={targetType === 'item' ? 'Choose the product this tax classification applies to.' : 'Choose the category whose products this tax classification applies to.'}>{targetType === 'item' ? 'Product' : 'Category'}</HelpLabel>
                <select required className={inputClass()} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Select…</option>
                  {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Tax type" description="Select the tax type this product or category treatment describes. A classification only affects the matching tax type.">Tax type</HelpLabel>
                <select className={inputClass()} value={assignmentTaxType} onChange={(event) => {
                  setAssignmentTaxType(event.target.value as FiscalTaxType);
                  setAssignmentRule('');
                }}>
                  <option value="vat">VAT</option><option value="consumption">Consumption duty</option><option value="other">Other line tax</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title="Treatment" description="Describe how this product or category is handled for the selected tax type: taxable, exempt, outside scope, suspended, or special. Choose the option supported by your reviewed setup.">Treatment</HelpLabel>
                <select className={inputClass()} value={treatment} onChange={(event) => setTreatment(event.target.value as FiscalTaxAssignmentRecord['treatment'])}>
                  <option value="taxable">Taxable</option><option value="exempt">Exempt</option><option value="outside_scope">Outside scope</option><option value="suspended">Suspended</option><option value="special">Special treatment</option>
                </select>
              </label>
              {['taxable', 'special'].includes(treatment) && (
                <label className="text-label-md"><HelpLabel title="Active, reviewed rule" description="Choose the active rule version that should be linked to this taxable or special classification. Draft or unreviewed rules are not available here.">Active, reviewed rule</HelpLabel>
                  <select required className={inputClass()} value={assignmentRule} onChange={(event) => setAssignmentRule(event.target.value)}>
                    <option value="">Select rule version…</option>
                    {assignableRules.map((rule) => <option key={`${rule.id}:${rule.version}`} value={`${rule.id}:${rule.version}`}>{rule.name} · v{rule.version}</option>)}
                  </select>
                </label>
              )}
              <label className="text-label-md"><HelpLabel title="Effective from" description="The first date this product classification applies. Enter the date supplied by the reviewed tax setup.">Effective from</HelpLabel><input required type="date" className={inputClass()} value={assignmentDate} onChange={(event) => setAssignmentDate(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title="Legal reference" description="An optional reference supporting the selected treatment, such as the source or document name recorded by your reviewer. Enter only a reference you can identify.">Legal reference</HelpLabel><input className={inputClass()} value={legalReference} maxLength={500} onChange={(event) => setLegalReference(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title="Evidence reference" description="An optional pointer to evidence supporting this classification, such as an internal file name or document reference. This field stores your note; it does not verify the evidence.">Evidence reference</HelpLabel><input className={inputClass()} value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
              <div className="flex items-center gap-2 self-end">
                <button type="submit" disabled={savingAssignment || !targetId} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                  <MaterialIcon name="add" />{savingAssignment ? 'Saving…' : 'Save classification'}
                </button>
                <ContextualHelp title="Save classification" description="Save the selected product or category treatment, date, and optional references. This records the classification without changing existing orders." />
              </div>
            </form>
            {['taxable', 'special'].includes(treatment) && assignableRules.length === 0 &&
              <p className="text-body-sm text-on-surface-variant">No active legally reviewed rules exist for this tax type. Draft rules cannot be assigned for checkout.</p>}
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface"><HelpLabel title="Saved classifications" description="Review classifications already recorded for products or categories, including their tax type, treatment, effective date, and linked rule when present.">Saved classifications</HelpLabel></h3>
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
