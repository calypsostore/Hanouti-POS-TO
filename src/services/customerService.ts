import { resolveStoreSettings, type CustomerRecord, type OrderRecord, type TabRecord } from '../types/domain';
import { activityService } from './activityService';
import { userService } from './userService';
import { shiftService } from './shiftService';
import { readData, writeData } from './storage';
import { isSupabaseDriver } from '../data/driver';
import { requireOnlineForAction } from './offlineAvailability';
import { offlineOrderQueue } from './offlineOrderQueue';
import {
  createCustomer as createRemoteCustomer,
  getBalance as getRemoteBalance,
  getCustomer as getRemoteCustomer,
  listCreditBalances as listRemoteCreditBalances,
  listCustomerOrders,
  listCustomers as listRemoteCustomers,
  listTransactions as listRemoteTransactions,
  reversePayment as reverseRemotePayment,
  settleTab as settleRemoteTab,
  updateCustomer as updateRemoteCustomer,
} from '../data/repositories/customerRepository';

type CustomerChanges = Partial<Pick<CustomerRecord,
  'name' | 'phone' | 'email' | 'notes' | 'creditLimitMillimes' | 'settlementTerms'
>>;

export interface CustomerCreditStatus {
  balance: number;
  limit?: number;
  remaining?: number;
  percentUsed?: number;
  state: 'ok' | 'near' | 'over' | 'no_limit';
}

export interface CustomerDueInfo {
  oldestUnpaidAt?: string;
  nextDueAt?: string;
  overdue: boolean;
}

export interface OverdueCustomerRecord {
  customer: CustomerRecord;
  dueInfo: CustomerDueInfo;
  balanceMillimes: number;
}

export interface CustomerStatementData {
  customer: CustomerRecord;
  balanceMillimes: number;
  transactions: TabRecord[];
  orders: OrderRecord[];
}

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  kind: 'issued' | 'payment' | 'reversal';
  occurredAt: string;
  description: string;
  amountMillimes: number;
  balanceMillimes: number;
  orderId?: string;
  orderNumber?: number;
  note?: string;
  reversed?: boolean;
}

export interface AccountsSummary {
  totalOutstandingMillimes: number;
  customersOwing: number;
  overdueCount: number;
}

interface LedgerEvent {
  id: string;
  kind: 'issued' | 'payment' | 'reversal';
  occurredAt: string;
  amountMillimes: number;
  description: string;
  orderId?: string;
  orderNumber?: number;
  note?: string;
  reversed?: boolean;
}

const getCustomers = () => readData<CustomerRecord[]>('customers', []).map((customer) => ({
  ...customer,
  settlementTerms: customer.settlementTerms ?? 'monthly',
  isActive: customer.isActive ?? true,
}));
const getTabs = () => readData<TabRecord[]>('tabs', []);
const getOrders = () => readData<OrderRecord[]>('orders', []);
const saveCustomers = (customers: CustomerRecord[]) => writeData('customers', customers);

async function requireCustomerPermission(actorId: string, storeId: string, permission: 'customers_create' | 'customers_edit'): Promise<void> {
  const actor = await userService.getUser(actorId);
  if (!actor || actor.storeId !== storeId || (actor.role !== 'staff' && actor.role !== 'owner')) {
    throw new Error('This account cannot manage customers for the selected store.');
  }
  if (actor.role === 'staff' && !await userService.hasPermission(actorId, permission)) {
    throw new Error(permission === 'customers_create'
      ? 'Your position does not allow creating customers.'
      : 'Your position does not allow editing customers.');
  }
}

function validateCreditLimit(creditLimitMillimes: number | undefined): void {
  if (creditLimitMillimes !== undefined && (!Number.isInteger(creditLimitMillimes) || creditLimitMillimes < 0)) {
    throw new Error('Credit limit must be a non-negative amount in millimes.');
  }
}

