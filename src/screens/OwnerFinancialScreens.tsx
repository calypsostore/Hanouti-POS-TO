import { useEffect, useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { BottomSheet } from '../components/BottomSheet';
import { DinarInput } from '../components/DinarInput';
import { Button } from '../components/Button';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { CardGrid, PageHeader } from '../components/layout';
import { getLanguage, localizeErrorMessage, t as baseT, type TranslationKey, type TranslationValues } from '../i18n';
import { enReports } from '../i18n/locales/en/reports';
import { frReports } from '../i18n/locales/fr/reports';
import { arReports } from '../i18n/locales/ar/reports';
import { formatTnd } from '../lib/format';
import { parseNonNegativeMillimes } from '../lib/millimes';
import { expenseService } from '../services/expenseService';
import { supplierService, type SupplierDetails, type SupplierBalanceRecord } from '../services/supplierService';
import { userService } from '../services/userService';
import type { ExpenseCategory, ExpenseRecord, SupplierRecord } from '../types/domain';

type ReportsKey = keyof typeof enReports;
const reportsLocales = { en: enReports, fr: frReports, ar: arReports };

function t(key: TranslationKey | ReportsKey, values: TranslationValues = {}): string {
  const localized = reportsLocales[getLanguage()][key as ReportsKey];
  if (localized === undefined) return baseT(key as TranslationKey, values);
  return localized.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

const categoryLabels: Record<ExpenseCategory, ReportsKey> = {
  rent: 'reportsPage.expenseCategory.rent',
  electricity: 'reportsPage.expenseCategory.electricity',
  water: 'reportsPage.expenseCategory.water',
  supplier: 'reportsPage.expenseCategory.supplier',
  salary: 'reportsPage.expenseCategory.salary',
  other: 'reportsPage.expenseCategory.other',
};
const expenseCategories = Object.keys(categoryLabels) as ExpenseCategory[];

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initialExpensesMonth(): string {
  const month = new URLSearchParams(window.location.search).get('month');
  return month && /^\d{4}-\d{2}$/.test(month) ? month : todayKey().slice(0, 7);
}

function amountToMillimes(value: string): number {
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined || millimes <= 0) throw new Error(t('reportsPage.amountPositiveError'));
  return millimes;
}

function money(amountMillimes: number): string {
  return `${formatTnd(amountMillimes / 1000)} DT`;
}

export function OwnerExpensesScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [storeName, setStoreName] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [month, setMonth] = useState(initialExpensesMonth);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newCategory, setNewCategory] = useState<ExpenseCategory>('other');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedExpenseId = new URLSearchParams(window.location.search).get('expenseId') ?? '';

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setLoading(true);
      try {
        const [nextExpenses, nextSuppliers, store] = await Promise.all([
          expenseService.list(storeId, { category: category || undefined, month: month || undefined }),
          supplierService.list(storeId),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setExpenses(nextExpenses);
        setSuppliers(nextSuppliers);
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        console.error('Unable to load expenses.', loadError);
        if (active) setError(t('common.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [storeId, category, month]);

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await expenseService.create({
        storeId,
        actorId: user.id,
        category: newCategory,
        supplierId: newCategory === 'supplier' ? supplierId : undefined,
        amountMillimes: amountToMillimes(amount),
        date,
        note,
      });
      setSheetOpen(false);
      setAmount('');
      setSupplierId('');
      setNote('');
      setNotice(t('reportsPage.expenseRecorded'));
      setCategory(created.category);
      setMonth(created.date.slice(0, 7));
      const nextExpenses = await expenseService.list(storeId, { category: created.category, month: created.date.slice(0, 7) });
      setExpenses(nextExpenses);
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('reportsPage.expenseFallbackError')));
    } finally {
      setBusy(false);
    }
  }

  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const visibleExpenses = selectedExpenseId
    ? expenses.filter((expense) => expense.id === selectedExpenseId)
    : expenses;
  const enteredAmount = parseNonNegativeMillimes(amount);
  const canSave = enteredAmount !== undefined && enteredAmount > 0 &&
    (newCategory !== 'supplier' || Boolean(supplierId));

  return (
    <WorkspaceLayout title={t('nav.expenses')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('nav.expenses')} subtitle={t('reportsPage.expenseSubtitle')} actions={
        <Button onClick={() => {
          setError('');
          setNotice('');
          setNewCategory('other');
          setSupplierId('');
          setAmount('');
          setDate(todayKey());
          setNote('');
          setSheetOpen(true);
        }}>
          <MaterialIcon name="add" />{t('reportsPage.addExpense')}
        </Button>
      } />
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-success-dark">{notice}</p>}
      <section aria-label={t('reportsPage.expenseFilters')} className="mb-4 grid gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
          {t('reportsPage.category')}
          <select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory | '')} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md">
            <option value="">{t('reportsPage.allCategories')}</option>
            {expenseCategories.map((value) => <option key={value} value={value}>{t(categoryLabels[value])}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
          {t('reportsPage.month')}
          <span className="flex gap-2">
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md" />
            <Button type="button" variant="secondary" onClick={() => setMonth('')}>{t('reportsPage.all')}</Button>
          </span>
        </label>
      </section>
      <CardGrid className="mobile-card-list mobile-gap-2">
        {loading ? <ListSkeleton label={t('reportsPage.loadingExpenses')} /> : visibleExpenses.map((expense) => (
          <article key={expense.id} className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-body text-label-lg text-on-surface">{t(categoryLabels[expense.category])}</h2>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {expense.date}{expense.supplierId ? ` · ${supplierNames.get(expense.supplierId) ?? t('reportsPage.supplier')}` : ''}
                </p>
                {expense.note && <p className="mt-1 break-words font-body text-body-sm text-outline">{expense.note}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-title-md tabular-nums text-on-surface">{money(expense.amountMillimes)}</p>
                {expense.category === 'supplier' && <p className="mt-1 font-body text-body-xs text-outline">{t('reportsPage.paidAmount', { amount: money(expense.paidMillimes) })}</p>}
              </div>
            </div>
          </article>
        ))}
        {!loading && !error && visibleExpenses.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('common.noData')}</p>}
      </CardGrid>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('reportsPage.addExpenseTitle')}>
        <form onSubmit={(event) => { void createExpense(event); }} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">
            {t('reportsPage.category')}
            <select value={newCategory} onChange={(event) => setNewCategory(event.target.value as ExpenseCategory)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3">
              {expenseCategories.map((value) => <option key={value} value={value}>{t(categoryLabels[value])}</option>)}
            </select>
          </label>
          {newCategory === 'supplier' && (
            <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">
              {t('reportsPage.supplier')}
              <select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3">
                <option value="">{t('reportsPage.selectSupplier')}</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">
            {t('reportsPage.amountTnd')}
            <DinarInput allowZero={false} required value={amount} onChange={(event) => setAmount(event.target.value)} className="h-14 rounded-lg bg-surface-container-low px-4 font-display text-title-lg tabular-nums" />
          </label>
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">
            {t('reportsPage.date')}
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3" />
          </label>
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">
            {t('reportsPage.noteOptional')}
            <textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="rounded-lg bg-surface-container-low p-3" />
          </label>
          {newCategory === 'supplier' && <p className="font-body text-body-xs text-on-surface-variant">{t('reportsPage.supplierUnpaidHelp')}</p>}
          {newCategory !== 'supplier' && <p className="font-body text-body-xs text-on-surface-variant">{t('reportsPage.nonSupplierPaidHelp')}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setSheetOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy || !canSave}>{t('reportsPage.saveExpense')}</Button>
          </div>
        </form>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

export function OwnerSuppliersScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [suppliers, setSuppliers] = useState<SupplierBalanceRecord[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('supplierId') ?? '');
  const [details, setDetails] = useState<SupplierDetails | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [paymentExpenseId, setPaymentExpenseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setSuppliersLoading(true);
      try {
        const [nextSuppliers, store] = await Promise.all([
          supplierService.list(storeId),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setSuppliers(nextSuppliers);
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        console.error('Unable to load suppliers.', loadError);
        if (active) setError(t('common.loadFailed'));
      } finally {
        if (active) setSuppliersLoading(false);
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [storeId]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    let active = true;
    void supplierService.getDetails(storeId, selectedId)
      .then((nextDetails) => { if (active) setDetails(nextDetails); })
      .catch((loadError: unknown) => {
        console.error('Unable to load supplier details.', loadError);
        if (active) setError(t('common.loadFailed'));
      });
    return () => { active = false; };
  }, [storeId, selectedId]);

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await supplierService.create({
        storeId,
        actorId: user.id,
        name: supplierName,
        phone: supplierPhone,
        notes: supplierNotes,
      });
      setSupplierName('');
      setSupplierPhone('');
      setSupplierNotes('');
      setCreateOpen(false);
      setSuppliers(await supplierService.list(storeId));
      setNotice(t('reportsPage.supplierAdded'));
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('reportsPage.supplierFallbackError')));
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !details) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await supplierService.recordPayment({
        storeId,
        supplierId: details.supplier.id,
        actorId: user.id,
        amountMillimes: amountToMillimes(paymentAmount),
        date: paymentDate,
        expenseId: paymentExpenseId || undefined,
      });
      const [nextDetails, nextSuppliers] = await Promise.all([
        supplierService.getDetails(storeId, details.supplier.id),
        supplierService.list(storeId),
      ]);
      setDetails(nextDetails);
      setSuppliers(nextSuppliers);
      setPaymentAmount('');
      setPaymentExpenseId('');
      setPaymentOpen(false);
      setNotice(t('reportsPage.paymentRecorded'));
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('reportsPage.paymentFallbackError')));
      if (details) {
        const [nextDetails, nextSuppliers] = await Promise.all([
          supplierService.getDetails(storeId, details.supplier.id),
          supplierService.list(storeId),
        ]);
        setDetails(nextDetails);
        setSuppliers(nextSuppliers);
      }
    } finally {
      setBusy(false);
    }
  }

  const enteredPayment = parseNonNegativeMillimes(paymentAmount);
  const canPay = Boolean(details) && enteredPayment !== undefined && enteredPayment > 0 &&
    enteredPayment <= (details?.amountOwedMillimes ?? 0);

  return (
    <WorkspaceLayout title={t('nav.suppliers')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('nav.suppliers')} subtitle={t('reportsPage.supplierSubtitle')} actions={
        <Button onClick={() => {
          setError('');
          setNotice('');
          setSupplierName('');
          setSupplierPhone('');
          setSupplierNotes('');
          setCreateOpen(true);
        }}><MaterialIcon name="add" />{t('reportsPage.addSupplier')}</Button>
      } />
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-success-dark">{notice}</p>}
      <CardGrid className="mobile-card-list mobile-gap-2 supplier-card-grid">
        {suppliersLoading ? <ListSkeleton label={t('reportsPage.loadingSuppliers')} /> : suppliers.map((supplier) => (
          <button key={supplier.id} type="button" onClick={() => { setError(''); setNotice(''); setSelectedId(supplier.id); }} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 text-left shadow-card hover:bg-surface-container-low">
            <span className="min-w-0">
              <span className="block truncate font-body text-label-lg text-on-surface">{supplier.name}</span>
              <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{supplier.phone || t('reportsPage.supplierDetails')}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-body text-body-xs text-outline">{t('reportsPage.amountOwed')}</span>
              <strong className="font-display text-title-md tabular-nums text-on-surface">{money(supplier.amountOwedMillimes)}</strong>
            </span>
            <MaterialIcon name="chevron_right" className="text-outline" />
          </button>
        ))}
        {!suppliersLoading && !error && suppliers.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('common.noData')}</p>}
      </CardGrid>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title={t('reportsPage.addSupplier')}>
        <form onSubmit={(event) => { void createSupplier(event); }} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.name')}
            <input required maxLength={120} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3" />
          </label>
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.phoneOptional')}
            <input maxLength={80} value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3" />
          </label>
          <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.notesOptional')}
            <textarea maxLength={500} rows={3} value={supplierNotes} onChange={(event) => setSupplierNotes(event.target.value)} className="rounded-lg bg-surface-container-low p-3" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('reportsPage.saveSupplier')}</Button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet
        open={Boolean(selectedId)}
        onClose={() => { setSelectedId(''); setDetails(null); setPaymentOpen(false); }}
        title={details?.supplier.name ?? t('reportsPage.supplierDetails')}
      >
        {details && (
          <div className="flex flex-col gap-4">
            <section className="rounded-xl bg-surface-container-low p-3">
              <p className="font-body text-body-sm text-on-surface-variant">{details.supplier.phone || t('reportsPage.noPhoneNumber')}{details.supplier.notes ? ` · ${details.supplier.notes}` : ''}</p>
              <p className="mt-2 font-body text-label-md text-on-surface">{t('reportsPage.amountOwed')}</p>
              <p className="font-display text-headline-md tabular-nums text-primary">{money(details.amountOwedMillimes)}</p>
            </section>
            {!paymentOpen ? (
              <Button onClick={() => { setPaymentAmount(''); setPaymentExpenseId(''); setPaymentDate(todayKey()); setPaymentOpen(true); }} disabled={details.amountOwedMillimes <= 0}>
                <MaterialIcon name="payments" />{t('reportsPage.recordPayment')}
              </Button>
            ) : (
              <form onSubmit={(event) => { void recordPayment(event); }} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
                <h3 className="font-body text-label-lg text-on-surface">{t('reportsPage.recordPayment')}</h3>
                <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.amountTnd')}
                  <DinarInput allowZero={false} required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="h-14 rounded-lg bg-surface px-4 font-display text-title-lg tabular-nums" />
                </label>
                <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.allocatePurchaseOptional')}
                  <select value={paymentExpenseId} onChange={(event) => setPaymentExpenseId(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3">
                    <option value="">{t('reportsPage.unallocatedPayment')}</option>
                    {details.purchases.filter((purchase) => purchase.amountMillimes > purchase.paidMillimes).map((purchase) => (
                      <option key={purchase.id} value={purchase.id}>{purchase.date} · {money(purchase.amountMillimes - purchase.paidMillimes)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-body text-label-md text-on-surface">{t('reportsPage.date')}
                  <input required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="ghost" onClick={() => setPaymentOpen(false)}>{t('common.cancel')}</Button>
                  <Button type="submit" disabled={busy || !canPay}>{t('reportsPage.recordPayment')}</Button>
                </div>
              </form>
            )}
            <section>
              <h3 className="mb-2 font-display text-headline-sm text-on-surface">{t('reportsPage.purchases')}</h3>
              <div className="flex flex-col gap-2">
                {details.purchases.map((purchase) => (
                  <article key={purchase.id} className="rounded-lg bg-surface-container-low p-3">
                    <div className="flex justify-between gap-3 font-body text-label-md text-on-surface">
                      <span>{purchase.date}</span><strong>{money(purchase.amountMillimes)}</strong>
                    </div>
                    <p className="mt-1 font-body text-body-xs text-on-surface-variant">{t('reportsPage.paymentDue', { paid: money(purchase.paidMillimes), due: money(purchase.amountMillimes - purchase.paidMillimes) })}</p>
                    {purchase.note && <p className="mt-1 break-words font-body text-body-sm text-outline">{purchase.note}</p>}
                  </article>
                ))}
                {details.purchases.length === 0 && <p className="font-body text-body-sm text-outline">{t('reportsPage.noPurchases')}</p>}
              </div>
            </section>
            <section>
              <h3 className="mb-2 font-display text-headline-sm text-on-surface">{t('reportsPage.payments')}</h3>
              <div className="flex flex-col gap-2">
                {details.payments.map((payment) => (
                  <article key={payment.id} className="flex justify-between gap-3 rounded-lg bg-surface-container-low p-3 font-body text-body-sm">
                    <span>{payment.date}{payment.expenseId ? ` · ${t('reportsPage.allocatedPurchase')}` : ` · ${t('reportsPage.unallocated')}`}</span>
                    <strong className="shrink-0 text-success-dark">{money(payment.amountMillimes)}</strong>
                  </article>
                ))}
                {details.payments.length === 0 && <p className="font-body text-body-sm text-outline">{t('reportsPage.noPayments')}</p>}
              </div>
            </section>
          </div>
        )}
      </BottomSheet>
    </WorkspaceLayout>
  );
}
