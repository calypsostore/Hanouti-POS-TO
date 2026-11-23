import type { ExpenseCategory, ExpenseRecord } from '../types/domain';
import { activityService } from './activityService';
import { readData, writeData } from './storage';
import { supplierService } from './supplierService';
import { userService } from './userService';
import { isSupabaseDriver } from '../data/driver';
import { createExpense as createRemoteExpense, listExpenses as listRemoteExpenses } from '../data/repositories/financialRepository';

export interface ExpenseFilters {
  category?: ExpenseCategory;
  month?: string;
}

const CATEGORIES: ExpenseCategory[] = ['rent', 'electricity', 'water', 'supplier', 'salary', 'other'];
const getExpenses = () => readData<ExpenseRecord[]>('expenses', []);

function assertDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Date must use YYYY-MM-DD format.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error('Enter a valid expense date.');
  }
}

async function assertOwner(storeId: string, actorId: string): Promise<void> {
  const [store, actor] = await Promise.all([userService.getStore(storeId), userService.getUser(actorId)]);
  if (!store || !actor || actor.role !== 'owner' || actor.storeId !== store.id || store.ownerId !== actor.id) {
    throw new Error('Only this store owner can manage expenses.');
  }
}

export const expenseService = {
  async list(storeId: string, filters: ExpenseFilters = {}): Promise<ExpenseRecord[]> {
    const expenses = isSupabaseDriver() ? await listRemoteExpenses(storeId) : getExpenses();
    return expenses
      .filter((expense) => expense.storeId === storeId)
      .filter((expense) => !filters.category || expense.category === filters.category)
      .filter((expense) => !filters.month || expense.date.startsWith(`${filters.month}-`))
      .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  },

  async listForRange(storeId: string, from: number, to: number): Promise<ExpenseRecord[]> {
    const fromDate = localDateKey(from);
    const toDate = localDateKey(to);
    const expenses = isSupabaseDriver()
      ? await listRemoteExpenses(storeId, fromDate, toDate)
      : getExpenses();
    return expenses.filter((expense) => {
      return expense.storeId === storeId && expense.date >= fromDate && expense.date <= toDate;
    });
  },

  async create(input: {
    storeId: string;
    actorId: string;
    category: ExpenseCategory;
    supplierId?: string;
    amountMillimes: number;
    date: string;
    note?: string;
  }): Promise<ExpenseRecord> {
    await assertOwner(input.storeId, input.actorId);
    if (!CATEGORIES.includes(input.category)) throw new Error('Choose a valid expense category.');
    if (!Number.isSafeInteger(input.amountMillimes) || input.amountMillimes <= 0) {
      throw new Error('Expense amount must be a positive whole number of millimes.');
    }
    assertDate(input.date);
    const note = input.note?.trim();
    if (note && note.length > 500) throw new Error('Expense note must be 500 characters or fewer.');
    if (input.category === 'supplier' && !input.supplierId) throw new Error('Select a supplier for this expense.');
    if (input.category !== 'supplier' && input.supplierId) throw new Error('Only supplier expenses can be linked to a supplier.');
    if (input.supplierId && !await supplierService.get(input.storeId, input.supplierId)) {
      throw new Error('Supplier could not be found in this store.');
    }
    const expenseInput = {
      storeId: input.storeId,
      category: input.category,
      supplierId: input.supplierId,
      amountMillimes: input.amountMillimes,
      paidMillimes: input.category === 'supplier' ? 0 : input.amountMillimes,
      date: input.date,
      createdAt: new Date().toISOString(),
      note: note || undefined,
      createdBy: input.actorId,
    };
    const expense: ExpenseRecord = isSupabaseDriver()
      ? await createRemoteExpense(expenseInput)
      : {
      id: `expense-${crypto.randomUUID()}`,
      ...expenseInput,
    };
    if (!isSupabaseDriver()) writeData('expenses', [...getExpenses(), expense]);
    await activityService.log({
      storeId: expense.storeId,
      actorId: input.actorId,
      action: 'expense.created',
      summary: `Recorded ${expense.category} expense of ${expense.amountMillimes} millimes.`,
      entityType: 'expense',
      entityId: expense.id,
      meta: { after: expense },
    });
    return expense;
  },

  categories: CATEGORIES,
};

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
