import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ownerWorkspaceLinks } from '../app/navigation';
import { CardGrid, PageContainer, PageHeader, SplitView } from '../components/layout';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { DinarInput } from '../components/DinarInput';
import { Button } from '../components/Button';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { LazyBatch } from '../components/LazyBatch';
import { MaterialIcon } from '../components/MaterialIcon';
import { OverdueCustomerRow } from '../components/OverdueCustomerRow';
import { TabStatementView } from '../components/TabStatementView';
import { TopBar } from '../components/TopBar';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { getCustomerCreditTone } from '../lib/customerCredit';
import { formatMillimes, parseNonNegativeMillimes } from '../lib/millimes';
import { customerService } from '../services/customerService';
import { shareCustomerStatement } from '../services/customerStatementShare';
import { shareTextAsPdf } from '../services/receiptExport';
import { shiftService } from '../services/shiftService';
import type { CustomerCreditAlert } from '../services/notificationService';
import { notificationService } from '../services/notificationService';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { getLanguage, t, type TranslationKey } from '../i18n';
import type { CustomerRecord, PaymentMethod } from '../types/domain';
import type { CustomerBalanceReconciliation, CustomerCreditStatus, CustomerDueInfo, CustomerLedgerEntry, CustomerStatementData } from '../services/customerService';
import type { NotificationRecord, OrderRecord, StoreRecord, TabRecord } from '../types/domain';

type CustomerFilter = 'all' | 'owes' | 'near' | 'over' | 'overdue' | 'settled';
type CustomerSort = 'balance' | 'name' | 'lastPayment';
type CustomerDraft = {
  name: string;
  phone: string;
  email: string;
  creditLimit: string;
  settlementTerms: CustomerRecord['settlementTerms'];
  notes: string;
};

const EMPTY_DRAFT: CustomerDraft = {
  name: '',
  phone: '',
  email: '',
  creditLimit: '',
  settlementTerms: 'monthly',
  notes: '',
};

const filterOptions: { id: CustomerFilter; labelKey: TranslationKey }[] = [
  { id: 'all', labelKey: 'customers.filter.all' },
  { id: 'owes', labelKey: 'customers.filter.owing' },
  { id: 'near', labelKey: 'customers.filter.nearLimit' },
  { id: 'over', labelKey: 'customers.filter.overLimit' },
  { id: 'overdue', labelKey: 'customers.filter.overdue' },
  { id: 'settled', labelKey: 'customers.filter.settled' },
];

const customerErrorKeys: Readonly<Record<string, TranslationKey>> = {
  'Customer name is required.': 'customers.errors.nameRequired',
  'Select valid customer settlement terms.': 'customers.errors.invalidTerms',
  'Credit limit must be a non-negative amount in millimes.': 'customers.errors.invalidCreditLimit',
  'Enter a payment greater than zero.': 'customers.errors.paymentRequired',
  'Customer could not be found.': 'customers.errors.customerNotFound',
  'Customer could not be found in this store.': 'customers.errors.customerNotFound',
  'Only this store owner can archive customers.': 'customers.errors.permission',
  'Your position does not allow creating customers.': 'customers.errors.permission',
  'Your position does not allow editing customers.': 'customers.errors.permission',
  'Your position does not allow settling customer tabs.': 'customers.errors.permission',
  'This customer cannot be archived while their tab balance is not zero.': 'customers.errors.cannotArchiveBalance',
  'The business day is closed. Open a new shift to continue.': 'customers.errors.shiftClosed',
  'This payment exceeds the balance. Ask the owner to enable customer credit balances in Store settings.': 'customers.errors.paymentTooLarge',
  'A reason is required to reverse a payment.': 'customers.errors.reasonRequired',
  'Set your admin PIN in Settings before reversing payments.': 'customers.errors.pinSetup',
  'Incorrect Admin PIN.': 'customers.errors.pinIncorrect',
  'PIN pad locked for 60 seconds after 3 incorrect PINs.': 'customers.errors.pinLockedLong',
  'This customer payment could not be found.': 'customers.errors.paymentNotFound',
  'This payment has already been reversed.': 'customers.errors.alreadyReversed',
};

function customerErrorMessage(error: unknown, fallbackKey: TranslationKey): string {
  if (error instanceof Error) {
    if (error.message === t('customers.errors.invalidPayment') || error.message === t('customers.errors.invalidCreditLimit')) {
      return error.message;
    }
    const lockMatch = error.message.match(/^PIN pad locked\. Try again in (\d+) seconds\.$/);
    if (lockMatch) return t('customers.errors.pinLocked', { seconds: lockMatch[1] });
    const key = customerErrorKeys[error.message];
    if (key) return t(key);
  }
  return t(fallbackKey);
}

function settlementTermsLabel(terms: CustomerRecord['settlementTerms']): string {
  if (terms === 'weekly') return t('customers.form.weekly');
  if (terms === 'monthly') return t('customers.form.monthly');
  return t('customers.form.anytime');
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function money(millimes: number): string {
  return `${formatCustomerTnd(Math.abs(millimes) / 1000)} DT`;
}

function balanceMoney(millimes: number): string {
  return millimes < 0 ? t('customers.credit.credit', { amount: money(millimes) }) : money(millimes);
}

function formatCustomerTnd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(getLanguage(), {
    useGrouping: true,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amount);
}

function parseMillimes(value: string, required: boolean): number | undefined {
  if (!value.trim() && !required) return undefined;
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined || (required && millimes === 0)) {
    throw new Error(required ? t('customers.errors.invalidPayment') : t('customers.errors.invalidCreditLimit'));
  }
  return millimes;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join('') || '?';
}

