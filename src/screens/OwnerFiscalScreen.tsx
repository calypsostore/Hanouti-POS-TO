import { useEffect, useState, type FormEvent } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { ContextualHelp, HelpLabel } from '../components/ContextualHelp';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { PageHeader } from '../components/layout';
import { ResponsiveDialog } from '../components/layout/ResponsiveDialog';
import { localizeErrorMessage, t } from '../i18n';
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
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(value)) throw new Error(t('fiscal.validation.percentagePrecision'));
  const [whole, fraction = ''] = value.split('.');
  const ppm = Number(whole) * 10_000 + Number(fraction.padEnd(4, '0'));
  if (!Number.isSafeInteger(ppm) || ppm < 1) throw new Error(t('fiscal.validation.percentagePositive'));
  return ppm;
}

function amountToMillimes(value: string): number {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error(t('fiscal.validation.amountPrecision'));
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(t('fiscal.validation.amountRange'));
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
  const [ruleName, setRuleName] = useState(t('fiscal.rule.defaultName'));
  const [taxType, setTaxType] = useState<FiscalTaxType>('vat');
  const [calculationMethod, setCalculationMethod] = useState<'percentage' | 'fixed'>('percentage');
  const [rateValue, setRateValue] = useState('19');
  const [activationReference, setActivationReference] = useState('');
  const [priority, setPriority] = useState('10');
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey());
  const [compound, setCompound] = useState(false);
  const [targetType, setTargetType] = useState<'all' | 'item' | 'category'>('item');
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
        if (active) setError(t('fiscal.error.loadConfiguration'));
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
      setNotice(t('fiscal.notice.profileSaved'));
    } catch (saveError) {
      console.error('Unable to save fiscal profile.', saveError);
      setError(localizeErrorMessage(saveError, t('fiscal.error.saveProfile')));
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
      setUnlockError(localizeErrorMessage(verificationError, t('fiscal.error.verifyOwner')));
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
      setRuleName(t('fiscal.rule.defaultName'));
      setRateValue('19');
      setNotice(t('fiscal.notice.ruleSaved'));
    } catch (saveError) {
      console.error('Unable to save fiscal tax rule.', saveError);
      setError(localizeErrorMessage(saveError, t('fiscal.error.saveRule')));
    } finally {
      setSavingRule(false);
    }
  };

  const createAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || (targetType !== 'all' && !targetId)) return;
    setSavingAssignment(true);
    setError('');
    setNotice('');
    try {
      const selectedRule = rules.find((rule) => `${rule.id}:${rule.version}` === assignmentRule);
      const saved = await fiscalService.createAssignment({
        storeId,
        ...(targetType === 'item' ? { itemId: targetId } : targetType === 'category' ? { categoryId: targetId } : {}),
        taxType: assignmentTaxType,
        treatment,
        ...(selectedRule ? { ruleId: selectedRule.id, ruleVersion: selectedRule.version } : {}),
        legalReference: legalReference.trim() || undefined,
        evidenceReference: evidenceReference.trim() || undefined,
        effectiveFrom: assignmentDate,
      }, user.id);
      setAssignments((current) => [saved, ...current]);
      setNotice(t('fiscal.notice.classificationSaved'));
    } catch (saveError) {
      console.error('Unable to save product fiscal classification.', saveError);
      setError(localizeErrorMessage(saveError, t('fiscal.error.saveClassification')));
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
      setNotice(t('fiscal.notice.ruleActivated'));
    } catch (confirmError) {
      console.error('Unable to confirm fiscal tax rule.', confirmError);
      setError(localizeErrorMessage(confirmError, t('fiscal.error.confirmRule')));
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
    <WorkspaceLayout title={t('fiscal.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader
        title={t('fiscal.title')}
        subtitle={t('fiscal.subtitle')}
      />
      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-primary-container p-3 text-on-primary-container">{notice}</p>}
      {loading ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-6">{t('fiscal.loadingConfiguration')}</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <form onSubmit={saveProfile} className="rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <fieldset disabled={profileLocked} className="min-w-0 space-y-4 border-0 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title={t('fiscal.identity.title')} description={t('fiscal.identity.help')}>{t('fiscal.identity.title')}</HelpLabel>
              </h2>
              <div role="group" aria-label={t('fiscal.references.group')} className="ml-auto flex shrink-0 items-center gap-2">
                <a
                  href="https://homologation.nacef.tn/#how-it-works"
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={t('fiscal.references.nacefLink')}
                  title={t('fiscal.references.nacefTitle')}
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-surface-container-lowest p-1 shadow-card transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <img
                    src="https://homologation.nacef.tn/build/media/logos/ministerefinance-fr.png"
                    alt={t('fiscal.references.ministryImage')}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full rounded-full object-cover object-left"
                  />
                </a>
                <span
                  role="img"
                  aria-label={t('fiscal.references.flag')}
                  title={t('fiscal.references.tunisia')}
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
                  aria-label={t('fiscal.references.coatOfArmsLink')}
                  title={t('fiscal.references.coatOfArmsTitle')}
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-surface-container-lowest p-1 shadow-card transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/8/80/Coat_of_arms_of_Tunisia.svg"
                    alt={t('fiscal.references.coatOfArmsImage')}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full rounded-full object-contain"
                  />
                </a>
              </div>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              {t('fiscal.identity.disclaimer')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.legalName')} description={t('fiscal.profile.legalNameHelp')}>{t('fiscal.profile.legalName')}</HelpLabel><input className={inputClass()} value={profile.legalName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalName: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.tradingName')} description={t('fiscal.profile.tradingNameHelp')}>{t('fiscal.profile.tradingName')}</HelpLabel><input className={inputClass()} value={profile.tradingName ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, tradingName: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.taxId')} description={t('fiscal.profile.taxIdHelp')}>{t('fiscal.profile.taxId')}</HelpLabel><input className={inputClass()} value={profile.taxId ?? ''} maxLength={100} onChange={(event) => setProfile({ ...profile, taxId: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.activity')} description={t('fiscal.profile.activityHelp')}>{t('fiscal.profile.activity')}</HelpLabel><input className={inputClass()} value={profile.activity ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activity: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.activityCategory')} description={t('fiscal.profile.activityCategoryHelp')}>{t('fiscal.profile.activityCategory')}</HelpLabel><input className={inputClass()} value={profile.activityCategory ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, activityCategory: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.legalForm')} description={t('fiscal.profile.legalFormHelp')}>{t('fiscal.profile.legalForm')}</HelpLabel><input className={inputClass()} value={profile.legalForm ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, legalForm: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.fiscalRegime')} description={t('fiscal.profile.fiscalRegimeHelp')}>{t('fiscal.profile.fiscalRegime')}</HelpLabel><input className={inputClass()} value={profile.fiscalRegime ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, fiscalRegime: event.target.value })} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.vatStatus')} description={t('fiscal.profile.vatStatusHelp')}>{t('fiscal.profile.vatStatus')}</HelpLabel>
                <select className={inputClass()} value={profile.vatStatus ?? 'unknown'} onChange={(event) => setProfile({ ...profile, vatStatus: event.target.value as FiscalProfileRecord['vatStatus'] })}>
                  <option value="unknown">{t('fiscal.status.unknownReview')}</option><option value="registered">{t('fiscal.status.registered')}</option><option value="not_registered">{t('fiscal.status.notRegistered')}</option><option value="exempt">{t('fiscal.treatment.exempt')}</option><option value="suspended">{t('fiscal.treatment.suspended')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.priceMode')} description={t('fiscal.profile.priceModeHelp')}>{t('fiscal.profile.priceMode')}</HelpLabel>
                <select className={inputClass()} value={profile.pricingMode ?? 'inclusive'} onChange={(event) => setProfile({ ...profile, pricingMode: event.target.value as FiscalProfileRecord['pricingMode'] })}>
                  <option value="inclusive">{t('fiscal.profile.priceInclusive')}</option><option value="exclusive">{t('fiscal.profile.priceExclusive')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.declarationPeriod')} description={t('fiscal.profile.declarationPeriodHelp')}>{t('fiscal.profile.declarationPeriod')}</HelpLabel>
                <select className={inputClass()} value={profile.declarationPeriod ?? 'unknown'} onChange={(event) => setProfile({ ...profile, declarationPeriod: event.target.value as FiscalProfileRecord['declarationPeriod'] })}>
                  <option value="unknown">{t('fiscal.status.unknownReview')}</option><option value="monthly">{t('fiscal.period.monthly')}</option><option value="quarterly">{t('fiscal.period.quarterly')}</option><option value="annual">{t('fiscal.period.annual')}</option><option value="custom">{t('fiscal.profile.other')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.reviewStatus')} description={t('fiscal.profile.reviewStatusHelp')}>{t('fiscal.profile.reviewStatus')}</HelpLabel>
                <select className={inputClass()} value={profile.reviewStatus} onChange={(event) => setProfile({ ...profile, reviewStatus: event.target.value as FiscalProfileRecord['reviewStatus'] })}>
                  <option value="draft">{t('fiscal.rule.draft')}</option><option value="review_required">{t('fiscal.profile.reviewRequired')}</option><option value="confirmed">{t('fiscal.profile.ownerConfirmed')}</option>
                </select>
              </label>
            </div>
            <fieldset className="rounded-lg bg-surface-container-low p-3">
              <legend className="px-1 text-label-md"><HelpLabel title={t('fiscal.profile.lineTaxes')} description={t('fiscal.profile.lineTaxesHelp')}>{t('fiscal.profile.lineTaxesActive')}</HelpLabel></legend>
              <div className="flex flex-wrap gap-4">
                {([
                  ['vat', t('fiscal.taxType.vat')],
                  ['consumption', t('fiscal.taxType.consumption')],
                  ['other', t('fiscal.taxType.other')],
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
                      description={t('fiscal.profile.includeTaxTypeHelp', { taxType: label })}
                    >{label}</HelpLabel>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-label-md"><HelpLabel title={t('fiscal.profile.address')} description={t('fiscal.profile.addressHelp')}>{t('fiscal.profile.address')}</HelpLabel><textarea className="mt-1 min-h-24 w-full rounded-lg bg-surface-container-low p-3" value={profile.address ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label>
            <label className="block text-label-md"><HelpLabel title={t('fiscal.profile.reviewNotes')} description={t('fiscal.profile.reviewNotesHelp')}>{t('fiscal.profile.reviewNotes')}</HelpLabel><textarea className="mt-1 min-h-20 w-full rounded-lg bg-surface-container-low p-3" value={profile.reviewNotes ?? ''} maxLength={500} onChange={(event) => setProfile({ ...profile, reviewNotes: event.target.value })} /></label>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={savingProfile} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                <MaterialIcon name="save" />{savingProfile ? t('fiscal.action.saving') : t('fiscal.action.saveProfile')}
              </button>
              <ContextualHelp title={t('fiscal.action.saveProfile')} description={t('fiscal.action.saveProfileHelp')} />
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
                {profileLocked ? t('fiscal.action.unlockToEdit') : t('fiscal.action.lockInformation')}
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
            title={t('fiscal.action.unlockInformation')}
            subtitle={t('fiscal.action.unlockHelp')}
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
                    {method === 'pin' ? t('fiscal.action.personalPin') : t('fiscal.action.password')}
                  </button>
                ))}
              </div>
              <label className="block text-label-md">
                {unlockMethod === 'pin' ? t('fiscal.action.ownerPin') : t('fiscal.action.ownerPassword')}
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
                  {unlockBusy ? t('fiscal.action.verifying') : t('fiscal.action.unlock')}
                </button>
              </div>
            </form>
          </ResponsiveDialog>

          <section className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title={t('fiscal.rule.drafts')} description={t('fiscal.rule.draftsHelp')}>{t('fiscal.rule.drafts')}</HelpLabel>
              </h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">{t('fiscal.rule.inactiveDescription')}</p>
            </div>
            <form onSubmit={createRule} className="grid gap-3 sm:grid-cols-2">
              <label className="text-label-md sm:col-span-2"><HelpLabel title={t('fiscal.rule.name')} description={t('fiscal.rule.nameHelp')}>{t('fiscal.rule.name')}</HelpLabel><input required className={inputClass()} value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.taxType')} description={t('fiscal.rule.taxTypeHelp')}>{t('fiscal.profile.taxType')}</HelpLabel>
                <select className={inputClass()} value={taxType} onChange={(event) => setTaxType(event.target.value as FiscalTaxType)}>
                  <option value="vat">{t('fiscal.taxType.vat')}</option><option value="consumption">{t('fiscal.taxType.consumption')}</option><option value="other">{t('fiscal.taxType.other')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.rule.calculationMethod')} description={t('fiscal.rule.calculationMethodHelp')}>{t('fiscal.rule.calculation')}</HelpLabel>
                <select className={inputClass()} value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value as 'percentage' | 'fixed')}>
                  <option value="percentage">{t('fiscal.rule.percentage')}</option><option value="fixed">{t('fiscal.rule.fixedPerUnit')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={calculationMethod === 'percentage' ? t('fiscal.rule.rate') : t('fiscal.rule.amountPerUnit')} description={calculationMethod === 'percentage' ? t('fiscal.rule.rateHelp') : t('fiscal.rule.amountPerUnitHelp')}>{calculationMethod === 'percentage' ? t('fiscal.rule.ratePercent') : t('fiscal.rule.amountTnd')}</HelpLabel>
                <input required inputMode="decimal" className={inputClass()} value={rateValue} onChange={(event) => setRateValue(event.target.value)} />
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.rule.priority')} description={t('fiscal.rule.priorityHelp')}>{t('fiscal.rule.priority')}</HelpLabel><input required type="number" min="0" step="1" className={inputClass()} value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.effectiveFrom')} description={t('fiscal.rule.effectiveFromHelp')}>{t('fiscal.profile.effectiveFrom')}</HelpLabel><input required type="date" className={inputClass()} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
              <label className="flex items-center gap-2 self-end pb-3 text-label-md"><input type="checkbox" checked={compound} onChange={(event) => setCompound(event.target.checked)} /><HelpLabel title={t('fiscal.rule.compound')} description={t('fiscal.rule.compoundHelp')}>{t('fiscal.rule.compound')}</HelpLabel></label>
              <div className="flex items-center justify-start gap-2 sm:col-span-2">
                <button type="submit" disabled={savingRule} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                  <MaterialIcon name="add" />{savingRule ? t('fiscal.action.saving') : t('fiscal.rule.saveDraft')}
                </button>
                <ContextualHelp title={t('fiscal.rule.saveDraft')} description={t('fiscal.rule.saveDraftHelp')} />
              </div>
            </form>
            <label className="block text-label-md"><HelpLabel title={t('fiscal.rule.confirmationReference')} description={t('fiscal.rule.confirmationReferenceHelp')}>{t('fiscal.rule.confirmationReference')}</HelpLabel>
              <input className={inputClass()} value={activationReference} maxLength={500} onChange={(event) => setActivationReference(event.target.value)} placeholder={t('fiscal.rule.confirmationReferencePlaceholder')} />
            </label>
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface"><HelpLabel title={t('fiscal.rule.savedVersions')} description={t('fiscal.rule.savedVersionsHelp')}>{t('fiscal.rule.savedVersions')}</HelpLabel></h3>
              {rules.length === 0 ? <p className="text-body-sm text-on-surface-variant">{t('fiscal.rule.noneSaved')}</p> : rules.map((rule) => (
                <article key={`${rule.id}:${rule.version}`} className="rounded-lg bg-surface-container-low p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-label-md text-on-surface">{rule.name} · v{rule.version}</strong>
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-container px-2 py-1 text-label-sm text-on-warning-container">{rule.status}<ContextualHelp title={t('fiscal.rule.status')} description={t('fiscal.rule.statusHelp')} /></span>
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {rule.taxType} · {t('fiscal.rule.priority')} {rule.priority} · {t('fiscal.rule.from')} {rule.effectiveFrom} · {rule.calculationMethod === 'percentage' ? `${((rule.ratePpm ?? 0) / 10_000).toFixed(4)}%` : `${((rule.fixedAmountMillimes ?? 0) / 1000).toFixed(3)} TND`}
                  </p>
                  {rule.status === 'draft' && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={savingRule || !activationReference.trim()}
                        onClick={() => void confirmRule(rule)}
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-label-sm text-on-primary disabled:opacity-60"
                      >
                        {t('fiscal.rule.confirmActivate')}
                      </button>
                      <ContextualHelp title={t('fiscal.rule.confirmActivate')} description={t('fiscal.rule.confirmActivateHelp')} />
                    </div>
                  )}
                </article>
              ))}
            </div>
            <p className="rounded-lg bg-warning-container p-3 text-body-sm text-on-warning-container">
              {t('fiscal.rule.disclaimer')}
            </p>
          </section>

          <section className="space-y-4 rounded-2xl bg-surface-container-lowest p-5 shadow-card xl:col-span-2">
            <div>
              <h2 className="font-display text-headline-sm text-on-surface">
                <HelpLabel title={t('fiscal.classification.title')} description={t('fiscal.classification.help')}>{t('fiscal.classification.title')}</HelpLabel>
              </h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">{t('fiscal.classification.description')}</p>
            </div>
            <form onSubmit={createAssignment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-label-md"><HelpLabel title={t('fiscal.classification.scope')} description={t('fiscal.classification.scopeHelp')}>{t('fiscal.classification.scope')}</HelpLabel>
                <select className={inputClass()} value={targetType} onChange={(event) => {
                  const nextType = event.target.value as 'all' | 'item' | 'category';
                  setTargetType(nextType);
                  setTargetId(nextType === 'item' ? items[0]?.id ?? '' : nextType === 'category' ? categories[0]?.id ?? '' : '');
                }}>
                  <option value="all">{t('fiscal.classification.allProducts')}</option><option value="item">{t('fiscal.classification.product')}</option><option value="category">{t('fiscal.classification.category')}</option>
                </select>
              </label>
              {targetType !== 'all' && (
                <label className="text-label-md"><HelpLabel title={targetType === 'item' ? t('fiscal.classification.product') : t('fiscal.classification.category')} description={targetType === 'item' ? t('fiscal.classification.chooseProduct') : t('fiscal.classification.chooseCategory')}>{targetType === 'item' ? t('fiscal.classification.product') : t('fiscal.classification.category')}</HelpLabel>
                  <select required className={inputClass()} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                    <option value="">{t('fiscal.action.select')}</option>
                    {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
              )}
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.taxType')} description={t('fiscal.classification.taxTypeHelp')}>{t('fiscal.profile.taxType')}</HelpLabel>
                <select className={inputClass()} value={assignmentTaxType} onChange={(event) => {
                  setAssignmentTaxType(event.target.value as FiscalTaxType);
                  setAssignmentRule('');
                }}>
                  <option value="vat">{t('fiscal.taxType.vat')}</option><option value="consumption">{t('fiscal.taxType.consumption')}</option><option value="other">{t('fiscal.taxType.other')}</option>
                </select>
              </label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.classification.treatment')} description={t('fiscal.classification.treatmentHelp')}>{t('fiscal.classification.treatment')}</HelpLabel>
                <select className={inputClass()} value={treatment} onChange={(event) => setTreatment(event.target.value as FiscalTaxAssignmentRecord['treatment'])}>
                  <option value="taxable">{t('fiscal.treatment.taxable')}</option><option value="exempt">{t('fiscal.treatment.exempt')}</option><option value="outside_scope">{t('fiscal.treatment.outsideScope')}</option><option value="suspended">{t('fiscal.treatment.suspended')}</option><option value="special">{t('fiscal.treatment.special')}</option>
                </select>
              </label>
              {['taxable', 'special'].includes(treatment) && (
                <label className="text-label-md"><HelpLabel title={t('fiscal.classification.activeRule')} description={t('fiscal.classification.activeRuleHelp')}>{t('fiscal.classification.activeRule')}</HelpLabel>
                  <select required className={inputClass()} value={assignmentRule} onChange={(event) => setAssignmentRule(event.target.value)}>
                    <option value="">{t('fiscal.rule.selectVersion')}</option>
                    {assignableRules.map((rule) => <option key={`${rule.id}:${rule.version}`} value={`${rule.id}:${rule.version}`}>{rule.name} · v{rule.version}</option>)}
                  </select>
                </label>
              )}
              <label className="text-label-md"><HelpLabel title={t('fiscal.profile.effectiveFrom')} description={t('fiscal.classification.effectiveFromHelp')}>{t('fiscal.profile.effectiveFrom')}</HelpLabel><input required type="date" className={inputClass()} value={assignmentDate} onChange={(event) => setAssignmentDate(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.classification.legalReference')} description={t('fiscal.classification.legalReferenceHelp')}>{t('fiscal.classification.legalReference')}</HelpLabel><input className={inputClass()} value={legalReference} maxLength={500} onChange={(event) => setLegalReference(event.target.value)} /></label>
              <label className="text-label-md"><HelpLabel title={t('fiscal.classification.evidenceReference')} description={t('fiscal.classification.evidenceReferenceHelp')}>{t('fiscal.classification.evidenceReference')}</HelpLabel><input className={inputClass()} value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
              <div className="flex items-center gap-2 self-end">
                <button type="submit" disabled={savingAssignment || (targetType !== 'all' && !targetId)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary disabled:opacity-60">
                  <MaterialIcon name="add" />{savingAssignment ? t('fiscal.action.saving') : t('fiscal.classification.save')}
                </button>
                <ContextualHelp title={t('fiscal.classification.save')} description={t('fiscal.classification.saveHelp')} />
              </div>
            </form>
            {['taxable', 'special'].includes(treatment) && assignableRules.length === 0 &&
              <p className="text-body-sm text-on-surface-variant">{t('fiscal.classification.noEligibleRules')}</p>}
            <div className="space-y-2 border-t border-outline-variant pt-4">
              <h3 className="text-label-lg text-on-surface"><HelpLabel title={t('fiscal.classification.saved')} description={t('fiscal.classification.savedHelp')}>{t('fiscal.classification.saved')}</HelpLabel></h3>
              {assignments.length === 0 ? <p className="text-body-sm text-on-surface-variant">{t('fiscal.classification.noneSaved')}</p> : assignments.map((assignment) => (
                <article key={assignment.id} className="rounded-lg bg-surface-container-low p-3">
                  <strong className="text-label-md text-on-surface">
                    {assignment.itemId
                      ? items.find((item) => item.id === assignment.itemId)?.name ?? t('fiscal.classification.archivedProduct')
                      : assignment.categoryId
                        ? categories.find((category) => category.id === assignment.categoryId)?.name ?? t('fiscal.classification.archivedCategory')
                        : t('fiscal.classification.allProducts')}
                  </strong>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {assignment.taxType} · {assignment.treatment} · {t('fiscal.rule.effective')} {assignment.effectiveFrom}
                    {assignment.ruleId ? ` · ${t('fiscal.rule.rule')} ${assignment.ruleId} v${assignment.ruleVersion}` : ''}
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
