import { describe, expect, it } from 'vitest';
import { buildReportDocument, formatReceiptRow } from '../src/services/reportDocument';
import { buildTicketDocument } from '../src/services/ticketDocument';
import { resolveStoreSettings, type OrderRecord, type ReportRecord } from '../src/types/domain';

function makeReport(type: 'X' | 'Z'): ReportRecord {
  return {
    id: 'report-1',
    storeId: 'store-1',
    storeName: 'Test Store',
    type,
    businessDate: '2026-11-20',
    createdAt: '2026-11-20T20:00:00.000Z',
    salesMillimes: 3000,
    salesCollectedMillimes: 3000,
    orderCount: 2,
    cashDifferenceMillimes: 0,
    zNumber: type === 'Z' ? 12 : undefined,
    reportNumber: type === 'Z' ? 'Z-000012' : undefined,
    paymentSplit: { cash: 1000, card: 1000, other: 0, tab: 1000 },
    itemsSold: [
      { itemId: 'i1', name: 'Coffee', quantity: 1, unitPriceMillimes: 1000, totalMillimes: 1000 },
      { itemId: 'i2', name: 'Tea', quantity: 2, unitPriceMillimes: 1000, totalMillimes: 2000 },
    ],
    salesByCategory: [{ categoryId: 'c1', name: 'Drinks', quantity: 3, totalMillimes: 3000 }],
    totalExpectedCashMillimes: 2000,
    expectedCashExFloatMillimes: 1000,
    cashFloatMillimes: 1000,
    cashSalesMillimes: 1000,
    tabPaymentsReceivedMillimes: 250,
    cashInMillimes: 500,
    cashOutMillimes: 250,
    countedCashMillimes: 1000,
    cashDifference: 0,
    cashDifferenceMillimes: 0,
  };
}