function dateLabel(value?: string): string {
  if (!value) return t('customers.dates.noPayments');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('customers.dates.noPayments') : date.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function CustomersScreen() {
  const navigate = useNavigate();
  const { id: customerId } = useParams();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const isOwner = user?.role === 'owner';
  const isDetail = Boolean(customerId);

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [creditStatuses, setCreditStatuses] = useState<Record<string, CustomerCreditStatus>>({});
  const [dueInfos, setDueInfos] = useState<Record<string, CustomerDueInfo>>({});
  const [creditAlerts, setCreditAlerts] = useState<CustomerCreditAlert[]>([]);
  const [summary, setSummary] = useState({ totalOutstandingMillimes: 0, customersOwing: 0, overdueCount: 0 });
  const [selected, setSelected] = useState<CustomerRecord | null>(null);
  const [loadedCustomerId, setLoadedCustomerId] = useState<string>();
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [transactions, setTransactions] = useState<TabRecord[]>([]);
  const [store, setStore] = useState<StoreRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canCreate, setCanCreate] = useState(isOwner);
  const [canEdit, setCanEdit] = useState(isOwner);
  const [canSettle, setCanSettle] = useState(isOwner);
  const [canTakeOrders, setCanTakeOrders] = useState(isOwner);
  const [creditNotifications, setCreditNotifications] = useState<NotificationRecord[]>([]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>(() => searchParams.get('filter') === 'overdue' ? 'overdue' : 'all');
  const [sort, setSort] = useState<CustomerSort>('balance');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [editDraft, setEditDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [clearCreditLimit, setClearCreditLimit] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Exclude<PaymentMethod, 'tab'>>('cash');
  const paymentSubmissionRef = useRef(false);
  const paymentIdempotencyKeyRef = useRef<string | undefined>(undefined);
  const [paymentReconciliation, setPaymentReconciliation] = useState<CustomerBalanceReconciliation>();
  const [paymentShiftOpen, setPaymentShiftOpen] = useState<boolean | null>(null);
  const [paymentToast, setPaymentToast] = useState<'recorded' | 'reversed' | ''>('');
  const [paymentReceipt, setPaymentReceipt] = useState<{
    amountMillimes: number;
    balanceBefore: number;
    balanceAfter: number;
    note?: string;
    occurredAt: string;
  } | null>(null);
  const [receiptShareError, setReceiptShareError] = useState('');
  const [reverseTarget, setReverseTarget] = useState<CustomerLedgerEntry | null>(null);
  const [reversePin, setReversePin] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState('');
  const reverseSubmissionRef = useRef(false);
  const [statementMode, setStatementMode] = useState<'view' | 'share' | null>(null);
  const [overdueStatement, setOverdueStatement] = useState<CustomerStatementData | null>(null);
  const [overdueAction, setOverdueAction] = useState<{ customerId: string; action: 'statement' | 'share' } | null>(null);
  const [overdueActionError, setOverdueActionError] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [expandedLedgerId, setExpandedLedgerId] = useState('');

  const refresh = useCallback(async () => {
    if (!storeId) {
      setCustomers([]);
      setSelected(null);
      setLoadedCustomerId(customerId);
      setSummary({ totalOutstandingMillimes: 0, customersOwing: 0, overdueCount: 0 });
      return;
    }

    const [records, nextStore] = await Promise.all([
      customerService.listCustomers(storeId),
      userService.getStore(storeId),
    ]);
    const creditStatusesPromise = customerService.getCreditStatuses(storeId, records);
    const dueInfosPromise = customerService.getDueInfos(storeId, records);
    const alertsPromise = Promise.all([creditStatusesPromise, dueInfosPromise]).then(([creditStatuses, dueInfos]) =>
      notificationService.listCustomerCreditAlerts(storeId, records, { creditStatuses, dueInfos }),
    );
    const [nextCreditStatuses, nextDueInfos, nextAlerts, nextCreditNotifications] = await Promise.all([
      creditStatusesPromise,
      dueInfosPromise,
      alertsPromise,
      user?.role === 'owner'
        ? notificationService.listFor(user).then((entries) => entries.filter((entry) => entry.type.startsWith('customer_credit_') || entry.type === 'customer_overdue'))
        : Promise.resolve([]),
    ]);
    const nextSummary = customerService.getAccountsSummaryFromData(records, nextCreditStatuses, nextDueInfos);
    setCustomers(records);
    setCreditStatuses(nextCreditStatuses);
    setDueInfos(nextDueInfos);
    setSummary(nextSummary);
    setCreditAlerts(nextAlerts);
    setCreditNotifications(nextCreditNotifications);
    setStore(nextStore);

    if (customerId) {
      const customer = await customerService.getCustomer(customerId, storeId);
      if (customer) {
        const [status, due, nextLedger, nextOrders, nextTransactions, reconciliation] = await Promise.all([
          nextCreditStatuses[customer.id] ? Promise.resolve(nextCreditStatuses[customer.id]) : customerService.getCreditStatus(customer.id),
          nextDueInfos[customer.id] ? Promise.resolve(nextDueInfos[customer.id]) : customerService.getDueInfo(customer),
          customerService.listLedger(customer.id),
          customerService.getOrderHistory(customer.id),
          customerService.listTransactions(customer.id),
          customerService.getBalanceReconciliation(customer.id),
        ]);
        setSelected(customer);
        setCreditStatuses((current) => ({ ...current, [customer.id]: status }));
        setDueInfos((current) => ({ ...current, [customer.id]: due }));
        setLedger(nextLedger);
        setOrders(nextOrders);
        setTransactions(nextTransactions);
        setPaymentReconciliation(reconciliation);
        setLoadedCustomerId(customerId);
      } else {
        setSelected(null);
        setLedger([]);
        setOrders([]);
        setTransactions([]);
        setLoadedCustomerId(customerId);
      }
    } else {
      setSelected(null);
      setLedger([]);
      setOrders([]);
      setTransactions([]);
      setLoadedCustomerId(undefined);
    }

    if (user?.role === 'staff') {
      const [nextCanCreate, nextCanEdit, nextCanSettle, nextCanTakeOrders] = await Promise.all([
        userService.hasPermission(user.id, 'customers_create'),
        userService.hasPermission(user.id, 'customers_edit'),
        userService.hasPermission(user.id, 'settle_tabs'),
        userService.hasPermission(user.id, 'take_orders'),
      ]);
      setCanCreate(nextCanCreate);
      setCanEdit(nextCanEdit);
      setCanSettle(nextCanSettle);
      setCanTakeOrders(nextCanTakeOrders);
    }
    setError('');
  }, [customerId, storeId, user]);

  useEffect(() => {
    if (searchParams.get('filter') === 'overdue') setFilter('overdue');
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refresh()
      .catch((loadError: unknown) => {
        console.error('Unable to load customers.', loadError);
        if (active) {
          setError(t('customers.errors.load'));
          if (customerId) setLoadedCustomerId(customerId);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const refreshOnFocus = () => {
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to refresh customers.', loadError);
        if (active) {
          setError(t('customers.errors.load'));
          if (customerId) setLoadedCustomerId(customerId);
        }
      });
    };
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, refreshOnFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, refreshOnFocus);
    };
  }, [customerId, refresh]);

  const customerSearchIndex = useMemo(
    () => new Map(customers.map((customer) => [
      customer.id,
      [customer.name, customer.phone, customer.email]
        .filter((value): value is string => value !== undefined)
        .map((value) => value.toLocaleLowerCase()),
    ])),
    [customers],
  );
  const filteredCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const result = customers.filter((customer) => {
      const status = creditStatuses[customer.id];
      const balance = status?.balance ?? 0;
      const matchesSearch = !normalizedSearch || (customerSearchIndex.get(customer.id)
        ?.some((value) => value.includes(normalizedSearch)) ?? false);
      const matchesFilter = filter === 'all' ||
        (filter === 'owes' && balance > 0) ||
        (filter === 'near' && status?.state === 'near') ||
        (filter === 'over' && status?.state === 'over') ||
        (filter === 'overdue' && dueInfos[customer.id]?.overdue) ||
        (filter === 'settled' && balance <= 0);
      return matchesSearch && matchesFilter;
    });
    result.sort((left, right) => {
      if (filter === 'overdue') {
        return (dueInfos[left.id]?.oldestUnpaidAt ?? '').localeCompare(dueInfos[right.id]?.oldestUnpaidAt ?? '') ||
          left.name.localeCompare(right.name);
      }
      if (sort === 'name') return left.name.localeCompare(right.name);
      if (sort === 'lastPayment') return (right.lastPaymentAt ? new Date(right.lastPaymentAt).getTime() : 0) -
        (left.lastPaymentAt ? new Date(left.lastPaymentAt).getTime() : 0);
      return (creditStatuses[right.id]?.balance ?? 0) - (creditStatuses[left.id]?.balance ?? 0);
    });
    return result;
  }, [creditStatuses, customerSearchIndex, customers, dueInfos, filter, search, sort]);

  async function openOverdueStatement(customer: CustomerRecord) {
    setOverdueAction({ customerId: customer.id, action: 'statement' });
    setOverdueActionError('');
    try {
      setOverdueStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (statementError) {
      console.error('Unable to load the customer statement.', statementError);
      setOverdueActionError(t('customers.errors.statementLoad'));
    } finally {
      setOverdueAction(null);
    }
  }

  async function shareOverdueStatement(customer: CustomerRecord) {
    setOverdueAction({ customerId: customer.id, action: 'share' });
    setOverdueActionError('');
    try {
      const statement = await customerService.getStatementData(customer.id, storeId);
      await shareCustomerStatement(statement);
    } catch (shareError) {
      if (!(shareError instanceof Error && shareError.name === 'AbortError')) {
        setOverdueActionError(customerErrorMessage(shareError, 'customers.errors.statementShare'));
      }
    } finally {
      setOverdueAction(null);
    }
  }

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const visibleLedger = useMemo(() => ledger.filter((entry) => {
    const date = localDateKey(new Date(entry.occurredAt));
    return (!ledgerFrom || date >= ledgerFrom) && (!ledgerTo || date <= ledgerTo);
  }), [ledger, ledgerFrom, ledgerTo]);
  const selectedStatus = selected ? creditStatuses[selected.id] : undefined;
  const selectedDue = selected ? dueInfos[selected.id] : undefined;
  const paymentAmountMillimes = parseNonNegativeMillimes(paymentAmount) ?? 0;
  const paymentBalance = selectedStatus?.balance ?? 0;
  const paymentExceedsBalance = paymentAmountMillimes > paymentBalance;

  useEffect(() => {
    if (!paymentToast) return;
    const timeout = window.setTimeout(() => setPaymentToast(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [paymentToast]);

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError('');
    setNotice('');
    try {
      const created = await customerService.createCustomer({
        storeId,
        actorId: user.id,
        name: draft.name,
        phone: draft.phone,
        email: draft.email,
        notes: draft.notes,
        creditLimitMillimes: parseMillimes(draft.creditLimit, false),
        settlementTerms: draft.settlementTerms,
      });
      setDraft(EMPTY_DRAFT);
      setAddOpen(false);
      await refresh();
      navigate(`/customers/${created.id}`);
      setNotice(t('customers.notice.added'));
    } catch (createError) {
      setError(customerErrorMessage(createError, 'customers.errors.add'));
    }
  }

  function beginEdit() {
    if (!selected) return;
    setClearCreditLimit(false);
    setEditDraft({
      name: selected.name,
      phone: selected.phone ?? '',
      email: selected.email ?? '',
      creditLimit: '',
      settlementTerms: selected.settlementTerms,
      notes: selected.notes ?? '',
    });
    setEditOpen(true);
    setError('');
    setNotice('');
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    setError('');
    setNotice('');
    try {
      await customerService.updateCustomer(selected.id, {
        name: editDraft.name,
        phone: editDraft.phone,
        email: editDraft.email,
        creditLimitMillimes: editDraft.creditLimit.trim()
          ? parseMillimes(editDraft.creditLimit, false)
          : clearCreditLimit ? undefined : selected.creditLimitMillimes,
        settlementTerms: editDraft.settlementTerms,
        notes: editDraft.notes,
      }, user.id);
      setEditOpen(false);
      await refresh();
      setNotice(t('customers.notice.updated'));
    } catch (updateError) {
      setError(customerErrorMessage(updateError, 'customers.errors.update'));
    }
  }

  async function beginTakePayment() {
    if (!selected || !user) return;
    setError('');
    setPaymentAmount('');
    setPaymentNote('');
    setPaymentShiftOpen(null);
    setPaymentOpen(true);
    try {
      setPaymentShiftOpen(Boolean(await shiftService.getOpenShiftForUser(storeId, user.id)));
    } catch (shiftError) {
      setPaymentOpen(false);
      setError(customerErrorMessage(shiftError, 'customers.errors.checkShift'));
    }
  }

  async function sharePaymentReceipt() {
    if (!selected || !paymentReceipt) return;
    setReceiptShareError('');
    try {
      const text = [
        store?.name ?? '',
        t('customers.receipt.paymentTitle'),
        selected.name,
        new Date(paymentReceipt.occurredAt).toLocaleString(getLanguage()),
        t('customers.receipt.payment', { amount: money(paymentReceipt.amountMillimes) }),
        t('customers.receipt.balanceBefore', { amount: money(paymentReceipt.balanceBefore) }),
        t('customers.receipt.balanceAfter', { amount: money(paymentReceipt.balanceAfter) }),
        ...(paymentReceipt.note ? [t('customers.receipt.note', { note: paymentReceipt.note })] : []),
      ].filter(Boolean).join('\n');
      await shareTextAsPdf(text, `payment-receipt-${selected.name}`, t('customers.receipt.title', { name: selected.name }));
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return;
      setReceiptShareError(customerErrorMessage(shareError, 'customers.errors.shareReceipt'));
    }
  }

  async function settle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    if (paymentSubmissionRef.current) return;
    paymentSubmissionRef.current = true;
    paymentIdempotencyKeyRef.current ??= crypto.randomUUID();
    setError('');
    setNotice('');
    try {
      const balanceBefore = selectedStatus?.balance ?? 0;
      const record = await customerService.settleTab({
        storeId,
        customerId: selected.id,
        staffId: user.id,
        amountMillimes: parseMillimes(paymentAmount, true) ?? 0,
        paymentMethod,
        idempotencyKey: paymentIdempotencyKeyRef.current,
        note: paymentNote,
      });
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentOpen(false);
      let balanceAfter = balanceBefore - record.amountMillimes;
      try {
        await refresh();
        balanceAfter = await customerService.getBalance(selected.id);
      } catch {
        setError(t('customers.errors.refreshBalance'));
      }
      setPaymentReceipt({
        amountMillimes: record.amountMillimes,
        balanceBefore,
        balanceAfter,
        note: record.note,
        occurredAt: record.createdAt,
      });
      setPaymentToast('recorded');
      paymentIdempotencyKeyRef.current = undefined;
    } catch (paymentError) {
      setError(customerErrorMessage(paymentError, 'customers.errors.recordPayment'));
      if (paymentError instanceof Error && paymentError.message.includes('Open your shift')) setPaymentShiftOpen(false);
    } finally {
      paymentSubmissionRef.current = false;
    }
  }

  function beginReversePayment(entry: CustomerLedgerEntry) {
    setReverseTarget(entry);
    setReversePin('');
    setReverseReason('');
    setReverseError('');
  }

  async function reversePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user || !reverseTarget) return;
    if (reverseSubmissionRef.current) return;
    reverseSubmissionRef.current = true;
    setReverseError('');
    try {
      await customerService.reversePayment({
        storeId,
        customerId: selected.id,
        paymentId: reverseTarget.id,
        ownerId: user.id,
        pin: reversePin,
        reason: reverseReason,
      });
      setReverseTarget(null);
      setReversePin('');
      setReverseReason('');
      setPaymentToast('reversed');
      try {
        await refresh();
      } catch {
        setError(t('customers.errors.refreshCustomer'));
      }
    } catch (reverseErrorValue) {
      setReverseError(customerErrorMessage(reverseErrorValue, 'customers.errors.reversePayment'));
    } finally {
      reverseSubmissionRef.current = false;
    }
  }

  async function archiveSelected() {
    if (!selected || !user) return;
    setError('');
    setNotice('');
    try {
      await customerService.archiveCustomer(selected.id, user.id);
      setArchiveOpen(false);
      navigate('/customers', { replace: true });
      await refresh();
      setNotice(t('customers.notice.archived'));
    } catch (archiveError) {
      setError(customerErrorMessage(archiveError, 'customers.errors.archive'));
    }
  }

  function localizedCreditNotification(notification: NotificationRecord) {
    const customer = customers.find((entry) => entry.id === notification.customerId);
    const name = customer?.name ?? '';
    const amount = money(creditStatuses[notification.customerId ?? '']?.balance ?? 0);
    if (notification.type === 'customer_overdue') {
        return {
          title: t('customers.notifications.overdueTitle'),
          body: t('customers.notifications.overdueBody', { name, amount }),
        };
    }
    if (notification.type === 'customer_credit_limit') {
        return {
          title: t('customers.notifications.limitTitle'),
          body: t('customers.notifications.limitBody', { name }),
        };
    }
    return {
        title: t('customers.notifications.warningTitle'),
        body: t('customers.notifications.warningBody', { name }),
    };
  }

  const listContent = (
    <div className="pb-24">
        <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} />

        <section aria-label={t('customers.summary.label')} className="customer-summary mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SummaryCard className="col-span-2 sm:col-span-1" icon="account_balance_wallet" label={t('customers.summary.totalOutstanding')} value={`${formatCustomerTnd(summary.totalOutstandingMillimes / 1000)} DT`} tone="primary" />
          <SummaryCard icon="groups" label={t('customers.summary.owing')} value={String(summary.customersOwing)} tone="success" />
          <SummaryCard icon="event_busy" label={t('customers.summary.overdue')} value={String(summary.overdueCount)} tone="error" />
      </section>

      {creditAlerts.length > 0 && (
          <section aria-label={t('customers.notifications.credit')} className="mb-4 flex flex-col gap-2">
          {creditAlerts.map((alert) => (
            <p key={alert.customerId} className={`rounded-xl p-3 font-body text-body-sm ${alert.severity === 'error' ? 'bg-error-container text-on-error-container' : 'bg-warning-container text-on-warning-container'}`}>
                <strong>{alert.customerName}:</strong> {alert.kind === 'overdue'
                  ? t('customers.alert.overdue')
                  : alert.kind === 'limit'
                    ? t('customers.alert.limit')
                    : t('customers.alert.nearLimit')}
            </p>
          ))}
        </section>
      )}
      {creditNotifications.length > 0 && (
          <section aria-label={t('customers.notifications.recent')} className="mb-4 flex flex-col gap-2">
          {creditNotifications.slice(0, 3).map((notification) => (
            <p key={notification.id} role="status" className={`rounded-xl p-3 font-body text-body-sm ${notification.type === 'customer_credit_limit' || notification.type === 'customer_overdue' ? 'bg-error-container text-on-error-container' : 'bg-warning-container text-on-warning-container'}`}>
                {(() => {
                  const copy = localizedCreditNotification(notification);
                  return <><strong>{copy.title}:</strong> {copy.body}</>;
                })()}
            </p>
          ))}
        </section>
      )}

      <div className="customer-controls mb-3">
        <label className="customer-search relative">
          <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('customers.search.placeholder')}
            aria-label={t('customers.search.label')}
            className="h-11 w-full rounded-xl bg-surface-container-lowest pl-10 pr-3 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        <div className="scrollbar-hidden customer-filter-row flex gap-1.5 overflow-x-auto" role="group" aria-label={t('customers.filter.label')}>
          {filterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`min-h-10 shrink-0 rounded-full px-3 font-body text-label-md ${filter === option.id ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'}`}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        {filter !== 'overdue' && (
          <label className="customer-sort flex items-center gap-2 font-body text-label-sm text-on-surface-variant">
            <span>{t('customers.sort.label')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as CustomerSort)} className="h-11 min-w-44 rounded-lg bg-surface-container-lowest px-3 text-on-surface">
              <option value="balance">{t('customers.sort.balance')}</option>
              <option value="name">{t('customers.sort.name')}</option>
              <option value="lastPayment">{t('customers.sort.lastPayment')}</option>
            </select>
          </label>
        )}
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {overdueActionError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{overdueActionError}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}
      {loading ? (
        <ListSkeleton label={t('customers.loading.list')} />
      ) : filteredCustomers.length > 0 ? (
        <CardGrid className="mobile-card-list customer-card-list">
          <LazyBatch
            items={filteredCustomers}
            resetKey={`${filter}-${search}`}
            initial={6}
            step={6}
            rootSelector={isDetail ? '.customer-split-list' : undefined}
            renderItem={(customer) => {
            const dueInfo = dueInfos[customer.id];
            if (isOwner && filter === 'overdue' && dueInfo?.overdue) {
              return (
                <OverdueCustomerRow
                  key={customer.id}
                  entry={{ customer, dueInfo, balanceMillimes: creditStatuses[customer.id]?.balance ?? 0 }}
                  busyAction={overdueAction?.customerId === customer.id ? overdueAction.action : null}
                  onStatement={() => { void openOverdueStatement(customer); }}
                  onShare={() => { void shareOverdueStatement(customer); }}
                />
              );
            }
            return (
              <CustomerCard
                key={customer.id}
                customer={customer}
                status={creditStatuses[customer.id]}
                overdue={Boolean(dueInfo?.overdue)}
                onClick={() => navigate(`/customers/${customer.id}`)}
              />
            );
          }} />
        </CardGrid>
      ) : (
        <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">
          {customers.length ? t('customers.empty.filtered') : t('customers.empty.list')}
        </p>
      )}

      {canCreate && (
        <Button
          onClick={() => { setError(''); setAddOpen(true); }}
          className={`customer-add-button fixed right-4 z-30 min-h-12 rounded-full px-4 shadow-overlay ${isOwner ? 'bottom-6' : 'bottom-24'}`}
        >
          <MaterialIcon name="person_add" />{t('customers.action.add')}
        </Button>
      )}
    </div>
  );

  const detailContent = (
    <div className="customer-detail-content pb-6">
      <div className="customer-detail-toolbar">
        <Button variant="ghost" onClick={() => navigate('/customers')} className="customer-detail-back min-h-9 px-2">
        <MaterialIcon name="arrow_back" />{t('customers.action.back')}
        </Button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}
      {loading || (isDetail && loadedCustomerId !== customerId) ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('customers.loading.detail')}</p>
      ) : !selected ? (
        error ? null : <p role="alert" className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('customers.notFound')}</p>
      ) : (
        <>
          <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-display text-headline-sm text-primary">{initials(selected.name)}</span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-headline-lg text-on-surface">{selected.name}</h1>
              <p className="truncate font-body text-body-sm text-on-surface-variant">{[selected.phone, selected.email].filter(Boolean).join(' · ') || t('customers.contact.none')}</p>
              <p className="font-body text-body-sm text-outline">{t('customers.terms', { terms: settlementTermsLabel(selected.settlementTerms), date: dateLabel(selected.lastPaymentAt) })}</p>
              {selected.notes?.trim() && (
                <p className="mt-1 line-clamp-2 font-body text-body-sm text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{t('customers.note.label')}</span> {selected.notes.trim()}
                </p>
              )}
            </div>
            {selectedDue?.overdue && <span className="rounded-full bg-error-container px-3 py-1 font-body text-label-sm text-on-error-container">{t('customers.status.overdue')}</span>}
          </header>

          <section className="mb-4 flex flex-col items-center gap-3 rounded-2xl bg-surface-container-lowest p-5 shadow-card sm:flex-row sm:justify-center sm:gap-8">
            <CreditRing status={selectedStatus} />
            <div className="text-center sm:text-left">
              <p className="font-body text-label-sm uppercase text-outline">{t('customers.credit.remaining')}</p>
              <p className="mt-1 font-display text-headline-lg text-on-surface">{selectedStatus?.remaining === undefined ? t('customers.credit.noLimit') : `${formatCustomerTnd(selectedStatus.remaining / 1000)} DT`}</p>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                {selectedStatus?.limit === undefined
                  ? t('customers.credit.currentBalance', { amount: money(selectedStatus?.balance ?? 0) })
                  : t('customers.credit.usedOf', { used: formatCustomerTnd(Math.max(0, selectedStatus.balance) / 1000), limit: formatCustomerTnd(selectedStatus.limit / 1000) })}
              </p>
              {selectedDue?.nextDueAt && <p className={`mt-1 font-body text-body-sm ${selectedDue.overdue ? 'text-error-dark' : 'text-on-surface-variant'}`}>{selectedDue.overdue ? t('customers.due.overdueSince', { date: dateLabel(selectedDue.nextDueAt) }) : t('customers.due.next', { date: dateLabel(selectedDue.nextDueAt) })}</p>}
            </div>
          </section>

          <section aria-label={t('customers.actions.label')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {canTakeOrders && selected.isActive && (
              <ActionButton icon="point_of_sale" label={t('customers.action.addOrder')} onClick={() => navigate('/pos', { state: { customerId: selected.id } })} />
            )}
            {canSettle && selected.isActive && (selectedStatus?.balance ?? 0) > 0 && (
              <ActionButton icon="payments" label={t('customers.action.takePayment')} onClick={() => { void beginTakePayment(); }} />
            )}
            {canEdit && <ActionButton icon="edit" label={t('customers.action.edit')} onClick={beginEdit} />}
            <ActionButton icon="receipt_long" label={t('customers.action.statement')} onClick={() => setStatementMode('view')} />
            <ActionButton icon="share" label={t('customers.action.shareStatement')} onClick={() => setStatementMode('share')} />
            {isOwner && (
              <ActionButton
                icon="archive"
                label={t('customers.action.archive')}
                disabled={(selectedStatus?.balance ?? 0) !== 0}
                onClick={() => setArchiveOpen(true)}
              />
            )}
          </section>
          {isOwner && (selectedStatus?.balance ?? 0) !== 0 && <p className="mb-4 font-body text-body-sm text-outline">{t('customers.archive.disabledHelp')}</p>}

          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-headline-md text-on-surface">{t('customers.ledger.title')}</h2>
                <p className="font-body text-body-sm text-on-surface-variant">{t('customers.ledger.subtitle')}</p>
              </div>
              <button type="button" onClick={() => { setLedgerFrom(''); setLedgerTo(''); }} className="min-h-10 px-2 font-body text-label-md text-primary">{t('customers.date.clear')}</button>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <label className="font-body text-label-sm text-on-surface-variant">{t('customers.date.from')}<input type="date" value={ledgerFrom} onChange={(event) => setLedgerFrom(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 text-on-surface" /></label>
              <label className="font-body text-label-sm text-on-surface-variant">{t('customers.date.to')}<input type="date" value={ledgerTo} onChange={(event) => setLedgerTo(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 text-on-surface" /></label>
            </div>
            {visibleLedger.length > 0 ? (
              <ol className="flex flex-col">
                {visibleLedger.map((entry) => {
                  const order = entry.orderId ? ordersById.get(entry.orderId) : undefined;
                  const expanded = expandedLedgerId === entry.id;
                  return (
                    <li key={entry.id} className="border-t border-outline-variant py-3 first:border-t-0">
                      <button
                        type="button"
                        disabled={!order}
                        onClick={() => { if (order) setExpandedLedgerId(expanded ? '' : entry.id); }}
                        aria-expanded={order ? expanded : undefined}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-left ${entry.kind === 'payment' ? 'text-success-dark' : 'text-secondary'}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-body text-label-md">{entry.kind === 'issued' ? t('customers.statement.ticket', { number: order?.number ?? entry.orderNumber ?? '—' }) : entry.kind === 'payment' ? t('customers.statement.cashPayment') : t('customers.statement.paymentReversed')}</span>
                          <span className="mt-0.5 block font-body text-body-sm text-on-surface-variant">{new Date(entry.occurredAt).toLocaleString(getLanguage())}</span>
                        </span>
                        <span className="text-right">
                          <strong className="block font-body text-label-md">{entry.amountMillimes < 0 ? '−' : '+'}{money(entry.amountMillimes)}</strong>
                          <span className="mt-0.5 block font-body text-body-sm text-on-surface-variant">{t('customers.balance.label', { amount: balanceMoney(entry.balanceMillimes) })}</span>
                        </span>
                      </button>
                      {entry.note && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('customers.ledger.note', { note: entry.note })}</p>}
                      {isOwner && entry.kind === 'payment' && !entry.reversed && (
                        <Button type="button" variant="ghost" onClick={() => beginReversePayment(entry)} className="mt-1 min-h-9 px-2 text-label-sm text-error-dark">
                          <MaterialIcon name="undo" className="text-base" />{t('customers.action.reversePayment')}
                        </Button>
                      )}
                      {expanded && order && (
                        <div className="mt-2 rounded-lg bg-surface-container-low p-3">
                          <p className="mb-2 font-body text-label-md text-on-surface">{t('customers.ledger.ticketItems', { number: order.number })}</p>
                          {order.items.map((item, index) => (
                            <p key={`${item.itemId}-${index}`} className="flex justify-between gap-2 py-1 font-body text-body-sm text-on-surface-variant">
                              <span>{item.quantity} × {item.name}{item.modifiers.length ? ` (${item.modifiers.join(', ')})` : ''}</span>
                              <span>{formatCustomerTnd(item.lineTotalMillimes / 1000)} DT</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-outline">{t('customers.ledger.empty')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );

  const page = isDetail ? detailContent : listContent;
  return (
    <>
      {isOwner ? (
        <WorkspaceLayout title={t('customers.heading')} storeName={store?.name} links={ownerWorkspaceLinks}>
          {isDetail ? (
            <div className="customer-split-view">
              <SplitView list={<div className="customer-split-list">{listContent}</div>} detail={detailContent} />
            </div>
          ) : page}
        </WorkspaceLayout>
      ) : (
        <div className="min-h-screen bg-surface">
          <TopBar title={t('customers.title')} storeName={store?.name} />
          <main className="mx-auto w-full p-0"><PageContainer>{page}</PageContainer></main>
          <BottomNav />
        </div>
      )}

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title={t('customers.form.addTitle')}>
        {error && <FormError message={error} />}
        <CustomerForm draft={draft} setDraft={setDraft} onSubmit={addCustomer} submitLabel={t('customers.action.add')} />
      </BottomSheet>
      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title={t('customers.form.editTitle')}>
        {error && <FormError message={error} />}
        <CustomerForm
          draft={editDraft}
          setDraft={setEditDraft}
          onSubmit={saveCustomer}
          submitLabel={t('customers.form.save')}
          isEditing
          hasExistingCreditLimit={selected?.creditLimitMillimes !== undefined}
          clearCreditLimit={clearCreditLimit}
          onClearCreditLimit={() => {
            setClearCreditLimit(true);
            setEditDraft((current) => ({ ...current, creditLimit: '' }));
          }}
          onCreditLimitChange={() => setClearCreditLimit(false)}
        />
      </BottomSheet>
      <BottomSheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title={t('customers.payment.title')}>
        {error && <FormError message={error} />}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl bg-primary-fixed p-4">
            <p className="font-body text-label-sm text-primary">{t('customers.payment.currentBalance', { name: selected?.name ?? '' })}</p>
            <p className="mt-1 font-display text-headline-lg text-on-surface">{balanceMoney(paymentBalance)}</p>
          </section>
          {paymentReconciliation && paymentReconciliation.unresolvedReversalMillimes > 0 && (
            <section className="rounded-xl bg-warning-container p-4 text-on-warning-container" role="status">
              <p className="font-body text-label-md">
                {t('customers.payment.ambiguousReversals', { count: paymentReconciliation.unresolvedReversals.length })}
              </p>
              <p className="mt-1 font-body text-body-sm">
                {t('customers.payment.unresolvedAmount', { amount: money(paymentReconciliation.unresolvedReversalMillimes) })}
              </p>
            </section>
          )}
          {paymentShiftOpen === false && (
            <section className="rounded-xl bg-warning-container p-4" role="status">
              <p className="font-body text-label-md text-on-warning-container">{t('customers.payment.openShiftRequired')}</p>
              <Button type="button" variant="secondary" onClick={() => navigate(isOwner ? '/owner/shifts' : '/shift')} className="mt-3 w-full">
                <MaterialIcon name="open_in_new" />{t('customers.payment.openShift')}
              </Button>
            </section>
          )}
          {paymentShiftOpen === null && <p role="status" className="font-body text-body-sm text-outline">{t('customers.payment.checkingShift')}</p>}
          <div className="flex flex-col gap-3">
            <p className="font-body text-label-md text-on-surface">{t('customers.payment.quickAmount')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={paymentShiftOpen !== true || paymentBalance <= 0} onClick={() => setPaymentAmount(formatMillimes(paymentBalance))}>
                {t('customers.payment.fullBalance')}
              </Button>
              <Button type="button" variant="secondary" disabled={paymentShiftOpen !== true || paymentBalance <= 0} onClick={() => setPaymentAmount(formatMillimes(Math.round(paymentBalance / 2)))}>
                {t('customers.payment.half')}
              </Button>
            </div>
            <label htmlFor="customer-payment-amount" className="font-body text-label-md text-on-surface">{t('customers.payment.customAmount')}</label>
            <DinarInput
              id="customer-payment-amount"
              disabled={paymentShiftOpen !== true}
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-display text-title-md tabular-nums"
            />
            <p className="font-body text-label-md text-on-surface">{t('customers.payment.balanceAfter')}</p>
            <p className={`rounded-lg bg-surface-container-low p-3 font-display text-title-md tabular-nums ${paymentBalance - paymentAmountMillimes < 0 ? 'text-error-dark' : 'text-on-surface'}`}>
              {balanceMoney(paymentBalance - paymentAmountMillimes)}
            </p>
            {paymentExceedsBalance && !store?.allowCustomerCreditBalance && (
              <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">
                {t('customers.payment.exceedsBalance')}
              </p>
            )}
            {paymentExceedsBalance && store?.allowCustomerCreditBalance && (
              <p className="rounded-lg bg-primary-fixed p-3 font-body text-body-sm text-primary">
                {t('customers.payment.extraCredit', { amount: money(paymentAmountMillimes - paymentBalance) })}
              </p>
            )}
            <div>
              <p className="mb-2 font-body text-label-md text-on-surface">{t('customers.payment.method')}</p>
              <div className="flex flex-wrap gap-2">
                {(['cash', 'card', 'other'] as Exclude<PaymentMethod, 'tab'>[])
                  .filter((method) => method === 'cash' || (method === 'card' ? store?.allowCardPayments : store?.allowOtherPayments))
                  .map((method) => (
                    <Button
                      key={method}
                      type="button"
                      variant={paymentMethod === method ? 'primary' : 'secondary'}
                      onClick={() => setPaymentMethod(method)}
                    >
                      {method === 'cash' ? t('customers.payment.cash') : method === 'card' ? t('customers.payment.card') : t('customers.payment.other')}
                    </Button>
                  ))}
              </div>
            </div>
            <label className="font-body text-label-md text-on-surface">{t('customers.payment.noteOptional')}
              <textarea rows={2} value={paymentNote} disabled={paymentShiftOpen !== true} onChange={(event) => setPaymentNote(event.target.value)} className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3" />
            </label>
            <form onSubmit={(event) => { void settle(event); }}>
              <Button type="submit" className="w-full" disabled={paymentShiftOpen !== true || paymentAmountMillimes <= 0 || (paymentExceedsBalance && !store?.allowCustomerCreditBalance)}>
                <MaterialIcon name="payments" />{t('customers.payment.record')}
              </Button>
            </form>
          </div>
        </div>
      </BottomSheet>
      <BottomSheet open={Boolean(paymentReceipt)} onClose={() => setPaymentReceipt(null)} title={t('customers.payment.receiptTitle')}>
        {paymentReceipt && selected && (
          <div className="flex flex-col gap-3">
            <article className="thermal-receipt">
              <header className="receipt-center">
                <strong>{store?.name}</strong>
                <strong>{t('customers.payment.receiptHeading')}</strong>
                <div>{selected.name}</div>
                <div>{new Date(paymentReceipt.occurredAt).toLocaleString(getLanguage())}</div>
              </header>
              <div className="receipt-rule" />
              <div className="receipt-row"><span>{t('customers.payment.receiptPayment')}</span><strong>{money(paymentReceipt.amountMillimes)}</strong></div>
              <div className="receipt-row"><span>{t('customers.payment.balanceBefore')}</span><span>{balanceMoney(paymentReceipt.balanceBefore)}</span></div>
              <div className="receipt-row"><span>{t('customers.payment.balanceAfterReceipt')}</span><strong>{balanceMoney(paymentReceipt.balanceAfter)}</strong></div>
              {paymentReceipt.note && <div className="receipt-item">{t('customers.receipt.note', { note: paymentReceipt.note })}</div>}
              <div className="receipt-rule" />
              <footer className="receipt-center">{t('customers.payment.thankYou')}</footer>
            </article>
            {receiptShareError && <FormError message={receiptShareError} />}
            <Button type="button" variant="secondary" onClick={() => { void sharePaymentReceipt(); }}>
              <MaterialIcon name="share" />{t('customers.payment.sharePdf')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPaymentReceipt(null)}>{t('customers.payment.done')}</Button>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={Boolean(reverseTarget)} onClose={() => setReverseTarget(null)} title={t('customers.reverse.title')}>
        {reverseTarget && (
          <form onSubmit={(event) => { void reversePayment(event); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">
              {t('customers.reverse.explanation', { amount: money(Math.abs(reverseTarget.amountMillimes)), name: selected?.name ?? '' })}
            </p>
            <label className="font-body text-label-md text-on-surface">{t('customers.reverse.reason')}
              <textarea required value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3" />
            </label>
            <label className="font-body text-label-md text-on-surface">{t('customers.reverse.pin')}</label>
            <div className="flex justify-center gap-3" aria-label={t('customers.reverse.pinProgress', { entered: reversePin.length })}>
              {[0, 1, 2, 3].map((index) => <span key={index} className={`h-4 w-4 rounded-full ${index < reversePin.length ? 'bg-primary' : 'bg-surface-container-highest'}`} />)}
            </div>
            <Keypad
              onPress={(digit) => setReversePin((value) => value.length < 4 ? `${value}${digit}` : value)}
              onClear={() => setReversePin('')}
              onBackspace={() => setReversePin((value) => value.slice(0, -1))}
            />
            {reverseError && <FormError message={reverseError} />}
            <Button type="submit" variant="danger" disabled={reversePin.length !== 4 || !reverseReason.trim()}>
              <MaterialIcon name="undo" />{t('customers.reverse.confirm')}
            </Button>
          </form>
        )}
      </BottomSheet>
      <BottomSheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title={t('customers.archive.title')}>
        {error && <FormError message={error} />}
        <p className="mb-4 font-body text-body-md text-on-surface-variant">{t('customers.archive.confirmation', { name: selected?.name ?? '' })}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setArchiveOpen(false)}>{t('customers.archive.cancel')}</Button>
          <Button variant="danger" onClick={() => { void archiveSelected(); }}>{t('customers.archive.confirm')}</Button>
        </div>
      </BottomSheet>
      {statementMode && selected && (
        <TabStatementView
          customer={selected}
          storeName={store?.name ?? ''}
          balanceMillimes={selectedStatus?.balance ?? 0}
          transactions={transactions}
          orders={orders}
          onClose={() => setStatementMode(null)}
          autoShare={statementMode === 'share'}
        />
      )}
      {overdueStatement && (
        <TabStatementView
          customer={overdueStatement.customer}
          storeName={store?.name ?? ''}
          balanceMillimes={overdueStatement.balanceMillimes}
          transactions={overdueStatement.transactions}
          orders={overdueStatement.orders}
          onClose={() => setOverdueStatement(null)}
        />
      )}
      {paymentToast && <div role="status" className="fixed left-1/2 top-20 z-[60] -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{paymentToast === 'reversed' ? t('customers.reverse.paymentReversed') : t('customers.payment.recorded')}</div>}
    </>
  );
}

function CustomerForm({ draft, setDraft, onSubmit, submitLabel, isEditing = false, hasExistingCreditLimit = false, clearCreditLimit = false, onClearCreditLimit, onCreditLimitChange }: {
  draft: CustomerDraft;
  setDraft: (value: CustomerDraft | ((current: CustomerDraft) => CustomerDraft)) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  isEditing?: boolean;
  hasExistingCreditLimit?: boolean;
  clearCreditLimit?: boolean;
  onClearCreditLimit?: () => void;
  onCreditLimitChange?: () => void;
}) {
  function update<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form onSubmit={(event) => { onSubmit(event); }} className="flex flex-col gap-3">
      <label className="font-body text-label-md text-on-surface">{t('customers.form.name')}<input required value={draft.name} onChange={(event) => update('name', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">{t('customers.form.phone')}<input value={draft.phone} onChange={(event) => update('phone', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">{t('customers.form.emailOptional')}<input type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">{t('customers.form.creditLimit')}<DinarInput value={draft.creditLimit} onChange={(event) => { update('creditLimit', event.target.value); onCreditLimitChange?.(); }} placeholder={isEditing && hasExistingCreditLimit ? t('customers.form.savedLimitPlaceholder') : t('customers.form.noLimitPlaceholder')} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      {isEditing && hasExistingCreditLimit && (
        <button
          type="button"
          onClick={() => {
            if (clearCreditLimit) {
              onCreditLimitChange?.();
            } else {
              onClearCreditLimit?.();
            }
          }}
          className="self-start font-body text-label-md text-primary"
        >
          {clearCreditLimit ? t('customers.form.keepLimit') : t('customers.form.removeLimit')}
        </button>
      )}
      <label className="font-body text-label-md text-on-surface">{t('customers.form.settlementTerms')}
        <select value={draft.settlementTerms} onChange={(event) => update('settlementTerms', event.target.value as CustomerRecord['settlementTerms'])} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
          <option value="weekly">{t('customers.form.weekly')}</option><option value="monthly">{t('customers.form.monthly')}</option><option value="anytime">{t('customers.form.anytime')}</option>
        </select>
      </label>
      <label className="font-body text-label-md text-on-surface">{t('customers.form.notes')}<textarea rows={3} value={draft.notes} onChange={(event) => update('notes', event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low p-3" /></label>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}

function SummaryCard({ icon, label, value, tone, className = '' }: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'success' | 'error';
  className?: string;
}) {
  const toneClass = tone === 'success'
    ? 'bg-success-container text-on-success-container'
    : tone === 'error'
      ? 'bg-error-container text-on-error-container'
      : 'bg-primary-fixed text-primary';
  return (
    <article className={`rounded-xl bg-surface-container-lowest p-3 shadow-card md:flex md:min-h-[84px] md:items-center md:gap-3 ${className}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}><MaterialIcon name={icon} /></span>
      <div className="mt-3 min-w-0 md:mt-0">
        <p className="font-body text-body-sm text-on-surface-variant">{label}</p>
        <p className="mt-0.5 truncate font-display text-headline-sm tabular-nums text-on-surface md:text-headline-md">{value}</p>
      </div>
    </article>
  );
}

function FormError({ message }: { message: string }) {
  return <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{message}</p>;
}

function CustomerCard({ customer, status, overdue, onClick }: {
  customer: CustomerRecord;
  status?: CustomerCreditStatus;
  overdue: boolean;
  onClick: () => void;
}) {
  const balance = status?.balance ?? 0;
  const used = Math.max(0, balance);
  const percent = status?.percentUsed ?? 0;
  const progress = Math.min(100, Math.max(0, percent));
  const progressTone = status ? getCustomerCreditTone(status.state, progress).barClass : 'bg-surface-container-high';
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card transition active:scale-[0.995]">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-display text-title-md text-primary">{initials(customer.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="truncate font-display text-title-md text-on-surface">{customer.name}</strong>
            {overdue && <span className="shrink-0 rounded-full bg-error-container px-2 py-0.5 font-body text-label-sm text-on-error-container">{t('customers.status.overdue')}</span>}
          </span>
          <span className="mt-0.5 block truncate font-body text-body-sm text-on-surface-variant">{customer.phone || t('customers.cards.noPhone')}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-body text-body-sm text-on-surface-variant">{t('customers.cards.balance')}</span>
          <strong className={`font-display text-title-md tabular-nums ${balance > 0 ? 'text-on-surface' : 'text-success-dark'}`}>{balanceMoney(balance)}</strong>
        </span>
      </div>
      {status?.limit !== undefined ? (
        <span className="mt-3 block">
          <span className="mb-1 flex items-center justify-between font-body text-label-sm">
            <span className="text-on-surface-variant">{t('customers.cards.creditUsed')}</span>
            <strong className="tabular-nums text-on-surface">{Math.round(progress)}%</strong>
          </span>
          <span className="customer-credit-progress-track relative block h-2.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('customers.cards.percentUsed', { percent: Math.round(progress) })}>
            <span aria-hidden="true" className={`customer-credit-progress-fill ${progressTone}`} style={{ width: `${progress}%` }} />
          </span>
          <span className="mt-1.5 flex items-center justify-between gap-2 font-body text-label-sm text-on-surface-variant">
            <span>{formatCustomerTnd(used / 1000)} DT / {formatCustomerTnd(status.limit / 1000)} DT</span>
            <span>{t('customers.cards.amountLeft', { amount: formatCustomerTnd((status.remaining ?? 0) / 1000) })}</span>
          </span>
        </span>
      ) : (
        <span className="mt-3 block font-body text-body-sm text-on-surface-variant">{t('customers.cards.noCreditLimit')}</span>
      )}
      <span className="mt-2 flex items-center justify-between gap-2 font-body text-body-sm text-outline">
        <span>{t('customers.cards.lastPayment', { date: dateLabel(customer.lastPaymentAt) })}</span>
        <MaterialIcon name="chevron_right" className="text-lg" />
      </span>
    </button>
  );
}

function CreditRing({ status }: { status?: CustomerCreditStatus }) {
  const percent = Math.min(100, Math.max(0, status?.percentUsed ?? 0));
  const greenEnd = Math.min(percent, 45);
  const orangeEnd = Math.min(percent, 55);
  return (
    <div
      aria-label={status?.limit === undefined ? t('customers.cards.noCreditLimit') : t('customers.cards.percentUsed', { percent: Math.round(percent) })}
      className="customer-credit-ring flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
      style={{
        background: status?.limit === undefined
          ? 'conic-gradient(rgb(var(--color-surface-container-high)) 0% 100%)'
          : `conic-gradient(rgb(var(--color-success-dark)) 0% ${greenEnd}%, rgb(var(--color-warning)) ${greenEnd}% ${orangeEnd}%, rgb(var(--color-error)) ${orangeEnd}% ${percent}%, rgb(var(--color-surface-container-high)) ${percent}% 100%)`,
      }}
    >
      <div className="customer-credit-ring__inner flex h-20 w-20 flex-col items-center justify-center rounded-full bg-surface-container-lowest">
        <span className="font-display text-headline-md tabular-nums text-on-surface">{status?.limit === undefined ? '—' : `${Math.round(percent)}%`}</span>
        <span className="font-body text-body-sm text-outline">{t('customers.cards.used')}</span>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled = false }: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="secondary" disabled={disabled} onClick={onClick} className="min-h-12 px-2 text-label-md">
      <MaterialIcon name={icon} className="text-lg" />{label}
    </Button>
  );
}
