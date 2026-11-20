import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CashMovementRecord, CustomerRecord, OrderRecord, ShiftRecord, TabRecord } from '../src/types/domain';
import { customerService } from '../src/services/customerService';
import { orderService, OrderServiceError } from '../src/services/orderService';
import { reportService } from '../src/services/reportService';
import { shiftService } from '../src/services/shiftService';
import { seedStores, seedUsers } from '../src/services/seedData';
import { userService } from '../src/services/userService';

const STORAGE_PREFIX = '7anouti-pos:';
const storeId = seedStores[0].id;
const staffId = seedUsers.find((user) => user.role === 'staff')!.id;

function setLocalData(key: string, value: unknown): void {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
}

function makeShift(id: string, startingCashMillimes = 0): ShiftRecord {
  return {
    id,
    storeId,
    staffId,
    status: 'open',
    startingCashMillimes,
    openedAt: new Date().toISOString(),
  };
}

function makeOrder(
  id: string,
  shiftId: string,
  status: OrderRecord['status'],
  paymentMethod: OrderRecord['paymentMethod'],
  totalMillimes: number,
  customerId?: string,
): OrderRecord {
  return {
    id,
    number: 1,
    storeId,
    staffId,
    shiftId,
    status,
    paymentMethod,
    customerId,
    items: [],
    totalMillimes,
    createdAt: new Date().toISOString(),
  };
}

function makeTab(id: string, shiftId: string, kind: TabRecord['kind'], amountMillimes: number): TabRecord {
  return {
    id,
    storeId,
    customerId: 'customer-test',
    shiftId,
    staffId,
    kind,
    amountMillimes,
    createdAt: new Date().toISOString(),
  };
}

function makeCustomer(creditLimitMillimes?: number): CustomerRecord {
  return {
    id: 'customer-test',
    storeId,
    name: 'Test customer',
    creditLimitMillimes,
    settlementTerms: 'monthly',
    isActive: true,
    createdAt: new Date().toISOString(),
  };
}

describe('local money logic', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('calculates expected cash from float, cash sales, cash tab payments, and movements', async () => {
    const shiftId = 'shift-cash-test';
    setLocalData('shifts', [makeShift(shiftId, 10_000)]);
    setLocalData('orders', [
      makeOrder('cash-sale', shiftId, 'done', 'cash', 5_000),
      makeOrder('tab-sale', shiftId, 'done', 'tab', 3_000, 'customer-test'),
      makeOrder('voided-sale', shiftId, 'voided', 'cash', 2_000),
    ]);
    setLocalData('tabs', [
      makeTab('payment', shiftId, 'settled', 800),
      makeTab('reversal', shiftId, 'reversal', 100),
    ]);
    const movements: CashMovementRecord[] = [
      { id: 'cash-in', storeId, shiftId, staffId, kind: 'in', amountMillimes: 300, reason: 'change', createdAt: new Date().toISOString() },
      { id: 'cash-out', storeId, shiftId, staffId, kind: 'out', amountMillimes: 100, reason: 'expense', createdAt: new Date().toISOString() },
    ];
    setLocalData('cash-movements', movements);

    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(15_900);
  });

  it('reports credit status at 79, 80, and over 100 percent and blocks an over-limit tab order', async () => {
    const shiftId = 'shift-credit-test';
    setLocalData('customers', [makeCustomer(10_000)]);
    setLocalData('orders', [makeOrder('existing-tab', shiftId, 'done', 'tab', 7_900, 'customer-test')]);
    setLocalData('shifts', [makeShift(shiftId)]);

    await expect(customerService.getCreditStatus('customer-test')).resolves.toMatchObject({ percentUsed: 79, state: 'ok' });
    await expect(customerService.getCreditStatus('customer-test', 100)).resolves.toMatchObject({ percentUsed: 80, state: 'near' });
    await expect(customerService.getCreditStatus('customer-test', 2_101)).resolves.toMatchObject({ state: 'over' });

    await expect(orderService.createOrder({
      storeId,
      staffId,
      paymentMethod: 'tab',
      customerId: 'customer-test',
      items: [{ itemId: 'item-direct', name: 'Café Direct', quantity: 2, unitPriceMillimes: 2_000, lineTotalMillimes: 4_000, modifiers: [] }],
    })).rejects.toBeInstanceOf(OrderServiceError);
  });

  it('excludes voided orders from sales and customer tab balances', async () => {
    const shiftId = 'shift-void-test';
    setLocalData('orders', [
      makeOrder('completed-cash', shiftId, 'done', 'cash', 1_000),
      makeOrder('voided-cash', shiftId, 'voided', 'cash', 500),
      makeOrder('voided-tab', shiftId, 'voided', 'tab', 3_000, 'customer-test'),
    ]);
    setLocalData('tabs', []);

    await expect(orderService.getShiftSalesBreakdown(shiftId)).resolves.toMatchObject({
      orderCount: 1,
      cashSalesMillimes: 1_000,
      tabSalesMillimes: 0,
      voidsMillimes: 3_500,
    });
    await expect(customerService.getBalance('customer-test')).resolves.toBe(0);
  });

  it('reopens the business day when a shift is opened after a Z report', async () => {
    setLocalData('shifts', []);
    setLocalData('stores', seedStores.map((store) => store.id === storeId ? { ...store, adminPin: '1234', adminPinHash: undefined } : store));
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa')).rejects.toThrow('Owner PIN is required');
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234')).resolves.toBeDefined();
    expect((await userService.getStore(storeId))?.dayClosedOn).toBe(new Date().toLocaleDateString('en-CA'));

    await shiftService.openShift(storeId, staffId, 1_000);

    expect((await userService.getStore(storeId))?.dayClosedOn).toBeUndefined();
  });

  it('resolves permissions as position permissions plus grants minus revocations', async () => {
    const staff = seedUsers.find((user) => user.id === staffId)!;
    setLocalData('users', [{
      ...staff,
      permissionOverrides: { granted: ['cash_in_out', 'view_all_orders'], revoked: ['take_orders', 'cash_in_out'] },
    }]);
    setLocalData('positions', [{
      id: 'position-test',
      storeId,
      name: 'Test position',
      permissionIds: ['take_orders', 'view_all_orders'],
    }]);

    await expect(userService.getEffectivePermissions(staffId)).resolves.toEqual(['view_all_orders']);
  });
});
