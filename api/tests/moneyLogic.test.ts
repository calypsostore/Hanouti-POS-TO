import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashMovementRecord, CustomerRecord, OrderRecord, ShiftRecord, TabRecord } from '../src/types/domain';
import { customerService } from '../src/services/customerService';
import { orderService, OrderServiceError } from '../src/services/orderService';
import { reportService } from '../src/services/reportService';
import { shiftService } from '../src/services/shiftService';
import { seedPositions, seedStores, seedUsers } from '../src/services/seedData';
import { userService } from '../src/services/userService';

const STORAGE_PREFIX = '7anouti-pos:';
const storeId = seedStores[0].id;
const staffId = seedUsers.find((user) => user.role === 'staff')!.id;
const ownerId = seedUsers.find((user) => user.role === 'owner')!.id;

function setLocalData(key: string, value: unknown): void {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
}

function makeShift(id: string, startingCashMillimes = 0, shiftStaffId = staffId): ShiftRecord {
  return {
    id,
    storeId,
    staffId: shiftStaffId,
    status: 'open',
    startingCashMillimes,
    openedAt: new Date().toISOString(),
  };
}

function makeClosedShift(id: string, startingCashMillimes = 0, shiftStaffId = staffId): ShiftRecord {
  const now = Date.now();
  return {
    ...makeShift(id, startingCashMillimes, shiftStaffId),
    status: 'closed',
    openedAt: new Date(now - 60 * 60_000).toISOString(),
    closedAt: new Date(now - 1_000).toISOString(),
    expectedCashMillimes: startingCashMillimes,
    countedCashMillimes: startingCashMillimes,
    differenceMillimes: 0,
  };
}

