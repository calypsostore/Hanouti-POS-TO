import type { CustomerRecord, OrderRecord, TabRecord } from '../types/domain';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { readData, writeData } from './storage';

const getCustomers = () => readData<CustomerRecord[]>('customers', []);
const getTabs = () => readData<TabRecord[]>('tabs', []);
const getOrders = () => readData<OrderRecord[]>('orders', []);

export const customerService = {
  async listCustomers(storeId: string): Promise<CustomerRecord[]> {
    return getCustomers().filter((customer) => customer.storeId === storeId).sort((a, b) => a.name.localeCompare(b.name));
  },

  async createCustomer(storeId: string, name: string, phone?: string): Promise<CustomerRecord> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Customer name is required.');
    if (!await userService.getStore(storeId)) throw new Error('The store could not be found.');
    const customer: CustomerRecord = {
      id: `customer-${crypto.randomUUID()}`,
      storeId,
      name: trimmedName,
      phone: phone?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    writeData('customers', [...getCustomers(), customer]);
    return customer;
  },

  async getBalance(customerId: string): Promise<number> {
    const issued = getOrders().filter((order) => order.customerId === customerId && order.paymentMethod === 'tab' && order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
    const settled = getTabs().filter((tab) => tab.customerId === customerId && tab.kind === 'settled')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    return Math.max(0, issued - settled);
  },

  async getOrderHistory(customerId: string): Promise<OrderRecord[]> {
    return getOrders().filter((order) => order.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listTransactions(customerId: string): Promise<TabRecord[]> {
    return getTabs().filter((tab) => tab.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async settleTab(input: { storeId: string; customerId: string; staffId: string; amountMillimes: number }): Promise<TabRecord> {
    if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new Error('Enter a payment greater than zero.');
    const actor = await userService.getUser(input.staffId);
    if (!actor || actor.storeId !== input.storeId || (actor.role !== 'staff' && actor.role !== 'owner')) {
      throw new Error('This account cannot settle tabs for the selected store.');
    }
    if (actor.role === 'staff' && !await userService.hasPermission(input.staffId, 'settle_tabs')) {
      throw new Error('Your position does not allow settling customer tabs.');
    }
    const customer = getCustomers().find((candidate) => candidate.id === input.customerId && candidate.storeId === input.storeId);
    if (!customer) throw new Error('Customer could not be found in this store.');
    const shift = await shiftService.getOpenShiftForUser(input.storeId, input.staffId);
    if (!shift) throw new Error('Open your shift before accepting a tab payment.');
    const balance = await this.getBalance(input.customerId);
    if (input.amountMillimes > balance) throw new Error('Payment cannot exceed the customer open balance.');
    const record: TabRecord = {
      id: `tab-${crypto.randomUUID()}`,
      storeId: input.storeId,
      customerId: input.customerId,
      shiftId: shift.id,
      staffId: input.staffId,
      kind: 'settled',
      amountMillimes: input.amountMillimes,
      createdAt: new Date().toISOString(),
    };
    writeData('tabs', [...getTabs(), record]);
    return record;
  },
};
