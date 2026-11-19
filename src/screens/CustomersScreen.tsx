import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ownerWorkspaceLinks } from '../app/navigation';
import { CardGrid, PageContainer, PageHeader, SplitView } from '../components/layout';
import { BottomNav } from '../components/BottomNav';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { OverdueCustomerRow } from '../components/OverdueCustomerRow';
import { TabStatementView } from '../components/TabStatementView';
import { TopBar } from '../components/TopBar';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatTnd } from '../lib/format';
import { getCustomerCreditTone } from '../lib/customerCredit';
import { customerService } from '../services/customerService';
import { shareCustomerStatement } from '../services/customerStatementShare';
import { shiftService } from '../services/shiftService';
import type { CustomerCreditAlert } from '../services/notificationService';
import { notificationService } from '../services/notificationService';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CustomerRecord } from '../types/domain';
import type { CustomerCreditStatus, CustomerDueInfo, CustomerLedgerEntry, CustomerStatementData } from '../services/customerService';
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

const filterOptions: { id: CustomerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owes', label: 'Owes' },
  { id: 'near', label: 'Near limit' },
  { id: 'over', label: 'Over limit' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'settled', label: 'Settled' },
];

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function money(millimes: number): string {
  return `${formatTnd(Math.abs(millimes) / 1000)} DT`;
}

function balanceMoney(millimes: number): string {
  return millimes < 0 ? `Credit ${money(millimes)}` : money(millimes);
}

function parseMoney(value: string, required: boolean): number | undefined {
  if (!value.trim() && !required) return undefined;
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || (required && parsed === 0)) {
    throw new Error(required ? 'Enter a payment greater than zero.' : 'Enter a non-negative amount.');
  }
  return Math.round(parsed * 1000);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join('') || '?';
}

