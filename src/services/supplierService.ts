import type { ExpenseRecord, SupplierPaymentRecord, SupplierRecord } from '../types/domain';
import { activityService } from './activityService';
import { readData, writeData } from './storage';
import { userService } from './userService';
import { isSupabaseDriver } from '../data/driver';
import {
  createSupplier as createRemoteSupplier,
  getSupplier as getRemoteSupplier,
  listExpenses as listRemoteExpenses,
  listSupplierPayments,
  listSuppliers as listRemoteSuppliers,
  recordSupplierPayment,
} from '../data/repositories/financialRepository';

export interface SupplierBalanceRecord extends SupplierRecord {
  amountOwedMillimes: number;
}

export interface SupplierDetails {
  supplier: SupplierRecord;
  purchases: ExpenseRecord[];
  payments: SupplierPaymentRecord[];
  amountOwedMillimes: number;
}

const getSuppliers = () => readData<SupplierRecord[]>('suppliers', []);
const getExpenses = () => readData<ExpenseRecord[]>('expenses', []);
const getPayments = () => readData<SupplierPaymentRecord[]>('supplier-payments', []);

function assertDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Date must use YYYY-MM-DD format.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error('Enter a valid payment date.');
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function paidForExpense(expense: ExpenseRecord, payments: SupplierPaymentRecord[]): number {
  const linkedPayments = sum(payments
    .filter((payment) => payment.expenseId === expense.id)
    .map((payment) => payment.amountMillimes));
  return Math.min(expense.amountMillimes, Math.max(expense.paidMillimes, linkedPayments));
}

function balanceForSupplier(supplierId: string, expenses = getExpenses(), payments = getPayments()): number {
  const purchases = expenses.filter((expense) => expense.supplierId === supplierId);
  const linkedPaid = purchases.reduce((total, expense) => total + paidForExpense(expense, payments), 0);
  const unallocatedPayments = sum(payments
    .filter((payment) => payment.supplierId === supplierId && !payment.expenseId)
    .map((payment) => payment.amountMillimes));
  return Math.max(0, sum(purchases.map((expense) => expense.amountMillimes)) - linkedPaid - unallocatedPayments);
}

async function assertOwner(storeId: string, actorId: string): Promise<void> {
  const [store, actor] = await Promise.all([userService.getStore(storeId), userService.getUser(actorId)]);
  const isOwner = Boolean(store && actor && actor.role === 'owner' && store.ownerId === actor.id);
  if (!store || !actor || actor.storeId !== store.id || (!isOwner && !await userService.hasPermission(actorId, 'manage_suppliers'))) {
    throw new Error('This account does not have permission to manage suppliers.');
  }
}