function creditStatusFromBalance(balance: number, creditLimitMillimes: number | undefined): CustomerCreditStatus {
  validateCreditLimit(creditLimitMillimes);
  if (creditLimitMillimes === undefined) return { balance, state: 'no_limit' };
  const limit = creditLimitMillimes;
  const percentUsed = limit === 0 ? (balance > 0 ? 100 : 0) : Math.max(0, balance / limit * 100);
  const state = balance > limit ? 'over' : limit > 0 && percentUsed >= 80 ? 'near' : 'ok';
  return {
    balance,
    limit,
    remaining: Math.max(0, limit - Math.max(0, balance)),
    percentUsed,
    state,
  };
}

function validateSettlementTerms(value: string): asserts value is CustomerRecord['settlementTerms'] {
  if (!['weekly', 'monthly', 'anytime'].includes(value)) throw new Error('Select valid customer settlement terms.');
}

function getLedgerEvents(customerId: string, orders = getOrders(), tabs = getTabs()): LedgerEvent[] {
  const allCustomerOrders = orders.filter((order) => order.customerId === customerId && order.paymentMethod === 'tab');
  const tabOrders = allCustomerOrders.filter((order) =>
    order.customerId === customerId && order.paymentMethod === 'tab' && order.status === 'done',
  );
  const orderIds = new Set(allCustomerOrders.map((order) => order.id));
  const issued: LedgerEvent[] = tabOrders.map((order) => ({
    id: order.id,
    kind: 'issued',
    occurredAt: order.createdAt,
    amountMillimes: order.totalMillimes,
    description: `Ticket #${order.number}`,
    orderId: order.id,
    orderNumber: order.number,
  }));
  for (const tab of tabs) {
    if (tab.customerId !== customerId) continue;
    if (tab.kind === 'issued' && (!tab.orderId || !orderIds.has(tab.orderId))) {
      issued.push({
        id: tab.id,
        kind: 'issued',
        occurredAt: tab.createdAt,
        amountMillimes: tab.amountMillimes,
        description: 'Tab charge',
        orderId: tab.orderId,
      });
    } else if (tab.kind === 'settled') {
      issued.push({
        id: tab.id,
        kind: 'payment',
        occurredAt: tab.createdAt,
        amountMillimes: tab.amountMillimes,
        description: 'Cash payment',
        note: tab.note,
        reversed: tabs.some((candidate) => candidate.kind === 'reversal' && candidate.reversesTabId === tab.id),
      });
    } else if (tab.kind === 'reversal') {
      issued.push({
        id: tab.id,
        kind: 'reversal',
        occurredAt: tab.createdAt,
        amountMillimes: tab.amountMillimes,
        description: 'Payment reversed',
        note: tab.note,
      });
    }
  }
  return issued.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) ||
    (left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind === 'issued' ? -1 : 1),
  );
}

function ledgerBalance(customerId: string): number {
  return getLedgerEvents(customerId).reduce((balance, event) =>
    balance + (event.kind === 'payment' ? -event.amountMillimes : event.amountMillimes), 0);
}

async function getLedgerEventsForCustomer(customerId: string): Promise<LedgerEvent[]> {
  if (!isSupabaseDriver()) return getLedgerEvents(customerId);
  const [orders, tabs] = await Promise.all([
    listCustomerOrders(customerId),
    listRemoteTransactions(customerId),
  ]);
  return getLedgerEvents(customerId, orders, tabs);
}

function oldestUnpaidIssue(events: LedgerEvent[]): LedgerEvent | undefined {
  const unpaid: { event: LedgerEvent; remaining: number }[] = [];
  let credit = 0;
  for (const event of events) {
    if (event.kind !== 'payment') {
      const covered = Math.min(credit, event.amountMillimes);
      credit -= covered;
      const remaining = event.amountMillimes - covered;
      if (remaining > 0) unpaid.push({ event, remaining });
      continue;
    }
    let payment = event.amountMillimes;
    for (const issue of unpaid) {
      const applied = Math.min(payment, issue.remaining);
      issue.remaining -= applied;
      payment -= applied;
      if (payment === 0) break;
    }
    if (payment > 0) credit += payment;
  }
  return unpaid.find((issue) => issue.remaining > 0)?.event;
}