function dateLabel(value?: string): string {
  if (!value) return 'No payments yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No payments yet' : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function progressColor(status?: CustomerCreditStatus) {
  return getCustomerCreditTone(status?.state ?? 'no_limit', status?.percentUsed);
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
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentShiftOpen, setPaymentShiftOpen] = useState<boolean | null>(null);
  const [paymentToast, setPaymentToast] = useState('');
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
      setSummary({ totalOutstandingMillimes: 0, customersOwing: 0, overdueCount: 0 });
      return;
    }

    const [records, nextStore] = await Promise.all([
      customerService.listCustomers(storeId),
      userService.getStore(storeId),
    ]);
    const [statusEntries, dueEntries, nextSummary, nextAlerts, nextCreditNotifications] = await Promise.all([
      Promise.all(records.map(async (customer) => [customer.id, await customerService.getCreditStatus(customer.id)] as const)),
      Promise.all(records.map(async (customer) => [customer.id, await customerService.getDueInfo(customer)] as const)),
      customerService.getAccountsSummary(storeId),
      notificationService.listCustomerCreditAlerts(storeId),
      user?.role === 'owner'
        ? notificationService.listFor(user).then((entries) => entries.filter((entry) => entry.type.startsWith('customer_credit_') || entry.type === 'customer_overdue'))
        : Promise.resolve([]),
    ]);
    setCustomers(records);
    setCreditStatuses(Object.fromEntries(statusEntries));
    setDueInfos(Object.fromEntries(dueEntries));
    setSummary(nextSummary);
    setCreditAlerts(nextAlerts);
    setCreditNotifications(nextCreditNotifications);
    setStore(nextStore);

    if (customerId) {
      const customer = await customerService.getCustomer(customerId, storeId);
      if (customer) {
        const [status, due, nextLedger, nextOrders, nextTransactions] = await Promise.all([
          customerService.getCreditStatus(customer.id),
          customerService.getDueInfo(customer),
          customerService.listLedger(customer.id),
          customerService.getOrderHistory(customer.id),
          customerService.listTransactions(customer.id),
        ]);
        setSelected(customer);
        setCreditStatuses((current) => ({ ...current, [customer.id]: status }));
        setDueInfos((current) => ({ ...current, [customer.id]: due }));
        setLedger(nextLedger);
        setOrders(nextOrders);
        setTransactions(nextTransactions);
      } else {
        setSelected(null);
        setLedger([]);
        setOrders([]);
        setTransactions([]);
      }
    } else {
      setSelected(null);
      setLedger([]);
      setOrders([]);
      setTransactions([]);
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
        if (active) setError('Unable to load customers. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const refreshOnFocus = () => {
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to refresh customers.', loadError);
        if (active) setError('Unable to load customers. Please try again.');
      });
    };
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, refreshOnFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, refreshOnFocus);
    };
  }, [refresh]);

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const result = customers.filter((customer) => {
      const status = creditStatuses[customer.id];
      const balance = status?.balance ?? 0;
      const matchesSearch = !normalizedSearch || [customer.name, customer.phone, customer.email]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
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
  }, [creditStatuses, customers, dueInfos, filter, search, sort]);

  async function openOverdueStatement(customer: CustomerRecord) {
    setOverdueAction({ customerId: customer.id, action: 'statement' });
    setOverdueActionError('');
    try {
      setOverdueStatement(await customerService.getStatementData(customer.id, storeId));
    } catch (statementError) {
      console.error('Unable to load the customer statement.', statementError);
      setOverdueActionError('Unable to load the customer statement. Please try again.');
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
        setOverdueActionError(shareError instanceof Error ? shareError.message : 'Unable to share the customer statement.');
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
  const paymentAmountNumber = Number(paymentAmount.trim().replace(',', '.'));
  const paymentAmountMillimes = paymentAmount.trim() && Number.isFinite(paymentAmountNumber) && paymentAmountNumber >= 0
    ? Math.round(paymentAmountNumber * 1000)
    : 0;
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
        creditLimitMillimes: parseMoney(draft.creditLimit, false),
        settlementTerms: draft.settlementTerms,
      });
      setDraft(EMPTY_DRAFT);
      setAddOpen(false);
      await refresh();
      navigate(`/customers/${created.id}`);
      setNotice('Customer added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add customer.');
    }
  }

  function beginEdit() {
    if (!selected) return;
    setEditDraft({
      name: selected.name,
      phone: selected.phone ?? '',
      email: selected.email ?? '',
      creditLimit: selected.creditLimitMillimes === undefined ? '' : (selected.creditLimitMillimes / 1000).toFixed(3),
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
        creditLimitMillimes: parseMoney(editDraft.creditLimit, false),
        settlementTerms: editDraft.settlementTerms,
        notes: editDraft.notes,
      }, user.id);
      setEditOpen(false);
      await refresh();
      setNotice('Customer updated.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update customer.');
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
      setError(shiftError instanceof Error ? shiftError.message : 'Unable to check your shift.');
    }
  }

  function pressPaymentAmount(value: string) {
    setPaymentAmount((current) => {
      if (value === '.') {
        return current.includes('.') ? current : `${current || '0'}.`;
      }
      const fraction = current.split('.')[1];
      if (fraction !== undefined && fraction.length >= 3) return current;
      return `${current}${value}`;
    });
  }

  async function sharePaymentReceipt() {
    if (!selected || !paymentReceipt) return;
    setReceiptShareError('');
    try {
      const text = [
        store?.name ?? '',
        'Customer payment receipt',
        selected.name,
        new Date(paymentReceipt.occurredAt).toLocaleString(),
        `Payment: ${money(paymentReceipt.amountMillimes)}`,
        `Balance before: ${money(paymentReceipt.balanceBefore)}`,
        `Balance after payment: ${money(paymentReceipt.balanceAfter)}`,
        ...(paymentReceipt.note ? [`Note: ${paymentReceipt.note}`] : []),
      ].filter(Boolean).join('\n');
      if (navigator.share) await navigator.share({ title: `Payment receipt — ${selected.name}`, text });
      else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else throw new Error('Sharing is not available in this browser.');
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return;
      setReceiptShareError(shareError instanceof Error ? shareError.message : 'Unable to share this payment receipt.');
    }
  }

  async function settle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    setError('');
    setNotice('');
    try {
      const balanceBefore = selectedStatus?.balance ?? 0;
      const record = await customerService.settleTab({
        storeId,
        customerId: selected.id,
        staffId: user.id,
        amountMillimes: parseMoney(paymentAmount, true) ?? 0,
        note: paymentNote,
      });
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentOpen(false);
      setPaymentReceipt({
        amountMillimes: record.amountMillimes,
        balanceBefore,
        balanceAfter: balanceBefore - record.amountMillimes,
        note: record.note,
        occurredAt: record.createdAt,
      });
      setPaymentToast('Payment recorded.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Payment recorded, but customer details could not be refreshed: ${refreshError instanceof Error ? refreshError.message : 'Please reload the page.'}`);
      }
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Unable to record this payment.');
      if (paymentError instanceof Error && paymentError.message.includes('Open your shift')) setPaymentShiftOpen(false);
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
      setPaymentToast('Payment reversed.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Payment reversed, but customer details could not be refreshed: ${refreshError instanceof Error ? refreshError.message : 'Please reload the page.'}`);
      }
    } catch (reverseErrorValue) {
      setReverseError(reverseErrorValue instanceof Error ? reverseErrorValue.message : 'Unable to reverse this payment.');
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
      setNotice('Customer archived.');
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Unable to archive customer.');
    }
  }

  const listContent = (
    <div className="pb-24">
      <PageHeader title="Customers & tabs" subtitle="Accounts, balances, and recent payments" />

      <section aria-label="Accounts summary" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryCard className="col-span-2 sm:col-span-1" icon="account_balance_wallet" label="Total outstanding" value={`${formatTnd(summary.totalOutstandingMillimes / 1000)} DT`} tone="primary" />
        <SummaryCard icon="groups" label="Customers owing" value={String(summary.customersOwing)} tone="success" />
        <SummaryCard icon="event_busy" label="Overdue" value={String(summary.overdueCount)} tone="error" />
      </section>

      {creditAlerts.length > 0 && (
        <section aria-label="Credit notifications" className="mb-4 flex flex-col gap-2">
          {creditAlerts.map((alert) => (
            <p key={alert.customerId} className={`rounded-xl p-3 font-body text-body-sm ${alert.severity === 'error' ? 'bg-error-container text-on-error-container' : 'bg-warning-container text-on-warning-container'}`}>
              <strong>{alert.customerName}:</strong> {alert.message}
            </p>
          ))}
        </section>
      )}
      {creditNotifications.length > 0 && (
        <section aria-label="Recent customer credit notifications" className="mb-4 flex flex-col gap-2">
          {creditNotifications.slice(0, 3).map((notification) => (
            <p key={notification.id} role="status" className={`rounded-xl p-3 font-body text-body-sm ${notification.type === 'customer_credit_limit' || notification.type === 'customer_overdue' ? 'bg-error-container text-on-error-container' : 'bg-warning-container text-on-warning-container'}`}>
              <strong>{notification.title}:</strong> {notification.body}
            </p>
          ))}
        </section>
      )}

      <label className="relative mb-3 block">
        <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customers"
          aria-label="Search customers"
          className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <div className="scrollbar-hidden -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Filter customers">
        {filterOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`min-h-10 shrink-0 rounded-full px-4 font-body text-label-md ${filter === option.id ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filter !== 'overdue' && (
        <label className="mb-3 flex items-center justify-between gap-3 font-body text-label-sm text-on-surface-variant">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as CustomerSort)} className="h-11 max-w-56 rounded-lg bg-surface-container-lowest px-3 text-on-surface">
            <option value="balance">Balance high to low</option>
            <option value="name">Name</option>
            <option value="lastPayment">Last payment</option>
          </select>
        </label>
      )}

      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {overdueActionError && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{overdueActionError}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}
      {loading ? (
        <ListSkeleton label="Loading customers" />
      ) : filteredCustomers.length > 0 ? (
        <CardGrid className="mobile-card-list customer-card-list">
          {filteredCustomers.map((customer) => {
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
          })}
        </CardGrid>
      ) : (
        <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">
          {customers.length ? 'No customers match these filters.' : 'No customers yet.'}
        </p>
      )}

      {canCreate && (
        <Button
          onClick={() => { setError(''); setAddOpen(true); }}
          className={`fixed right-4 z-30 min-h-14 rounded-full px-5 shadow-overlay ${isOwner ? 'bottom-6' : 'bottom-24'}`}
        >
          <MaterialIcon name="person_add" />Add customer
        </Button>
      )}
    </div>
  );

  const detailContent = (
    <div className="customer-detail-content pb-6">
      <Button variant="ghost" onClick={() => navigate('/customers')} className="mb-3 min-h-10 px-2">
        <MaterialIcon name="arrow_back" />Customers
      </Button>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}
      {loading ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">Loading customer…</p>
      ) : !selected ? (
        <p role="alert" className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">Customer not found.</p>
      ) : (
        <>
          <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-display text-headline-sm text-primary">{initials(selected.name)}</span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-headline-lg text-on-surface">{selected.name}</h1>
              <p className="truncate font-body text-body-sm text-on-surface-variant">{[selected.phone, selected.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
              <p className="font-body text-body-sm text-outline">Terms: {selected.settlementTerms} · Last payment: {dateLabel(selected.lastPaymentAt)}</p>
            </div>
            {selectedDue?.overdue && <span className="rounded-full bg-error-container px-3 py-1 font-body text-label-sm text-on-error-container">Overdue</span>}
          </header>

          <section className="mb-4 flex flex-col items-center gap-3 rounded-2xl bg-surface-container-lowest p-5 shadow-card sm:flex-row sm:justify-center sm:gap-8">
            <CreditRing status={selectedStatus} />
            <div className="text-center sm:text-left">
              <p className="font-body text-label-sm uppercase text-outline">Remaining credit</p>
              <p className="mt-1 font-display text-headline-lg text-on-surface">{selectedStatus?.remaining === undefined ? 'No limit' : `${formatTnd(selectedStatus.remaining / 1000)} DT`}</p>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                {selectedStatus?.limit === undefined
                  ? `Current balance: ${money(selectedStatus?.balance ?? 0)}`
                  : `${formatTnd(Math.max(0, selectedStatus.balance) / 1000)} of ${formatTnd(selectedStatus.limit / 1000)} DT used`}
              </p>
              {selectedDue?.nextDueAt && <p className={`mt-1 font-body text-body-sm ${selectedDue.overdue ? 'text-error-dark' : 'text-on-surface-variant'}`}>{selectedDue.overdue ? 'Overdue since' : 'Next due'} {dateLabel(selectedDue.nextDueAt)}</p>}
            </div>
          </section>

          <section aria-label="Customer actions" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {canTakeOrders && selected.isActive && (
              <ActionButton icon="point_of_sale" label="Add order" onClick={() => navigate('/pos', { state: { customerId: selected.id } })} />
            )}
            {canSettle && selected.isActive && (selectedStatus?.balance ?? 0) > 0 && (
              <ActionButton icon="payments" label="Take payment" onClick={() => { void beginTakePayment(); }} />
            )}
            {canEdit && <ActionButton icon="edit" label="Edit" onClick={beginEdit} />}
            <ActionButton icon="receipt_long" label="Statement" onClick={() => setStatementMode('view')} />
            <ActionButton icon="share" label="Share statement" onClick={() => setStatementMode('share')} />
            {isOwner && (
              <ActionButton
                icon="archive"
                label="Archive"
                disabled={(selectedStatus?.balance ?? 0) !== 0}
                onClick={() => setArchiveOpen(true)}
              />
            )}
          </section>
          {isOwner && (selectedStatus?.balance ?? 0) !== 0 && <p className="mb-4 font-body text-body-sm text-outline">Archive is available when the tab balance is zero.</p>}

          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-headline-md text-on-surface">Account ledger</h2>
                <p className="font-body text-body-sm text-on-surface-variant">Charges and payments, oldest first</p>
              </div>
              <button type="button" onClick={() => { setLedgerFrom(''); setLedgerTo(''); }} className="min-h-10 px-2 font-body text-label-md text-primary">Clear dates</button>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <label className="font-body text-label-sm text-on-surface-variant">From<input type="date" value={ledgerFrom} onChange={(event) => setLedgerFrom(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 text-on-surface" /></label>
              <label className="font-body text-label-sm text-on-surface-variant">To<input type="date" value={ledgerTo} onChange={(event) => setLedgerTo(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 text-on-surface" /></label>
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
                          <span className="block truncate font-body text-label-md">{entry.description}</span>
                          <span className="mt-0.5 block font-body text-body-sm text-on-surface-variant">{new Date(entry.occurredAt).toLocaleString()}</span>
                        </span>
                        <span className="text-right">
                          <strong className="block font-body text-label-md">{entry.amountMillimes < 0 ? '−' : '+'}{money(entry.amountMillimes)}</strong>
                          <span className="mt-0.5 block font-body text-body-sm text-on-surface-variant">Balance {balanceMoney(entry.balanceMillimes)}</span>
                        </span>
                      </button>
                      {entry.note && <p className="mt-1 font-body text-body-sm text-on-surface-variant">Note: {entry.note}</p>}
                      {isOwner && entry.kind === 'payment' && !entry.reversed && (
                        <Button type="button" variant="ghost" onClick={() => beginReversePayment(entry)} className="mt-1 min-h-9 px-2 text-label-sm text-error-dark">
                          <MaterialIcon name="undo" className="text-base" />Reverse payment
                        </Button>
                      )}
                      {expanded && order && (
                        <div className="mt-2 rounded-lg bg-surface-container-low p-3">
                          <p className="mb-2 font-body text-label-md text-on-surface">Ticket #{order.number} items</p>
                          {order.items.map((item, index) => (
                            <p key={`${item.itemId}-${index}`} className="flex justify-between gap-2 py-1 font-body text-body-sm text-on-surface-variant">
                              <span>{item.quantity} × {item.name}{item.modifiers.length ? ` (${item.modifiers.join(', ')})` : ''}</span>
                              <span>{formatTnd(item.lineTotalMillimes / 1000)} DT</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-outline">No ledger activity for this date range.</p>
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
        <WorkspaceLayout title="Customers" storeName={store?.name} links={ownerWorkspaceLinks}>
          {isDetail ? (
            <div className="customer-split-view">
              <SplitView list={<div className="customer-split-list">{listContent}</div>} detail={detailContent} />
            </div>
          ) : page}
        </WorkspaceLayout>
      ) : (
        <div className="min-h-screen bg-surface">
          <TopBar title="Customers & tabs" storeName={store?.name} />
          <main className="mx-auto w-full p-0"><PageContainer>{page}</PageContainer></main>
          <BottomNav />
        </div>
      )}

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add customer">
        {error && <FormError message={error} />}
        <CustomerForm draft={draft} setDraft={setDraft} onSubmit={addCustomer} submitLabel="Add customer" />
      </BottomSheet>
      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title="Edit customer">
        {error && <FormError message={error} />}
        <CustomerForm draft={editDraft} setDraft={setEditDraft} onSubmit={saveCustomer} submitLabel="Save changes" />
      </BottomSheet>
      <BottomSheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Take payment">
        {error && <FormError message={error} />}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl bg-primary-fixed p-4">
            <p className="font-body text-label-sm text-primary">{selected?.name} · Current balance</p>
            <p className="mt-1 font-display text-headline-lg text-on-surface">{balanceMoney(paymentBalance)}</p>
          </section>
          {paymentShiftOpen === false && (
            <section className="rounded-xl bg-warning-container p-4" role="status">
              <p className="font-body text-label-md text-on-warning-container">Open your shift before accepting a customer payment.</p>
              <Button type="button" variant="secondary" onClick={() => navigate(isOwner ? '/owner/shifts' : '/shift')} className="mt-3 w-full">
                <MaterialIcon name="open_in_new" />Open shift screen
              </Button>
            </section>
          )}
          {paymentShiftOpen === null && <p role="status" className="font-body text-body-sm text-outline">Checking for an open shift…</p>}
          <div className="flex flex-col gap-3">
            <p className="font-body text-label-md text-on-surface">Quick amount</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={paymentShiftOpen !== true || paymentBalance <= 0} onClick={() => setPaymentAmount((paymentBalance / 1000).toFixed(3))}>
                Full balance
              </Button>
              <Button type="button" variant="secondary" disabled={paymentShiftOpen !== true || paymentBalance <= 0} onClick={() => setPaymentAmount((Math.round(paymentBalance / 2) / 1000).toFixed(3))}>
                Half
              </Button>
            </div>
            <label htmlFor="customer-payment-amount" className="font-body text-label-md text-on-surface">Custom amount (TND)</label>
            <input
              id="customer-payment-amount"
              readOnly
              inputMode="none"
              value={paymentAmount}
              placeholder="0.000"
              className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-display text-title-md tabular-nums"
            />
            <Keypad
              decimal
              disabled={paymentShiftOpen !== true}
              onPress={pressPaymentAmount}
              onClear={() => setPaymentAmount('')}
              onBackspace={() => setPaymentAmount((value) => value.slice(0, -1))}
            />
            <p className="font-body text-label-md text-on-surface">Balance after payment</p>
            <p className={`rounded-lg bg-surface-container-low p-3 font-display text-title-md tabular-nums ${paymentBalance - paymentAmountMillimes < 0 ? 'text-error-dark' : 'text-on-surface'}`}>
              {balanceMoney(paymentBalance - paymentAmountMillimes)}
            </p>
            {paymentExceedsBalance && !store?.allowCustomerCreditBalance && (
              <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">
                This payment is more than the current balance. Ask the owner to enable “Allow customer credit balance” in Store settings.
              </p>
            )}
            {paymentExceedsBalance && store?.allowCustomerCreditBalance && (
              <p className="rounded-lg bg-primary-fixed p-3 font-body text-body-sm text-primary">
                The extra {money(paymentAmountMillimes - paymentBalance)} will remain as customer credit.
              </p>
            )}
            <label className="font-body text-label-md text-on-surface">Note (optional)
              <textarea rows={2} value={paymentNote} disabled={paymentShiftOpen !== true} onChange={(event) => setPaymentNote(event.target.value)} className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3" />
            </label>
            <form onSubmit={(event) => { void settle(event); }}>
              <Button type="submit" className="w-full" disabled={paymentShiftOpen !== true || paymentAmountMillimes <= 0 || (paymentExceedsBalance && !store?.allowCustomerCreditBalance)}>
                <MaterialIcon name="payments" />Record payment
              </Button>
            </form>
          </div>
        </div>
      </BottomSheet>
      <BottomSheet open={Boolean(paymentReceipt)} onClose={() => setPaymentReceipt(null)} title="Payment recorded">
        {paymentReceipt && selected && (
          <div className="flex flex-col gap-3">
            <article className="thermal-receipt">
              <header className="receipt-center">
                <strong>{store?.name}</strong>
                <strong>CUSTOMER PAYMENT</strong>
                <div>{selected.name}</div>
                <div>{new Date(paymentReceipt.occurredAt).toLocaleString()}</div>
              </header>
              <div className="receipt-rule" />
              <div className="receipt-row"><span>Payment</span><strong>{money(paymentReceipt.amountMillimes)}</strong></div>
              <div className="receipt-row"><span>Balance before</span><span>{balanceMoney(paymentReceipt.balanceBefore)}</span></div>
              <div className="receipt-row"><span>Balance after payment</span><strong>{balanceMoney(paymentReceipt.balanceAfter)}</strong></div>
              {paymentReceipt.note && <div className="receipt-item">Note: {paymentReceipt.note}</div>}
              <div className="receipt-rule" />
              <footer className="receipt-center">Thank you</footer>
            </article>
            {receiptShareError && <FormError message={receiptShareError} />}
            <Button type="button" variant="secondary" onClick={() => { void sharePaymentReceipt(); }}>
              <MaterialIcon name="share" />Share receipt
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPaymentReceipt(null)}>Done</Button>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={Boolean(reverseTarget)} onClose={() => setReverseTarget(null)} title="Reverse payment">
        {reverseTarget && (
          <form onSubmit={(event) => { void reversePayment(event); }} className="flex flex-col gap-3">
            <p className="font-body text-body-sm text-on-surface-variant">
              Reverse {money(Math.abs(reverseTarget.amountMillimes))} for {selected?.name}. This will restore the amount due and adjust the original shift cash.
            </p>
            <label className="font-body text-label-md text-on-surface">Reason
              <textarea required value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg bg-surface-container-low p-3" />
            </label>
            <label className="font-body text-label-md text-on-surface">Admin PIN</label>
            <div className="flex justify-center gap-3" aria-label={`${reversePin.length} of 4 PIN digits entered`}>
              {[0, 1, 2, 3].map((index) => <span key={index} className={`h-4 w-4 rounded-full ${index < reversePin.length ? 'bg-primary' : 'bg-surface-container-highest'}`} />)}
            </div>
            <Keypad
              onPress={(digit) => setReversePin((value) => value.length < 4 ? `${value}${digit}` : value)}
              onClear={() => setReversePin('')}
              onBackspace={() => setReversePin((value) => value.slice(0, -1))}
            />
            {reverseError && <FormError message={reverseError} />}
            <Button type="submit" variant="danger" disabled={reversePin.length !== 4 || !reverseReason.trim()}>
              <MaterialIcon name="undo" />Confirm reversal
            </Button>
          </form>
        )}
      </BottomSheet>
      <BottomSheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archive customer">
        {error && <FormError message={error} />}
        <p className="mb-4 font-body text-body-md text-on-surface-variant">Archive {selected?.name}? Their record will be hidden from the active customer list.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setArchiveOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { void archiveSelected(); }}>Archive customer</Button>
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
      {paymentToast && <div role="status" className="fixed left-1/2 top-20 z-[60] -translate-x-1/2 rounded-full bg-primary-dark px-4 py-2.5 font-body text-label-md text-white shadow-overlay">{paymentToast}</div>}
    </>
  );
}

function CustomerForm({ draft, setDraft, onSubmit, submitLabel }: {
  draft: CustomerDraft;
  setDraft: (value: CustomerDraft | ((current: CustomerDraft) => CustomerDraft)) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
}) {
  function update<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form onSubmit={(event) => { onSubmit(event); }} className="flex flex-col gap-3">
      <label className="font-body text-label-md text-on-surface">Name<input required value={draft.name} onChange={(event) => update('name', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">Phone<input value={draft.phone} onChange={(event) => update('phone', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">Email (optional)<input type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">Monthly credit limit (TND)<input min="0" step="0.001" inputMode="decimal" value={draft.creditLimit} onChange={(event) => update('creditLimit', event.target.value)} placeholder="No limit" className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" /></label>
      <label className="font-body text-label-md text-on-surface">Settlement terms
        <select value={draft.settlementTerms} onChange={(event) => update('settlementTerms', event.target.value as CustomerRecord['settlementTerms'])} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
          <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="anytime">Anytime</option>
        </select>
      </label>
      <label className="font-body text-label-md text-on-surface">Notes<textarea rows={3} value={draft.notes} onChange={(event) => update('notes', event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low p-3" /></label>
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
    <article className={`rounded-2xl bg-surface-container-lowest p-4 shadow-card ${className}`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}><MaterialIcon name={icon} /></span>
      <p className="mt-3 font-body text-body-sm text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{value}</p>
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
  const tone = progressColor(status);
  const progress = Math.min(100, Math.max(0, percent));
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card transition active:scale-[0.995]">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-display text-title-md text-primary">{initials(customer.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="truncate font-display text-title-md text-on-surface">{customer.name}</strong>
            {overdue && <span className="shrink-0 rounded-full bg-error-container px-2 py-0.5 font-body text-label-sm text-on-error-container">Overdue</span>}
          </span>
          <span className="mt-0.5 block truncate font-body text-body-sm text-on-surface-variant">{customer.phone || 'No phone'}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-body text-body-sm text-on-surface-variant">Balance</span>
          <strong className={`font-display text-title-md tabular-nums ${balance > 0 ? 'text-on-surface' : 'text-success-dark'}`}>{balance < 0 ? `Credit ${money(balance)}` : money(balance)}</strong>
        </span>
      </div>
      {status?.limit !== undefined ? (
        <span className="mt-3 block">
          <span className="block h-2 overflow-hidden rounded-full bg-surface-container-high">
            <span className={`block h-full rounded-full ${tone.barClass}`} style={{ width: `${progress}%` }} />
          </span>
          <span className="mt-1.5 block font-body text-body-sm text-on-surface-variant">
            {formatTnd(used / 1000)} of {formatTnd(status.limit / 1000)} DT used • {formatTnd((status.remaining ?? 0) / 1000)} DT left
          </span>
        </span>
      ) : (
        <span className="mt-3 block font-body text-body-sm text-on-surface-variant">No credit limit</span>
      )}
      <span className="mt-2 flex items-center justify-between gap-2 font-body text-body-sm text-outline">
        <span>Last payment: {dateLabel(customer.lastPaymentAt)}</span>
        <MaterialIcon name="chevron_right" className="text-lg" />
      </span>
    </button>
  );
}

function CreditRing({ status }: { status?: CustomerCreditStatus }) {
  const percent = Math.min(100, Math.max(0, status?.percentUsed ?? 0));
  const tone = progressColor(status);
  return (
    <div
      aria-label={status?.limit === undefined ? 'No credit limit' : `${Math.round(percent)} percent of credit limit used`}
      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${status?.limit === undefined ? '#c8c6c3' : tone.color} ${percent}%, #e8e6e1 ${percent}% 100%)` }}
    >
      <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-surface-container-lowest">
        <span className="font-display text-headline-md tabular-nums text-on-surface">{status?.limit === undefined ? '—' : `${Math.round(percent)}%`}</span>
        <span className="font-body text-body-sm text-outline">used</span>
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