export const supplierService = {
  async list(storeId: string): Promise<SupplierBalanceRecord[]> {
    let suppliers: SupplierRecord[];
    let expenses: ExpenseRecord[];
    let payments: SupplierPaymentRecord[];
    if (isSupabaseDriver()) {
      suppliers = await listRemoteSuppliers(storeId);
      const [remoteExpenses, remotePayments] = await Promise.all([
        listRemoteExpenses(storeId),
        Promise.all(suppliers.map((supplier) => listSupplierPayments(supplier.id))),
      ]);
      expenses = remoteExpenses;
      payments = remotePayments.flat();
    } else {
      suppliers = getSuppliers();
      expenses = getExpenses();
      payments = getPayments();
    }
    return suppliers
      .filter((supplier) => supplier.storeId === storeId)
      .map((supplier) => ({
        ...supplier,
        amountOwedMillimes: balanceForSupplier(supplier.id, expenses, payments),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  async get(storeId: string, supplierId: string): Promise<SupplierRecord | undefined> {
    if (isSupabaseDriver()) return getRemoteSupplier(storeId, supplierId);
    return getSuppliers().find((supplier) => supplier.storeId === storeId && supplier.id === supplierId);
  },

  async getDetails(storeId: string, supplierId: string): Promise<SupplierDetails> {
    const supplier = await this.get(storeId, supplierId);
    if (!supplier) throw new Error('Supplier could not be found.');
    const [expenses, payments] = isSupabaseDriver()
      ? await Promise.all([listRemoteExpenses(storeId), listSupplierPayments(supplierId)])
      : [getExpenses(), getPayments().filter((payment) => payment.supplierId === supplierId)];
    const purchases = expenses
      .filter((expense) => expense.storeId === storeId && expense.supplierId === supplierId)
      .map((expense) => ({ ...expense, paidMillimes: paidForExpense(expense, payments) }))
      .sort((left, right) => right.date.localeCompare(left.date));
    return {
      supplier,
      purchases,
      payments: [...payments].sort((left, right) => right.date.localeCompare(left.date)),
      amountOwedMillimes: balanceForSupplier(supplierId, expenses, payments),
    };
  },

  async create(input: {
    storeId: string;
    actorId: string;
    name: string;
    phone?: string;
    notes?: string;
  }): Promise<SupplierRecord> {
    await assertOwner(input.storeId, input.actorId);
    const name = input.name.trim();
    if (!name) throw new Error('Supplier name is required.');
    const supplierInput = {
      storeId: input.storeId,
      name,
      phone: input.phone?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
    };
    const supplier: SupplierRecord = isSupabaseDriver()
      ? await createRemoteSupplier(supplierInput)
      : {
      id: `supplier-${crypto.randomUUID()}`,
      ...supplierInput,
    };
    if (!isSupabaseDriver()) writeData('suppliers', [...getSuppliers(), supplier]);
    await activityService.log({
      storeId: supplier.storeId,
      actorId: input.actorId,
      action: 'supplier.created',
      summary: `Created supplier "${supplier.name}".`,
      entityType: 'supplier',
      entityId: supplier.id,
      meta: { after: supplier },
    });
    return supplier;
  },

  async recordPayment(input: {
    storeId: string;
    supplierId: string;
    actorId: string;
    amountMillimes: number;
    date: string;
    expenseId?: string;
  }): Promise<SupplierPaymentRecord> {
    await assertOwner(input.storeId, input.actorId);
    const supplier = await this.get(input.storeId, input.supplierId);
    if (!supplier) throw new Error('Supplier could not be found.');
    if (!Number.isSafeInteger(input.amountMillimes) || input.amountMillimes <= 0) {
      throw new Error('Payment must be a positive whole number of millimes.');
    }
    assertDate(input.date);
    if (isSupabaseDriver()) {
      const [supplier, supplierSummaries] = await Promise.all([
        this.get(input.storeId, input.supplierId),
        this.list(input.storeId),
      ]);
      if (!supplier) throw new Error('Supplier could not be found.');
      const summary = supplierSummaries.find((candidate) => candidate.id === supplier.id);
      const payment = await recordSupplierPayment({
        supplierId: supplier.id,
        amountMillimes: input.amountMillimes,
        date: input.date,
        expenseId: input.expenseId,
      });
      await activityService.log({
        storeId: supplier.storeId,
        actorId: input.actorId,
        action: 'supplier.payment',
        summary: `Paid ${payment.amountMillimes} millimes to "${supplier.name}".`,
        entityType: 'supplier_payment',
        entityId: payment.id,
        meta: {
          before: { amountOwedMillimes: summary?.amountOwedMillimes ?? 0 },
          after: { amountOwedMillimes: Math.max(0, (summary?.amountOwedMillimes ?? 0) - payment.amountMillimes), expenseId: payment.expenseId },
        },
      });
      return payment;
    }
    const expenses = getExpenses();
    const payments = getPayments();
    const amountOwed = balanceForSupplier(supplier.id, expenses, payments);
    if (input.amountMillimes > amountOwed) throw new Error('Payment cannot exceed the amount owed to this supplier.');

    const expense = input.expenseId
      ? expenses.find((candidate) =>
        candidate.id === input.expenseId && candidate.storeId === input.storeId && candidate.supplierId === supplier.id)
      : undefined;
    if (input.expenseId && !expense) throw new Error('Supplier purchase could not be found.');
    if (expense && input.amountMillimes > expense.amountMillimes - paidForExpense(expense, payments)) {
      throw new Error('Payment cannot exceed the remaining balance on this purchase.');
    }

    const payment: SupplierPaymentRecord = {
      id: `supplier-payment-${crypto.randomUUID()}`,
      supplierId: supplier.id,
      expenseId: expense?.id,
      amountMillimes: input.amountMillimes,
      date: input.date,
    };
    writeData('supplier-payments', [...payments, payment]);
    if (expense) {
      const nextPaidMillimes = paidForExpense(expense, payments) + payment.amountMillimes;
      writeData('expenses', expenses.map((candidate) =>
        candidate.id === expense.id ? { ...candidate, paidMillimes: nextPaidMillimes } : candidate));
    }
    await activityService.log({
      storeId: supplier.storeId,
      actorId: input.actorId,
      action: 'supplier.payment',
      summary: `Paid ${payment.amountMillimes} millimes to "${supplier.name}".`,
      entityType: 'supplier_payment',
      entityId: payment.id,
      meta: {
        before: { amountOwedMillimes: amountOwed },
        after: { amountOwedMillimes: amountOwed - payment.amountMillimes, expenseId: payment.expenseId },
      },
    });
    return payment;
  },
};