function dueDateFor(issueAt: string, terms: CustomerRecord['settlementTerms']): Date | undefined {
  if (terms === 'anytime') return undefined;
  const due = new Date(issueAt);
  if (Number.isNaN(due.getTime())) return undefined;
  if (terms === 'weekly') {
    due.setUTCDate(due.getUTCDate() + 7);
    return due;
  }
  const day = due.getUTCDate();
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return due;
}

async function getCachedCreditStatus(customerId: string, additionalMillimes: number): Promise<CustomerCreditStatus> {
  const cached = await offlineOrderQueue.getCustomerCredit(customerId);
  if (!cached) throw new Error('The customer credit status is not cached. Reconnect before using this tab.');
  const balance = cached.status.balance + additionalMillimes;
  if (cached.status.limit === undefined) return { ...cached.status, balance };
  const percentUsed = cached.status.limit === 0 ? (balance > 0 ? 100 : 0) : Math.max(0, balance / cached.status.limit * 100);
  return {
    ...cached.status,
    balance,
    remaining: Math.max(0, cached.status.limit - Math.max(0, balance)),
    percentUsed,
    state: balance > cached.status.limit ? 'over' : cached.status.limit > 0 && percentUsed >= 80 ? 'near' : 'ok',
  };
}

export const customerService = {
  async listCustomers(storeId: string): Promise<CustomerRecord[]> {
    if (isSupabaseDriver()) return listRemoteCustomers(storeId);
    return getCustomers()
      .filter((customer) => customer.storeId === storeId && customer.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getCustomer(customerId: string, storeId?: string): Promise<CustomerRecord | undefined> {
    if (isSupabaseDriver()) return getRemoteCustomer(customerId, storeId);
    return getCustomers().find((customer) => customer.id === customerId && (!storeId || customer.storeId === storeId));
  },

  async createCustomer(input: {
    storeId: string;
    actorId: string;
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
    creditLimitMillimes?: number;
    settlementTerms?: CustomerRecord['settlementTerms'];
  }): Promise<CustomerRecord> {
    const trimmedName = input.name.trim();
    if (!trimmedName) throw new Error('Customer name is required.');
    const store = await userService.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    await requireCustomerPermission(input.actorId, input.storeId, 'customers_create');
    validateCreditLimit(input.creditLimitMillimes);
    if (input.settlementTerms !== undefined) validateSettlementTerms(input.settlementTerms);
    if (isSupabaseDriver()) {
      const customer = await createRemoteCustomer({
        storeId: input.storeId,
        name: trimmedName,
        phone: input.phone?.trim() || undefined,
        email: input.email?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        creditLimitMillimes: input.creditLimitMillimes,
        settlementTerms: input.settlementTerms ?? resolveStoreSettings(store.settings).defaultSettlementTerms,
        isActive: true,
      });
      await activityService.log({
        storeId: customer.storeId,
        actorId: input.actorId,
        action: 'customer.created',
        summary: `Created customer "${customer.name}".`,
        entityType: 'customer',
        entityId: customer.id,
        meta: { after: customer },
      });
      return customer;
    }
    const customer: CustomerRecord = {
      id: `customer-${crypto.randomUUID()}`,
      storeId: input.storeId,
      name: trimmedName,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      creditLimitMillimes: input.creditLimitMillimes,
      settlementTerms: input.settlementTerms ?? resolveStoreSettings(store.settings).defaultSettlementTerms,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    saveCustomers([...getCustomers(), customer]);
    await activityService.log({
      storeId: customer.storeId,
      actorId: input.actorId,
      action: 'customer.created',
      summary: `Created customer "${customer.name}".`,
      entityType: 'customer',
      entityId: customer.id,
      meta: { after: customer },
    });
    return customer;
  },

  async updateCustomer(customerId: string, changes: CustomerChanges, actorId: string): Promise<CustomerRecord> {
    if (isSupabaseDriver()) {
      const customer = await getRemoteCustomer(customerId);
      if (!customer) throw new Error('Customer could not be found.');
      await requireCustomerPermission(actorId, customer.storeId, 'customers_edit');
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Customer name is required.');
      validateCreditLimit(changes.creditLimitMillimes);
      if (changes.settlementTerms !== undefined) validateSettlementTerms(changes.settlementTerms);
      const updated = await updateRemoteCustomer(customerId, {
        ...changes,
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone.trim() || undefined } : {}),
        ...(changes.email !== undefined ? { email: changes.email.trim() || undefined } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes.trim() || undefined } : {}),
      });
      await activityService.log({
        storeId: customer.storeId,
        actorId,
        action: 'customer.updated',
        summary: `Updated customer "${updated.name}".`,
        entityType: 'customer',
        entityId: customer.id,
        meta: { before: customer, after: updated },
      });
      return updated;
    }
    const customers = getCustomers();
    const customer = customers.find((candidate) => candidate.id === customerId);
    if (!customer) throw new Error('Customer could not be found.');
    await requireCustomerPermission(actorId, customer.storeId, 'customers_edit');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Customer name is required.');
    validateCreditLimit(changes.creditLimitMillimes);
    if (changes.settlementTerms !== undefined) validateSettlementTerms(changes.settlementTerms);
    const updated: CustomerRecord = {
      ...customer,
      ...changes,
      name: changes.name?.trim() ?? customer.name,
      phone: changes.phone !== undefined ? changes.phone.trim() || undefined : customer.phone,
      email: changes.email !== undefined ? changes.email.trim() || undefined : customer.email,
      notes: changes.notes !== undefined ? changes.notes.trim() || undefined : customer.notes,
    };
    saveCustomers(customers.map((candidate) => candidate.id === customerId ? updated : candidate));
    await activityService.log({
      storeId: customer.storeId,
      actorId,
      action: 'customer.updated',
      summary: `Updated customer "${updated.name}".`,
      entityType: 'customer',
      entityId: customer.id,
      meta: { before: customer, after: updated },
    });
    return updated;
  },

  async archiveCustomer(customerId: string, actorId: string): Promise<CustomerRecord> {
    const customer = await this.getCustomer(customerId);
    if (!customer) throw new Error('Customer could not be found.');
    const actor = await userService.getUser(actorId);
    if (!actor || actor.role !== 'owner' || actor.storeId !== customer.storeId) {
      throw new Error('Only this store owner can archive customers.');
    }
    if (await this.getBalance(customerId) !== 0) {
      throw new Error('This customer cannot be archived while their tab balance is not zero.');
    }
    if (isSupabaseDriver()) {
      const archived = await updateRemoteCustomer(customerId, { isActive: false });
      await activityService.log({
        storeId: customer.storeId,
        actorId,
        action: 'customer.archived',
        summary: `Archived customer "${customer.name}".`,
        entityType: 'customer',
        entityId: customer.id,
        meta: { before: { isActive: customer.isActive }, after: { isActive: archived.isActive } },
      });
      return archived;
    }
    const customers = getCustomers();
    const archived = { ...customer, isActive: false };
    saveCustomers(customers.map((candidate) => candidate.id === customerId ? archived : candidate));
    await activityService.log({
      storeId: customer.storeId,
      actorId,
      action: 'customer.archived',
      summary: `Archived customer "${customer.name}".`,
      entityType: 'customer',
      entityId: customer.id,
      meta: { before: { isActive: customer.isActive }, after: { isActive: archived.isActive } },
    });
    return archived;
  },

  async getBalance(customerId: string): Promise<number> {
    if (isSupabaseDriver()) return getRemoteBalance(customerId);
    return ledgerBalance(customerId);
  },

  async getCreditStatuses(
    storeId: string,
    customers: CustomerRecord[],
  ): Promise<Record<string, CustomerCreditStatus>> {
    if (customers.some((customer) => customer.storeId !== storeId)) {
      throw new Error('Customer credit status request contains a customer from another store.');
    }
    if (!isSupabaseDriver()) {
      return Object.fromEntries(await Promise.all(customers.map(async (customer) => [
        customer.id,
        creditStatusFromBalance(ledgerBalance(customer.id), customer.creditLimitMillimes),
      ] as const)));
    }
    const readOfflineSnapshot = async () => Object.fromEntries(await Promise.all(customers.map(async (customer) => [
      customer.id,
      await getCachedCreditStatus(customer.id, 0),
    ] as const)));
    if (typeof navigator !== 'undefined' && !navigator.onLine) return readOfflineSnapshot();
    try {
      const balances = await listRemoteCreditBalances(storeId);
      const balancesByCustomer = new Map(balances.map((entry) => [entry.customerId, entry]));
      return Object.fromEntries(customers.map((customer) => {
        const balance = balancesByCustomer.get(customer.id);
        if (!balance) throw new Error(`Credit status is missing for customer "${customer.id}".`);
        return [
          customer.id,
          creditStatusFromBalance(balance.balanceMillimes, balance.creditLimitMillimes ?? undefined),
        ];
      }));
    } catch (error) {
      if (offlineOrderQueue.isNetworkFailure(error)) return readOfflineSnapshot();
      throw error;
    }
  },

  async getCreditStatus(customerId: string, additionalMillimes = 0): Promise<CustomerCreditStatus> {
    if (!Number.isInteger(additionalMillimes) || additionalMillimes < 0) {
      throw new Error('Additional credit must be a non-negative amount in millimes.');
    }
    if (isSupabaseDriver()) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return getCachedCreditStatus(customerId, additionalMillimes);
      try {
        const customer = await this.getCustomer(customerId);
        if (!customer) throw new Error('Customer could not be found.');
        const balance = (await getRemoteBalance(customerId)) + additionalMillimes;
        return creditStatusFromBalance(balance, customer.creditLimitMillimes);
      } catch (error) {
        if (offlineOrderQueue.isNetworkFailure(error)) return getCachedCreditStatus(customerId, additionalMillimes);
        throw error;
      }
    }
    const customer = await this.getCustomer(customerId);
    if (!customer) throw new Error('Customer could not be found.');
    validateCreditLimit(customer.creditLimitMillimes);
    const balance = ledgerBalance(customerId) + additionalMillimes;
    if (customer.creditLimitMillimes === undefined) return { balance, state: 'no_limit' };
    const limit = customer.creditLimitMillimes;
    const percentUsed = limit === 0 ? (balance > 0 ? 100 : 0) : Math.max(0, balance / limit * 100);
    const state = balance > limit ? 'over' : limit > 0 && percentUsed >= 80 ? 'near' : 'ok';
    return {
      balance,
      limit,
      remaining: Math.max(0, limit - Math.max(0, balance)),
      percentUsed,
      state,
    };
  },

  async getAccountsSummary(storeId: string): Promise<AccountsSummary> {
    const customers = await this.listCustomers(storeId);
    const summaries = await Promise.all(customers.map(async (customer) => ({
      status: await this.getCreditStatus(customer.id),
      due: await this.getDueInfo(customer),
    })));
    return summaries.reduce<AccountsSummary>((summary, { status, due }) => {
      if (status.balance > 0) {
        summary.totalOutstandingMillimes += status.balance;
        summary.customersOwing += 1;
        if (due.overdue) summary.overdueCount += 1;
      }
      return summary;
    }, { totalOutstandingMillimes: 0, customersOwing: 0, overdueCount: 0 });
  },

  async getDueInfo(customer: CustomerRecord): Promise<CustomerDueInfo> {
    const oldestIssue = oldestUnpaidIssue(await getLedgerEventsForCustomer(customer.id));
    if (!oldestIssue) return { overdue: false };
    const due = dueDateFor(oldestIssue.occurredAt, customer.settlementTerms);
    return {
      oldestUnpaidAt: oldestIssue.occurredAt,
      nextDueAt: due?.toISOString(),
      overdue: due ? Date.now() > due.getTime() : false,
    };
  },

  async listOverdueCustomers(storeId: string): Promise<OverdueCustomerRecord[]> {
    const customers = await this.listCustomers(storeId);
    const entries = await Promise.all(customers.map(async (customer) => {
      const [status, dueInfo] = await Promise.all([
        this.getCreditStatus(customer.id),
        this.getDueInfo(customer),
      ]);
      return { customer, dueInfo, balanceMillimes: status.balance };
    }));
    return entries
      .filter((entry) => entry.dueInfo.overdue && entry.balanceMillimes > 0)
      .sort((left, right) =>
        (left.dueInfo.oldestUnpaidAt ?? '').localeCompare(right.dueInfo.oldestUnpaidAt ?? '') ||
        left.customer.name.localeCompare(right.customer.name),
      );
  },

  async getStatementData(customerId: string, storeId?: string): Promise<CustomerStatementData> {
    const customer = await this.getCustomer(customerId, storeId);
    if (!customer) throw new Error('Customer could not be found.');
    const [status, transactions, orders] = await Promise.all([
      this.getCreditStatus(customer.id),
      this.listTransactions(customer.id),
      this.getOrderHistory(customer.id),
    ]);
    return { customer, balanceMillimes: status.balance, transactions, orders };
  },

  async listLedger(customerId: string): Promise<CustomerLedgerEntry[]> {
    if (!await this.getCustomer(customerId)) throw new Error('Customer could not be found.');
    let balance = 0;
    return (await getLedgerEventsForCustomer(customerId)).map((event) => {
      const amountMillimes = event.kind === 'payment' ? -event.amountMillimes : event.amountMillimes;
      balance += amountMillimes;
      return {
        id: event.id,
        customerId,
        kind: event.kind,
        occurredAt: event.occurredAt,
        description: event.description,
        amountMillimes,
        balanceMillimes: balance,
        orderId: event.orderId,
        orderNumber: event.orderNumber,
        note: event.note,
        reversed: event.reversed,
      };
    });
  },

  async getOrderHistory(customerId: string): Promise<OrderRecord[]> {
    if (isSupabaseDriver()) return listCustomerOrders(customerId);
    return getOrders().filter((order) => order.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listTransactions(customerId: string): Promise<TabRecord[]> {
    if (isSupabaseDriver()) return listRemoteTransactions(customerId);
    return getTabs().filter((tab) => tab.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async settleTab(input: { storeId: string; customerId: string; staffId: string; amountMillimes: number; note?: string }): Promise<TabRecord> {
    requireOnlineForAction('Tab payments');
    if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new Error('Enter a payment greater than zero.');
    if (isSupabaseDriver()) {
      const customer = await getRemoteCustomer(input.customerId, input.storeId);
      if (!customer?.isActive) throw new Error('Customer could not be found in this store.');
      const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
      if (!shift) throw new Error('The business day is closed. Open a new shift to continue.');
      return settleRemoteTab({
        customerId: customer.id,
        amountMillimes: input.amountMillimes,
        shiftId: shift.id,
        note: input.note,
      });
    }
    const actor = await userService.getUser(input.staffId);
    if (!actor || actor.storeId !== input.storeId || (actor.role !== 'staff' && actor.role !== 'owner')) {
      throw new Error('This account cannot settle tabs for the selected store.');
    }
    if (actor.role === 'staff' && !await userService.hasPermission(input.staffId, 'settle_tabs')) {
      throw new Error('Your position does not allow settling customer tabs.');
    }
    const customer = await this.getCustomer(input.customerId, input.storeId);
    if (!customer || !customer.isActive) throw new Error('Customer could not be found in this store.');
    const store = await userService.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    if (input.amountMillimes > ledgerBalance(customer.id) && !store.allowCustomerCreditBalance) {
      throw new Error('This payment exceeds the balance. Ask the owner to enable customer credit balances in Store settings.');
    }
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('The business day is closed. Open a new shift to continue.');
    const createdAt = new Date().toISOString();
    const record: TabRecord = {
      id: `tab-${crypto.randomUUID()}`,
      storeId: input.storeId,
      customerId: input.customerId,
      shiftId: shift.id,
      staffId: input.staffId,
      kind: 'settled',
      paymentMethod: 'cash',
      amountMillimes: input.amountMillimes,
      note: input.note?.trim() || undefined,
      createdAt,
    };
    writeData('tabs', [...getTabs(), record]);
    saveCustomers(getCustomers().map((candidate) => candidate.id === customer.id
      ? { ...candidate, lastPaymentAt: createdAt }
      : candidate));
    await activityService.log({
      storeId: record.storeId,
      actorId: actor.id,
      action: 'tab.payment',
      summary: `Recorded a ${record.amountMillimes} millime payment for "${customer.name}".`,
      entityType: 'tab_payment',
      entityId: record.id,
      meta: { after: { customerId: customer.id, amountMillimes: record.amountMillimes, note: record.note } },
    });
    return record;
  },

  async reversePayment(input: { storeId: string; customerId: string; paymentId: string; ownerId: string; pin: string; reason: string }): Promise<TabRecord> {
    requireOnlineForAction('Reversing tab payments');
    if (isSupabaseDriver()) {
      const customer = await getRemoteCustomer(input.customerId, input.storeId);
      if (!customer) throw new Error('Customer could not be found in this store.');
      const owner = await userService.getUser(input.ownerId);
      const store = await userService.getStore(input.storeId);
      if (!store || !owner || owner.role !== 'owner' || owner.storeId !== store.id || store.ownerId !== owner.id) {
        throw new Error('Only this store owner can reverse a payment.');
      }
      const reason = input.reason.trim();
      if (!reason) throw new Error('A reason is required to reverse a payment.');
      if (store.pinMustChange) throw new Error('Set your admin PIN in Settings before reversing payments.');
      return reverseRemotePayment(input.paymentId, input.pin, reason);
    }
    const customer = await this.getCustomer(input.customerId, input.storeId);
    if (!customer) throw new Error('Customer could not be found in this store.');
    const owner = await userService.getUser(input.ownerId);
    const store = await userService.getStore(input.storeId);
    if (!store || !owner || owner.role !== 'owner' || owner.storeId !== store.id || store.ownerId !== owner.id) {
      throw new Error('Only this store owner can reverse a payment.');
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error('A reason is required to reverse a payment.');
    if (store.pinMustChange) throw new Error('Set your admin PIN in Settings before reversing payments.');

    const attempts = readData<Record<string, { count: number; lockedUntil: number }>>('reverse-payment-pin-attempts', {});
    const attempt = attempts[store.id] ?? { count: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > Date.now()) {
      const seconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
      throw new Error(`PIN pad locked. Try again in ${seconds} seconds.`);
    }
    if (!await userService.verifyStorePin(store.id, input.pin, 'credit_override')) {
      const count = attempt.count + 1;
      writeData('reverse-payment-pin-attempts', {
        ...attempts,
        [store.id]: { count: count >= 3 ? 0 : count, lockedUntil: count >= 3 ? Date.now() + 60_000 : 0 },
      });
      throw new Error(count >= 3 ? 'PIN pad locked for 60 seconds after 3 incorrect PINs.' : 'Incorrect Admin PIN.');
    }

    const tabs = getTabs();
    const payment = tabs.find((tab) =>
      tab.id === input.paymentId &&
      tab.customerId === customer.id &&
      tab.storeId === store.id &&
      tab.kind === 'settled',
    );
    if (!payment) throw new Error('This customer payment could not be found.');
    if (tabs.some((tab) => tab.kind === 'reversal' && tab.reversesTabId === payment.id)) {
      throw new Error('This payment has already been reversed.');
    }

    writeData('reverse-payment-pin-attempts', { ...attempts, [store.id]: { count: 0, lockedUntil: 0 } });
    const reversal: TabRecord = {
      id: `tab-${crypto.randomUUID()}`,
      storeId: store.id,
      customerId: customer.id,
      shiftId: (await shiftService.getOpenShiftForUser(store.id, owner.id))?.id ?? payment.shiftId,
      staffId: owner.id,
      kind: 'reversal',
      paymentMethod: payment.paymentMethod,
      amountMillimes: payment.amountMillimes,
      note: reason,
      reversesTabId: payment.id,
      createdAt: new Date().toISOString(),
    };
    writeData('tabs', [...tabs, reversal]);
    await activityService.log({
      storeId: store.id,
      actorId: owner.id,
      action: 'tab.payment_reversed',
      summary: `Reversed a ${payment.amountMillimes} millime payment for "${customer.name}". ${reason}`,
      entityType: 'tab_payment',
      entityId: payment.id,
      meta: {
        before: { amountMillimes: payment.amountMillimes, reversed: false },
        after: { amountMillimes: reversal.amountMillimes, reversed: true, reason },
      },
    });
    return reversal;
  },
};