function prepareReportData(shifts: ShiftRecord[]): void {
  setLocalData('shifts', shifts);
  setLocalData('orders', []);
  setLocalData('tabs', []);
  setLocalData('cash-movements', []);
  setLocalData('reports', []);
  setLocalData('customers', []);
  setLocalData('stores', seedStores.map((store) => store.id === storeId
    ? { ...store, adminPin: '1234', adminPinHash: undefined }
    : store));
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

function makeTab(
  id: string,
  shiftId: string,
  kind: TabRecord['kind'],
  amountMillimes: number,
  paymentMethod: TabRecord['paymentMethod'] = 'cash',
): TabRecord {
  return {
    id,
    storeId,
    customerId: 'customer-test',
    shiftId,
    staffId,
    kind,
    paymentMethod,
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

  it('reconciles daily cash excluding the two staff floats', async () => {
    const now = new Date();
    const openedAt = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const closedAt = new Date(now.getTime() - 60_000).toISOString();
    const shiftOne = {
      ...makeShift('shift-z-one', 50_000),
      status: 'closed' as const,
      openedAt,
      closedAt,
      expectedCashMillimes: 90_000,
      countedCashMillimes: 90_000,
    };
    const shiftTwo = {
      ...makeShift('shift-z-two', 50_000, 'staff-z-two'),
      status: 'closed' as const,
      openedAt,
      closedAt,
      expectedCashMillimes: 125_000,
      countedCashMillimes: 125_000,
    };
    setLocalData('reports', []);
    setLocalData('shifts', [shiftOne, shiftTwo]);
    setLocalData('orders', [
      makeOrder('cash-sale-one', shiftOne.id, 'done', 'cash', 50_000),
      makeOrder('cash-sale-two', shiftTwo.id, 'done', 'cash', 50_000),
    ]);
    setLocalData('tabs', [makeTab('cash-tab', shiftTwo.id, 'settled', 20_000)]);
    setLocalData('cash-movements', [
      { id: 'cash-out', storeId, shiftId: shiftOne.id, staffId, kind: 'out', amountMillimes: 10_000, reason: 'expense', createdAt: closedAt },
      { id: 'cash-in', storeId, shiftId: shiftTwo.id, staffId: 'staff-z-two', kind: 'in', amountMillimes: 5_000, reason: 'change', createdAt: closedAt },
    ] satisfies CashMovementRecord[]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('stores', seedStores.map((store) => store.id === storeId
      ? { ...store, adminPin: '1234', adminPinHash: undefined }
      : store));

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    expect(summary.totalExpectedCashMillimes).toBe(215_000);
    expect(summary.cashFloatMillimes).toBe(100_000);
    expect(summary.expectedCashExFloatMillimes).toBe(115_000);

    const report = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 115_000,
    });
    expect(report.countedCashMillimes).toBe(115_000);
    expect(report.cashDifference).toBe(0);
    expect(report.cashDifferenceMillimes).toBe(0);
    expect(report.countedCashIncludesFloat).toBe(false);
  });

  it('records a short of 1.500 DT against expected daily cash excluding floats', async () => {
    const now = new Date();
    const openedAt = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const closedAt = new Date(now.getTime() - 60_000).toISOString();
    const shiftOne = {
      ...makeShift('shift-short-one', 50_000),
      status: 'closed' as const,
      openedAt,
      closedAt,
      expectedCashMillimes: 90_000,
      countedCashMillimes: 90_000,
    };
    const shiftTwo = {
      ...makeShift('shift-short-two', 50_000, 'staff-z-two'),
      status: 'closed' as const,
      openedAt,
      closedAt,
      expectedCashMillimes: 125_000,
      countedCashMillimes: 125_000,
    };
    setLocalData('reports', []);
    setLocalData('shifts', [shiftOne, shiftTwo]);
    setLocalData('orders', [
      makeOrder('short-cash-sale-one', shiftOne.id, 'done', 'cash', 50_000),
      makeOrder('short-cash-sale-two', shiftTwo.id, 'done', 'cash', 50_000),
    ]);
    setLocalData('tabs', [makeTab('short-cash-tab', shiftTwo.id, 'settled', 20_000)]);
    setLocalData('cash-movements', [
      { id: 'short-cash-out', storeId, shiftId: shiftOne.id, staffId, kind: 'out', amountMillimes: 10_000, reason: 'expense', createdAt: closedAt },
      { id: 'short-cash-in', storeId, shiftId: shiftTwo.id, staffId: 'staff-z-two', kind: 'in', amountMillimes: 5_000, reason: 'change', createdAt: closedAt },
    ] satisfies CashMovementRecord[]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('stores', seedStores.map((store) => store.id === storeId
      ? { ...store, adminPin: '1234', adminPinHash: undefined }
      : store));

    const report = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 113_500,
      note: 'Cash count is short.',
    });
    expect(report.expectedCashExFloatMillimes).toBe(115_000);
    expect(report.cashDifference).toBe(-1_500);
    expect(report.cashDifferenceMillimes).toBe(-1_500);
  });

  it('counts cash tab settlements and reversals but excludes pending-void cash sales', async () => {
    const shiftId = 'shift-tab-methods';
    setLocalData('orders', [
      makeOrder('pending-cash', shiftId, 'pending_void', 'cash', 3_000),
    ]);
    setLocalData('tabs', [
      makeTab('cash-settlement', shiftId, 'settled', 20_000),
      makeTab('card-settlement', shiftId, 'settled', 9_000, 'card'),
      makeTab('cash-reversal', shiftId, 'reversal', 2_000),
    ]);

    await expect(orderService.getShiftSalesBreakdown(shiftId)).resolves.toMatchObject({
      orderCount: 0,
      cashSalesMillimes: 0,
      tabPaymentsMillimes: 18_000,
    });
  });

  it('books a post-close cash tab reversal into the new Z period instead of the closed shift count', async () => {
    const shiftId = 'shift-tab-reversal';
    const closedShift = makeShift(shiftId, 0);
    prepareReportData([closedShift]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [makeTab('settled-before-close', shiftId, 'settled', 5_000)]);
    await shiftService.closeShift(shiftId, 5_000);

    await customerService.reversePayment({
      storeId,
      customerId: 'customer-test',
      paymentId: 'settled-before-close',
      ownerId,
      pin: '1234',
      reason: 'Cash refunded after shift close',
    });
    const tabsAfterReverse = JSON.parse(localStorage.getItem('7anouti-pos:tabs') ?? '[]') as TabRecord[];
    const reversal = tabsAfterReverse.find((tab) => tab.reversesTabId === 'settled-before-close');
    if (reversal) reversal.reversalAttribution = 'post_close';
    setLocalData('tabs', tabsAfterReverse);

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    expect(summary.cashRefundsMillimes).toBe(5_000);
    expect(summary.expectedCashExFloatMillimes).toBe(0);
    const zReport = await reportService.closeDayWithZReport(storeId, 'Owner', '1234', {
      countedCashMillimes: 0,
      countedCardMillimes: 0,
      countedOtherMillimes: 0,
    });
    expect(zReport.cashDifferenceMillimes).toBe(0);
    expect(zReport.cashRefundsMillimes).toBe(5_000);
  });

  it('does not subtract a same-shift reversal again at Z time', async () => {
    const shiftId = 'shift-same-shift-reversal';
    prepareReportData([makeShift(shiftId, 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      makeTab('same-shift-settlement', shiftId, 'settled', 500),
      { ...makeTab('same-shift-reversal', shiftId, 'reversal', 500), reversesTabId: 'same-shift-settlement', reversalAttribution: 'same_shift' },
    ]);

    await shiftService.closeShift(shiftId, 0);

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    expect(summary.shiftLines[0]?.includedTabReversalIds ?? []).toContain('same-shift-reversal');
    expect(summary.cashRefundsMillimes).toBe(0);
    expect(summary.totalExpectedCashMillimes).toBe(0);

    const zReport = await reportService.closeDayWithZReport(storeId, 'Owner', '1234', {
      countedCashMillimes: 0,
    });
    expect(zReport.cashRefundsMillimes).toBe(0);
    expect(zReport.totalExpectedCashMillimes).toBe(0);
  });

  it('returns zero for an open X with a matching settlement and reversal', async () => {
    const shiftId = 'shift-open-x-reversal';
    prepareReportData([makeShift(shiftId, 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      makeTab('open-cash-settlement', shiftId, 'settled', 500),
      { ...makeTab('open-cash-reversal', shiftId, 'reversal', 500), reversesTabId: 'open-cash-settlement', reversalAttribution: 'same_shift' },
      makeTab('open-card-settlement', shiftId, 'settled', 500, 'card'),
      { ...makeTab('open-card-reversal', shiftId, 'reversal', 500, 'card'), reversesTabId: 'open-card-settlement', reversalAttribution: 'same_shift' },
      makeTab('open-other-settlement', shiftId, 'settled', 500, 'other'),
      { ...makeTab('open-other-reversal', shiftId, 'reversal', 500, 'other'), reversesTabId: 'open-other-settlement', reversalAttribution: 'same_shift' },
    ]);

    const report = await reportService.createXReport(storeId, 'Owner');

    expect(report.totalExpectedCashMillimes).toBe(0);
    expect(report.shifts?.[0]?.cardTabPaymentsMillimes).toBe(0);
    expect(report.shifts?.[0]?.otherTabPaymentsMillimes).toBe(0);
  });

  it('preserves ambiguous cash card and other reversal amounts separately', async () => {
    const shiftId = 'shift-ambiguous-methods';
    prepareReportData([makeShift(shiftId, 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      makeTab('ambiguous-cash-settlement', shiftId, 'settled', 500),
      { ...makeTab('ambiguous-cash-reversal', shiftId, 'reversal', 500), reversesTabId: 'ambiguous-cash-settlement' },
      makeTab('ambiguous-card-settlement', shiftId, 'settled', 1000, 'card'),
      { ...makeTab('ambiguous-card-reversal', shiftId, 'reversal', 500, 'card'), reversesTabId: 'ambiguous-card-settlement' },
      makeTab('ambiguous-other-settlement', shiftId, 'settled', 1000, 'other'),
      { ...makeTab('ambiguous-other-reversal', shiftId, 'reversal', 500, 'other'), reversesTabId: 'ambiguous-other-settlement' },
    ]);

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    expect(summary.unresolvedTabReversals).toHaveLength(3);
    expect(summary.unresolvedTabReversals).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentMethod: 'cash', amountMillimes: 500, state: 'ambiguous' }),
      expect.objectContaining({ paymentMethod: 'card', amountMillimes: 500, state: 'ambiguous' }),
      expect.objectContaining({ paymentMethod: 'other', amountMillimes: 500, state: 'ambiguous' }),
    ]));
  });

  it('blocks Z generation while ambiguous reversals remain unresolved', async () => {
    const shiftId = 'shift-z-ambiguous';
    prepareReportData([makeClosedShift(shiftId, 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      makeTab('z-cash-settlement', shiftId, 'settled', 500),
      {
        ...makeTab('z-cash-reversal', shiftId, 'reversal', 500),
        reversesTabId: 'z-cash-settlement',
      },
    ]);

    await expect(reportService.closeDayWithZReport(storeId, 'Owner', '1234', {
      countedCashMillimes: 0,
    })).rejects.toThrow('Resolve every ambiguous tab reversal');
  });

  it('supports multiple settlements and full equal reversals without partial reversal entry', async () => {
    const shiftId = 'shift-multiple-settlements';
    prepareReportData([makeShift(shiftId, 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      makeTab('settlement-one', shiftId, 'settled', 300),
      makeTab('settlement-two', shiftId, 'settled', 700),
    ]);

    await customerService.reversePayment({
      storeId,
      customerId: 'customer-test',
      paymentId: 'settlement-one',
      ownerId,
      pin: '1234',
      reason: 'Full reversal of 300 millimes',
    });

    const tabs = JSON.parse(localStorage.getItem('7anouti-pos:tabs') ?? '[]') as TabRecord[];
    expect(tabs.filter((tab) => tab.kind === 'reversal')).toHaveLength(1);
    expect(tabs.find((tab) => tab.reversesTabId === 'settlement-one')?.amountMillimes).toBe(300);
    expect(tabs.find((tab) => tab.reversesTabId === 'settlement-two')).toBeUndefined();
  });

  it('does not infer an ambiguous historical reversal inclusion', async () => {
    const shiftId = 'shift-ambiguous-reversal';
    const closedShift = {
      ...makeClosedShift(shiftId, 0),
      openedAt: '2026-11-22T10:00:00.000Z',
      closedAt: '2026-11-22T11:00:00.000Z',
      expectedCashMillimes: 500,
      countedCashMillimes: 500,
    };
    prepareReportData([closedShift]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [
      { ...makeTab('historical-settlement', shiftId, 'settled', 500), createdAt: '2026-11-22T10:30:00.000Z' },
      {
        ...makeTab('historical-reversal', shiftId, 'reversal', 500),
        reversesTabId: 'historical-settlement',
        createdAt: '2026-11-22T10:45:00.000Z',
      },
    ]);

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    expect(summary.ambiguousTabReversalIds).toContain('historical-reversal');
    expect(summary.unresolvedTabReversals).toEqual([
      expect.objectContaining({
        reversalId: 'historical-reversal',
        originalSettlementId: 'historical-settlement',
        paymentMethod: 'cash',
        amountMillimes: 500,
        state: 'ambiguous',
      }),
    ]);
    expect(summary.cashRefundsMillimes).toBe(0);
  });

  it('separates unresolved reversal amounts from the customer verified balance', async () => {
    prepareReportData([makeShift('shift-customer-reconciliation', 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('orders', [
      makeOrder('customer-tab-charge', 'shift-customer-reconciliation', 'done', 'tab', 500, 'customer-test'),
    ]);
    setLocalData('tabs', [
      makeTab('customer-settlement', 'shift-customer-reconciliation', 'settled', 500),
      {
        ...makeTab('customer-ambiguous-reversal', 'shift-customer-reconciliation', 'reversal', 500),
        reversesTabId: 'customer-settlement',
      },
    ]);

    const reconciliation = await customerService.getBalanceReconciliation('customer-test');
    expect(reconciliation.verifiedBalanceMillimes).toBe(0);
    expect(reconciliation.unresolvedReversalMillimes).toBe(500);
    expect(reconciliation.unresolvedReversals).toEqual([
      expect.objectContaining({
        reversalId: 'customer-ambiguous-reversal',
        originalSettlementId: 'customer-settlement',
        paymentMethod: 'cash',
        amountMillimes: 500,
      }),
    ]);
  });

  it('prevents a settlement from being reversed twice', async () => {
    prepareReportData([makeShift('shift-duplicate-reversal', 0)]);
    setLocalData('customers', [makeCustomer()]);
    setLocalData('tabs', [makeTab('single-settlement', 'shift-duplicate-reversal', 'settled', 500)]);

    await customerService.reversePayment({
      storeId,
      customerId: 'customer-test',
      paymentId: 'single-settlement',
      ownerId,
      pin: '1234',
      reason: 'First reversal',
    });

    await expect(customerService.reversePayment({
      storeId,
      customerId: 'customer-test',
      paymentId: 'single-settlement',
      ownerId,
      pin: '1234',
      reason: 'Second reversal',
    })).rejects.toThrow('already been reversed');
  });

  it('records a PIN void on a closed cash shift and reconciles the Z cash ledger', async () => {
    const shiftId = 'shift-pin-void-closed';
    const shift = {
      ...makeClosedShift(shiftId, 0),
      expectedCashMillimes: 10_000,
      countedCashMillimes: 10_000,
    };
    prepareReportData([shift]);
    setLocalData('users', seedUsers);
    setLocalData('orders', [makeOrder('pin-void-cash', shiftId, 'done', 'cash', 10_000)]);

    await orderService.voidWithPin('pin-void-cash', '1234', ownerId, 'Customer refund');

    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(0);
    await expect(shiftService.getShift(shiftId)).resolves.toMatchObject({
      voidAdjustments: [expect.objectContaining({ kind: 'approved', amountMillimes: -10_000 })],
    });
    const report = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: 0,
      countedCardMillimes: 0,
      countedOtherMillimes: 0,
    });
    expect(report.totalExpectedCashMillimes).toBe(0);
    expect(report.expectedCashExFloatMillimes).toBe(0);
    expect(report.cashDifferenceMillimes).toBe(0);
  });

  it('removes an open-shift cash void from expected cash and sales, then restores it on rejection', async () => {
    const shiftId = 'shift-open-void';
    const shift = makeShift(shiftId, 10_000);
    setLocalData('shifts', [shift]);
    setLocalData('orders', [makeOrder('open-void', shiftId, 'done', 'cash', 20_000)]);

    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(30_000);
    await orderService.requestVoid('open-void', staffId, 'Wrong item');
    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(10_000);
    await expect(orderService.getShiftSalesBreakdown(shiftId)).resolves.toMatchObject({
      orderCount: 0,
      cashSalesMillimes: 0,
    });

    await shiftService.closeShift(shiftId, 10_000);
    await orderService.resolveVoidRequest('open-void', ownerId, 'reject');
    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(30_000);
    await expect(shiftService.getShift(shiftId)).resolves.toMatchObject({ differenceMillimes: -20_000 });
    await expect(orderService.getShiftSalesBreakdown(shiftId)).resolves.toMatchObject({
      orderCount: 1,
      cashSalesMillimes: 20_000,
    });
  });

  it('records request and rejection ledger rows for a closed shift without double-deducting approval', async () => {
    const shiftId = 'shift-closed-void';
    const shift = { ...makeClosedShift(shiftId, 10_000), expectedCashMillimes: 30_000, countedCashMillimes: 10_000 };
    const approvalShiftId = 'shift-closed-approve';
    const approvalShift = {
      ...makeClosedShift(approvalShiftId, 10_000),
      expectedCashMillimes: 30_000,
      countedCashMillimes: 10_000,
    };
    setLocalData('shifts', [shift, approvalShift]);
    setLocalData('orders', [
      makeOrder('closed-reject', shiftId, 'done', 'cash', 20_000),
      makeOrder('closed-approve', approvalShiftId, 'done', 'cash', 20_000),
    ]);

    await orderService.requestVoid('closed-reject', staffId, 'Refunded');
    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(10_000);
    await orderService.resolveVoidRequest('closed-reject', ownerId, 'reject');
    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(30_000);
    await expect(shiftService.getShift(shiftId)).resolves.toMatchObject({ differenceMillimes: -20_000 });

    await orderService.requestVoid('closed-approve', staffId, 'Wrong item');
    await orderService.resolveVoidRequest('closed-approve', ownerId, 'approve', 'Wrong item');
    const approvedShift = await shiftService.getShift(approvalShiftId);
    expect(approvedShift?.voidAdjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: 'closed-approve', kind: 'requested', amountMillimes: -20_000 }),
    ]));
    expect(approvedShift?.voidAdjustments?.some((adjustment) =>
      adjustment.orderId === 'closed-approve' && adjustment.kind === 'approved',
    )).toBe(false);
    const rejectedShift = await shiftService.getShift(shiftId);
    expect(rejectedShift?.voidAdjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: 'closed-reject', kind: 'requested', amountMillimes: -20_000 }),
      expect.objectContaining({ orderId: 'closed-reject', kind: 'rejected', amountMillimes: 20_000 }),
    ]));
    await expect(shiftService.getExpectedCash(approvalShiftId)).resolves.toBe(10_000);
  });

  it('adds a positive rejection adjustment when a shift closed with its void pending', async () => {
    const shiftId = 'shift-pending-closed';
    const shift = { ...makeClosedShift(shiftId, 10_000), expectedCashMillimes: 10_000, countedCashMillimes: 10_000 };
    setLocalData('shifts', [shift]);
    setLocalData('users', seedUsers);
    setLocalData('orders', [
      { ...makeOrder('pending-closed', shiftId, 'pending_void', 'cash', 20_000), voidReason: 'Refunded' },
    ]);

    await orderService.resolveVoidRequest('pending-closed', ownerId, 'reject');
    await expect(shiftService.getExpectedCash(shiftId)).resolves.toBe(30_000);
    await expect(shiftService.getShift(shiftId)).resolves.toMatchObject({
      differenceMillimes: -20_000,
      voidAdjustments: [expect.objectContaining({ kind: 'rejected', amountMillimes: 20_000 })],
    });
  });

  it('lists pending voids on X, blocks Z until resolved, then permits Z', async () => {
    const shiftId = 'shift-z-pending-void';
    prepareReportData([makeClosedShift(shiftId, 10_000)]);
    setLocalData('orders', [
      { ...makeOrder('z-pending-void', shiftId, 'pending_void', 'cash', 20_000), voidReason: 'Wrong item', voidRequestedAt: new Date().toISOString() },
    ]);

    const xReport = await reportService.createXReport(storeId, 'Owner');
    expect(xReport.pendingVoids).toMatchObject({
      count: 1,
      totalMillimes: 20_000,
      orders: [expect.objectContaining({
        ticketNumber: 1,
        staffName: 'Sarah',
        shiftId,
        amountMillimes: 20_000,
        reason: 'Wrong item',
      })],
    });
    await expect(reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: 0,
    })).rejects.toThrow('Resolve every void request before creating a Z report.');

    await orderService.resolveVoidRequest('z-pending-void', ownerId, 'reject');
    const summary = await reportService.getCurrentPeriodSummary(storeId);
    const zReport = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: summary.expectedCashExFloatMillimes,
    });
    expect(zReport.pendingVoids?.count).toBe(0);
  });

  it('reconciles counted card and other totals against sales and non-cash tab payments', async () => {
    const shiftId = 'shift-z-noncash-counts';
    prepareReportData([makeClosedShift(shiftId)]);
    setLocalData('orders', [
      makeOrder('card-sale', shiftId, 'done', 'card', 4_000),
      makeOrder('other-sale', shiftId, 'done', 'other', 3_000),
    ]);
    setLocalData('tabs', [
      makeTab('card-tab-payment', shiftId, 'settled', 1_000, 'card'),
      makeTab('other-tab-payment', shiftId, 'settled', 2_000, 'other'),
      { ...makeTab('card-tab-reversal', shiftId, 'reversal', 500, 'card'), reversesTabId: 'card-tab-payment', reversalAttribution: 'same_shift' },
      { ...makeTab('other-tab-reversal', shiftId, 'reversal', 500, 'other'), reversesTabId: 'other-tab-payment', reversalAttribution: 'same_shift' },
    ]);

    const report = await reportService.closeDayWithZReport(storeId, 'Owner', '1234', {
      countedCashMillimes: 0,
      countedCardMillimes: 4_500,
      countedOtherMillimes: 4_500,
    });

    expect(report.expectedCardMillimes).toBe(4_500);
    expect(report.cardDifferenceMillimes).toBe(0);
    expect(report.expectedOtherMillimes).toBe(4_500);
    expect(report.otherDifferenceMillimes).toBe(0);
  });

  it('creates a read-only own-shift X snapshot for staff with permission without recording a Z', async () => {
    const shiftId = 'shift-own-x';
    const staff = seedUsers.find((user) => user.id === staffId)!;
    prepareReportData([makeShift(shiftId, 2_000)]);
    setLocalData('users', [staff]);
    setLocalData('positions', seedPositions.map((position) => ({
      ...position,
      permissionIds: position.id === staff.positionId
        ? [...position.permissionIds, 'print_x_report']
        : position.permissionIds,
    })));
    setLocalData('orders', [makeOrder('own-x-sale', shiftId, 'done', 'cash', 3_000)]);

    const report = await reportService.createOwnShiftXReport(storeId, staffId, 'Cashier');

    expect(report).toMatchObject({
      type: 'X',
      reportNumber: expect.stringMatching(/^X-SHIFT-/),
      orderCount: 1,
      salesMillimes: 3_000,
      shifts: [expect.objectContaining({ shiftId })],
    });
    expect(await reportService.listReports(storeId)).toHaveLength(0);
  });

  it('keeps overnight tickets on their shift business date and resets after Z', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:00:00.000Z'));
    try {
      setLocalData('stores', seedStores.map((store) => store.id === storeId
        ? { ...store, timezone: 'UTC' }
        : store));
      setLocalData('reports', []);
      const shiftId = 'shift-overnight-business-date';
      setLocalData('shifts', [{
        ...makeShift(shiftId),
        openedAt: '2026-01-01T23:00:00.000Z',
      }]);
      setLocalData('order-counters', {
        [storeId]: { businessDate: '2026-01-01', nextNumber: 8 },
      });
      setLocalData('orders', [{
        ...makeOrder('overnight-ticket', shiftId, 'done', 'cash', 1_000),
        businessDate: '2026-01-01',
        createdAt: '2026-01-02T00:30:00.000Z',
      }]);

      await expect(orderService.getNextOrderNumber(storeId)).resolves.toBe(8);
      await expect(orderService.listToday(storeId)).resolves.toEqual([
        expect.objectContaining({ id: 'overnight-ticket' }),
      ]);

      setLocalData('reports', [{
        id: 'first-z',
        storeId,
        type: 'Z',
        businessDate: '2026-01-01',
        createdAt: '2026-01-02T02:00:00.000Z',
        periodTo: '2026-01-02T02:00:00.000Z',
        salesMillimes: 0,
        orderCount: 0,
        cashDifferenceMillimes: 0,
      }]);
      setLocalData('shifts', [{
        ...makeShift('shift-second-business-date'),
        openedAt: '2026-01-02T02:30:00.000Z',
      }]);
      await expect(orderService.getNextOrderNumber(storeId)).resolves.toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('force-closes all open shifts at zero, auto-approves pending voids, and records the Z tags', async () => {
    const openShift = makeShift('force-open-shift', 10_000);
    const closedShift = {
      ...makeClosedShift('force-closed-shift', 10_000),
      expectedCashMillimes: 10_000,
      countedCashMillimes: 10_000,
    };
    prepareReportData([openShift, closedShift]);
    setLocalData('orders', [
      { ...makeOrder('force-open-void', openShift.id, 'pending_void', 'cash', 20_000), voidReason: 'Wrong item' },
      { ...makeOrder('force-closed-void', closedShift.id, 'pending_void', 'cash', 30_000), voidReason: 'Refunded' },
    ]);
    setLocalData('auth-session', {
      userId: ownerId,
      expiresAt: Date.now() + 60_000,
    });

    const result = await shiftService.forceCloseDay('1234');
    expect(result.shifts).toHaveLength(2);
    expect(result.orders).toHaveLength(2);
    expect(result.shifts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'closed', differenceMillimes: 0 }),
    ]));
    await expect(shiftService.listOpenShifts(storeId)).resolves.toHaveLength(0);
    await expect(orderService.listAll(storeId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'force-open-void', status: 'voided', voidReason: 'Auto-approved at forced close' }),
      expect.objectContaining({ id: 'force-closed-void', status: 'voided', voidReason: 'Auto-approved at forced close' }),
    ]));

    const summary = await reportService.getCurrentPeriodSummary(storeId);
    const zReport = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: summary.expectedCashExFloatMillimes,
    });
    expect(zReport.shifts).toEqual(expect.arrayContaining([
      expect.objectContaining({ shiftId: openShift.id, forceClosedByOwner: true, voidsAutoApprovedCount: 1 }),
      expect.objectContaining({ shiftId: closedShift.id, forceClosedByOwner: false, voidsAutoApprovedCount: 1 }),
    ]));
    expect(zReport.voids?.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ autoApprovedAtForcedClose: true }),
    ]));
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

  it('requires activity after the last Z and blocks a second Z and X until a new shift opens', async () => {
    prepareReportData([makeClosedShift('shift-before-z', 1_000)]);
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa')).rejects.toThrow('Owner PIN is required');
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234')).rejects.toThrow('Counted cash excluding opening floats is required');
    await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });
    expect((await userService.getStore(storeId))?.dayClosedOn).toBe(new Date().toLocaleDateString('en-CA'));
    await expect(reportService.getDayStatus(storeId)).resolves.toMatchObject({
      dayIsClosed: true,
      hasActivity: false,
      openShiftCount: 0,
    });

    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 1_000,
    })).rejects.toThrow('The business day is closed. Open a new shift before creating another report.');
    await expect(reportService.createXReport(storeId)).rejects.toThrow(
      'The business day is closed. Open a new shift before creating another report.',
    );

    const newShift = await shiftService.openShift(storeId, staffId, 1_000);

    expect((await userService.getStore(storeId))?.dayClosedOn).toBeUndefined();
    await expect(reportService.getDayStatus(storeId)).resolves.toMatchObject({
      dayIsClosed: false,
      hasActivity: true,
      openShiftCount: 1,
    });
    const xReport = await reportService.createXReport(storeId);
    expect(xReport.periodFrom).toBe(newShift.openedAt);
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 2_000,
    })).rejects.toThrow('Force-close or close every shift before creating a Z report.');
  });

  it('does not allow Z while any shift is open', async () => {
    prepareReportData([makeShift('shift-open-z')]);
    await expect(reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    })).rejects.toThrow('Force-close or close every shift before creating a Z report.');
  });

  it('starts the next report period at the first new shift and allows another Z the same day', async () => {
    prepareReportData([makeClosedShift('shift-first-day')]);
    const firstZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });

    const newShift = await shiftService.openShift(storeId, staffId, 1_000);
    const xReport = await reportService.createXReport(storeId);
    expect(xReport.periodFrom).toBe(newShift.openedAt);

    await shiftService.closeShift(newShift.id, 1_000);
    const secondZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });
    expect(secondZ.periodFrom).toBe(newShift.openedAt);
    expect(new Date(secondZ.periodFrom).getTime()).toBeGreaterThan(new Date(firstZ.periodTo!).getTime());
  });

  it('keeps the shift business date when Z closes after midnight and excludes it from the next Z', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T01:00:00.000Z'));
    try {
      const firstShift = {
        ...makeClosedShift('shift-cross-midnight-z'),
        openedAt: '2026-11-22T08:00:00.000Z',
        closedAt: '2026-11-23T00:45:00.000Z',
      };
      prepareReportData([firstShift]);
      setLocalData('stores', seedStores.map((store) => store.id === storeId
        ? { ...store, timezone: 'Africa/Tunis', adminPin: '1234', adminPinHash: undefined }
        : store));
      setLocalData('reports', [{
        id: 'previous-z-before-shift',
        storeId,
        type: 'Z',
        businessDate: '2026-11-21',
        createdAt: '2026-11-22T07:00:00.000Z',
        periodTo: '2026-11-22T07:00:00.000Z',
        salesMillimes: 0,
        orderCount: 0,
        cashDifferenceMillimes: 0,
        shifts: [],
      }]);

      const firstZ = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
        countedCashMillimes: 0,
      });

      expect(firstZ.businessDate).toBe('2026-11-22');
      expect(firstZ.periodTo).toBe('2026-11-23T01:00:00.000Z');
      expect(firstZ.shifts?.map((shift) => shift.shiftId)).toEqual([firstShift.id]);
      expect(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Tunis',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(firstZ.periodTo!)).reduce<Record<string, string>>(
        (parts, part) => ({ ...parts, [part.type]: part.value }),
        {},
      )).toMatchObject({
        year: '2026',
        month: '11',
        day: '23',
        hour: '02',
        minute: '00',
        second: '00',
      });

      vi.setSystemTime(new Date('2026-11-23T01:15:00.000Z'));
      const nextShift = await shiftService.openShift(storeId, staffId, 0);
      vi.setSystemTime(new Date('2026-11-23T01:30:00.000Z'));
      await shiftService.closeShift(nextShift.id, 0);
      vi.setSystemTime(new Date('2026-11-23T01:45:00.000Z'));

      const nextZ = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
        countedCashMillimes: 0,
      });

      expect(nextZ.shifts?.map((shift) => shift.shiftId)).toEqual([nextShift.id]);
      expect(nextZ.shifts?.some((shift) => shift.shiftId === firstShift.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits each Z to shifts and orders opened in its period and freezes archived orders', async () => {
    const firstShift = makeClosedShift('shift-archived-period');
    const archivedOrder = {
      ...makeOrder('order-archived-period', firstShift.id, 'done', 'cash', 2_500),
      createdAt: new Date(Date.now() - 2_000).toISOString(),
    };
    prepareReportData([firstShift]);
    setLocalData('orders', [archivedOrder]);
    const firstZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });
    expect(firstZ.salesMillimes).toBe(2_500);

    await expect(orderService.requestVoid(archivedOrder.id, staffId, 'Wrong item'))
      .rejects.toThrow('Orders included in a closed Z report are archived and cannot be changed.');

    const currentShift = await shiftService.openShift(storeId, staffId, 1_000);
    const currentOrder = makeOrder('order-current-period', currentShift.id, 'done', 'cash', 700);
    setLocalData('orders', [archivedOrder, currentOrder]);
    await expect(orderService.listToday(storeId)).resolves.toEqual([currentOrder]);
    await shiftService.closeShift(currentShift.id, 1_700);

    const currentPeriod = await reportService.getCurrentPeriodSummary(storeId);
    expect(currentPeriod.shiftLines.map((shift) => shift.shiftId)).toEqual([currentShift.id]);

    const secondZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 700,
    });
    expect(secondZ.periodFrom).toBe(currentShift.openedAt);
    expect(secondZ.salesMillimes).toBe(700);
    expect(secondZ.shifts?.map((shift) => shift.shiftId)).toEqual([currentShift.id]);
    await expect(orderService.listToday(storeId)).resolves.toEqual([]);
  });

  it('falls back from a legacy date-only Z boundary to created_at across midnight', async () => {
    const previousZCreatedAt = new Date(2026, 2, 1, 23, 0).toISOString();
    const currentShiftOpenedAt = new Date(2026, 2, 2, 0, 5);
    const previouslyClosedShift: ShiftRecord = {
      ...makeClosedShift('shift-before-legacy-z', 1_000),
      openedAt: new Date(2026, 2, 1, 8, 0).toISOString(),
      closedAt: new Date(2026, 2, 1, 22, 30).toISOString(),
      expectedCashMillimes: 6_000,
      countedCashMillimes: 6_000,
    };
    const currentShift: ShiftRecord = {
      ...makeClosedShift('shift-after-legacy-z', 2_000),
      openedAt: currentShiftOpenedAt.toISOString(),
      closedAt: new Date(2026, 2, 2, 0, 30).toISOString(),
      expectedCashMillimes: 12_000,
      countedCashMillimes: 12_000,
    };
    prepareReportData([previouslyClosedShift, currentShift]);
    setLocalData('orders', [
      { ...makeOrder('legacy-period-sale', previouslyClosedShift.id, 'done', 'cash', 5_000), createdAt: new Date(2026, 2, 1, 10, 0).toISOString() },
      { ...makeOrder('new-period-sale', currentShift.id, 'done', 'cash', 10_000), createdAt: new Date(2026, 2, 2, 0, 10).toISOString() },
    ]);
    setLocalData('reports', [{
      id: 'legacy-z',
      storeId,
      type: 'Z',
      businessDate: '2026-03-01',
      createdAt: previousZCreatedAt,
      salesMillimes: 5_000,
      orderCount: 1,
      cashDifferenceMillimes: 0,
      periodFrom: '2026-03-01',
      periodTo: '2026-03-01',
      shifts: [],
    }]);

    const status = await reportService.getDayStatus(storeId);
    const summary = await reportService.getCurrentPeriodSummary(storeId);

    expect(status).toMatchObject({ dayIsClosed: false, hasActivity: true });
    expect(summary.shiftLines.map((shift) => shift.shiftId)).toEqual([currentShift.id]);
    expect(summary.salesMillimes).toBe(10_000);
    expect(summary.totalExpectedCashMillimes).toBe(12_000);
    expect(summary.cashFloatMillimes).toBe(2_000);
    expect(summary.expectedCashExFloatMillimes).toBe(10_000);

    const secondZ = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: 10_000,
    });
    expect(secondZ.periodFrom).toBe(currentShift.openedAt);
    expect(secondZ.businessDate).toBe('2026-03-02');
  });

  it('does not repeat same-day expenses already included in the previous Z report', async () => {
    prepareReportData([makeClosedShift('shift-first-day')]);
    const now = new Date();
    const expenseDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const previousExpense = {
      id: 'expense-previous-z',
      storeId,
      category: 'other' as const,
      amountMillimes: 800,
      paidMillimes: 800,
      date: expenseDate,
      createdAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
      createdBy: ownerId,
    };
    setLocalData('expenses', [previousExpense]);

    const firstZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });
    expect(firstZ.expensesMillimes).toBe(800);

    const preShiftExpense = {
      ...previousExpense,
      id: 'expense-before-new-shift',
      amountMillimes: 400,
      paidMillimes: 400,
      createdAt: new Date().toISOString(),
    };
    setLocalData('expenses', [previousExpense, preShiftExpense]);
    await shiftService.openShift(storeId, staffId, 1_000);
    const newExpense = {
      ...previousExpense,
      id: 'expense-next-z',
      amountMillimes: 300,
      paidMillimes: 300,
      createdAt: new Date().toISOString(),
    };
    setLocalData('expenses', [previousExpense, newExpense]);
    const openShift = await shiftService.getOpenShiftForUser(storeId, staffId);
    await shiftService.closeShift(openShift!.id, 1_000);

    const secondZ = await reportService.closeDayWithZReport(storeId, 'owner-lamarsa', '1234', {
      countedCashMillimes: 0,
    });
    expect(secondZ.expensesMillimes).toBe(300);
    expect(secondZ.expenseDetails?.map((expense) => expense.expenseId)).toEqual(['expense-next-z']);
  });

  it('includes owner-opened shifts in report lines and expected cash with their float', async () => {
    prepareReportData([]);
    const staffShift = await shiftService.openShift(storeId, staffId, 10_000);
    const ownerShift = await shiftService.openShift(storeId, ownerId, 20_000);
    setLocalData('orders', [
      makeOrder('staff-cash', staffShift.id, 'done', 'cash', 3_000),
      { ...makeOrder('owner-cash', ownerShift.id, 'done', 'cash', 5_000), staffId: ownerId },
    ]);

    await shiftService.closeShift(staffShift.id, 13_000);
    await shiftService.closeShift(ownerShift.id, 25_000);
    const report = await reportService.closeDayWithZReport(storeId, ownerId, '1234', {
      countedCashMillimes: 8_000,
    });

    expect(report.shifts).toEqual(expect.arrayContaining([
      expect.objectContaining({ staffName: 'Sarah', expectedCashMillimes: 13_000, startingCashMillimes: 10_000 }),
      expect.objectContaining({ staffName: 'Si Mohamed', expectedCashMillimes: 25_000, startingCashMillimes: 20_000 }),
    ]));
    expect(report.totalExpectedCashMillimes).toBe(38_000);
    expect(report.cashFloatMillimes).toBe(30_000);
    expect(report.expectedCashExFloatMillimes).toBe(8_000);
    expect(report.countedCashMillimes).toBe(8_000);
    expect(report.cashDifferenceMillimes).toBe(0);
    expect(report.countedCashIncludesFloat).toBe(false);
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