describe('report document', () => {
  it('wraps long thermal rows without dropping their label or value', () => {
    const formatted = formatReceiptRow(
      'Cash / card / other / tab',
      '5.000 DT / 2.000 DT / 0.000 DT / 1.500 DT',
      58,
    );
    expect(formatted).toContain('Cash / card / other / tab');
    expect(formatted.replace(/\s+/g, ' ')).toContain('5.000 DT / 2.000 DT / 0.000 DT / 1.500 DT');
    expect(formatted.split('\n').every((line) => Array.from(line).length <= 32)).toBe(true);
    const longRow = formatReceiptRow('Customer left terrace before serving · Si Mohamed', '5.400 DT', 80);
    expect(longRow.replace(/\s+/g, ' ')).toContain('Customer left terrace before serving · Si Mohamed');
    expect(longRow.replace(/\s+/g, ' ')).toContain('5.400 DT');
    expect(longRow.split('\n').every((line) => Array.from(line).length <= 48)).toBe(true);
  });

  it('prints every recorded void, cash movement, comp, and shift detail', () => {
    const report = makeReport('Z');
    report.voids = {
      count: 1,
      totalMillimes: 1200,
      orders: [{ ticketNumber: 8, reason: 'Wrong item', totalMillimes: 1200, approvedBy: 'Owner' }],
    };
    report.cashMovements = [{
      shiftId: 'shift-1',
      staffName: 'Cashier',
      kind: 'out',
      reason: 'supplier_payment',
      amountMillimes: 500,
      note: 'Milk delivery',
      createdAt: '2026-11-20T12:00:00.000Z',
    }];
    report.comps = {
      count: 1,
      quantity: 2,
      totalMillimes: 750,
      records: [{
        staffName: 'Cashier',
        itemName: 'Coffee',
        quantity: 2,
        valueMillimes: 750,
        reason: 'staff_drink',
        note: 'Shift drink',
        createdAt: '2026-11-20T12:30:00.000Z',
      }],
    };
    report.expensesMillimes = 1200;
    report.expenseDetails = [{
      expenseId: 'expense-1',
      category: 'supplier',
      amountMillimes: 1200,
      paidMillimes: 800,
      date: '2026-11-20',
      supplierId: 'supplier-1',
      note: 'Coffee beans',
      createdBy: 'Owner',
    }];
    report.shifts = [{
      shiftId: 'shift-1',
      staffName: 'Cashier',
      orderCount: 2,
      status: 'closed',
      openedAt: '2026-11-20T07:00:00.000Z',
      closedAt: '2026-11-20T15:00:00.000Z',
      startingCashMillimes: 1000,
      expectedCashMillimes: 2000,
      countedCashMillimes: 1800,
      differenceMillimes: -200,
      cashFlowExFloatMillimes: 1000,
      forceClosedByOwner: true,
    }];

    const document = buildReportDocument(report, { name: 'Test Store' });
    const text = document.lines.map((line) => line.text).join('\n').replace(/\s+/g, ' ');
    expect(text).toContain('Voided order count');
    expect(text).toContain('Wrong item');
    expect(text).toContain('Milk delivery');
    expect(text).toContain('Shift drink');
    expect(text).toContain('Coffee beans');
    expect(text).toContain('0.800 DT paid');
    expect(text).toContain('Closed by owner');
    expect(text).toContain('BALANCED');
  });

  it('builds the required sections and reconciles category totals', () => {
    const report = makeReport('Z');
    const document = buildReportDocument(report, { name: 'Test Store' }, resolveStoreSettings());
    expect(document.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining([
        'SALES',
        'ITEMS SOLD',
        'CASH MOVEMENTS',
        'FLOAT (NOT COUNTED)',
        'CASH FLOW BY SHIFT',
        'CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)',
        'BY CATEGORY',
      ]),
    );
    expect(document.sections.at(-1)?.title).toBe('CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)');
    const categoryTotal = report.salesByCategory?.reduce((sum, category) => sum + category.totalMillimes, 0);
    expect(categoryTotal).toBe(3000);
  });

  it('preserves a Z snapshot instead of recomputing it', () => {
    const report = makeReport('Z');
    const document = buildReportDocument(report, { name: 'Test Store' }, resolveStoreSettings());
    expect(document.lines.some((line) => line.text.includes('Z-000012'))).toBe(true);
    expect(document.subtitle).toBe('Official day close');
    expect(document.sections.at(-1)?.title).toBe('CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)');
    const finalSection = document.sections.at(-1)!;
    expect(finalSection.lines.find((line) => line.label === 'EXPECTED CASH')).toMatchObject({ size: 'double' });
    expect(finalSection.lines.find((line) => line.label === 'COUNTED CASH')).toMatchObject({ size: 'double' });
    expect(finalSection.lines.find((line) => line.label === 'BALANCED')).toMatchObject({ size: 'double' });
    expect(document.lines.find((line) => line.text.includes('EXPECTED CASH'))?.size).toBe('double');
    expect(document.lines.find((line) => line.text.includes('BALANCED'))?.size).toBe('double');
  });

  it('marks an X report interim without presenting it as a day close', () => {
    const document = buildReportDocument(makeReport('X'), { name: 'Test Store' });
    expect(document.lines.some((line) => line.text === 'INTERIM - DAY REMAINS OPEN')).toBe(true);
    expect(document.sections.at(-1)?.title).toBe('CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)');
    expect(document.sections.at(-1)?.lines.find((line) => line.label === 'EXPECTED CASH')?.size).toBe('double');
    expect(document.sections.at(-1)?.lines.some((line) => line.label === 'Not counted - X report is interim')).toBe(true);
  });

  it('prints an ex-float shortage with the double-size difference and supports old snapshots', () => {
    const report = makeReport('Z');
    report.totalExpectedCashMillimes = 215_000;
    report.cashFloatMillimes = 100_000;
    report.expectedCashExFloatMillimes = undefined;
    report.countedCashMillimes = 213_500;
    report.cashDifference = -1_500;
    report.cashDifferenceMillimes = -1_500;
    const document = buildReportDocument(report, { name: 'Test Store' });
    const finalSection = document.sections.at(-1)!;

    expect(finalSection.lines.find((line) => line.label === 'EXPECTED CASH')).toMatchObject({
      value: '115.000 DT',
      size: 'double',
    });
    expect(finalSection.lines.find((line) => line.label === 'SHORT 1.500 DT')).toMatchObject({ size: 'double' });
    expect(document.lines.find((line) => line.text.includes('SHORT 1.500 DT'))?.size).toBe('double');
  });

  it('uses the frozen report settings and shows only recorded cash movements', () => {
    const report = makeReport('Z');
    report.frozenPaperWidth = 58;
    report.frozenReportFooterText = ['Archived copy'];
    const document = buildReportDocument(report, { name: 'Renamed store' }, { paperWidth: 80, reportFooterText: ['New footer'] });
    expect(document.width).toBe(58);
    expect(document.lines.at(-1)?.text).toBe('Archived copy');
    expect(document.sections.find((section) => section.title === 'CASH MOVEMENTS')?.lines).toEqual(
      expect.arrayContaining([{ label: 'Cash in', value: '+0.500 DT' }, { label: 'Cash out', value: '-0.250 DT' }]),
    );
    expect(document.sections.find((section) => section.title === 'CASH MOVEMENTS')?.lines)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Cash refunds' })]));
  });

  it('builds a ticket from actual order lines and respects visibility settings', () => {
    const order: OrderRecord = {
      id: 'order-1',
      number: 42,
      storeId: 'store-1',
      staffId: 'staff-1',
      staffName: 'Cashier',
      shiftId: 'shift-1',
      status: 'done',
      paymentMethod: 'cash',
      items: [{
        itemId: 'coffee',
        name: 'Coffee',
        quantity: 2,
        unitPriceMillimes: 1500,
        lineTotalMillimes: 3000,
        modifiers: ['Oat milk'],
      }],
      totalMillimes: 3000,
      createdAt: '2026-11-20T20:00:00.000Z',
    };
    const document = buildTicketDocument(order, { name: 'Test Store' }, 'Cashier', {
      paperWidth: 58,
      showStaffName: false,
      showDateTime: false,
      ticketFooterText: ['Keep this ticket'],
    });
    const text = document.lines.map((line) => line.text).join('\n');
    expect(document.width).toBe(58);
    expect(text).toContain('2 x 1.500 DT');
    expect(text).toContain('3.000 DT');
    expect(text).toContain('Oat milk');
    expect(text).toContain('Keep this ticket');
    expect(text).not.toContain('Staff:');
    expect(text).not.toContain('2026');
  });

  it('validates ticket settings limits', () => {
    const settings = resolveStoreSettings({
      ticketHeaderText: ['A'.repeat(60), 'B'.repeat(60), 'C'.repeat(60)],
      ticketFooterText: ['Thank you'],
      paperWidth: 58,
    });
    expect(settings.ticketHeaderText).toHaveLength(2);
    expect(settings.ticketHeaderText[0]).toHaveLength(60);
    expect(settings.paperWidth).toBe(58);
  });
});
