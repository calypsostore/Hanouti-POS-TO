import { formatTnd } from '../lib/format';
import type { ReportRecord, StoreRecord, StoreSettings } from '../types/domain';
import { resolveStoreSettings } from '../types/domain';
import { getLogoSrc } from '../data/logoCatalog';

export interface ReceiptLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 'normal' | 'double';
  kind?: 'section' | 'divider' | 'footer';
}

export interface ThermalReceiptDocument {
  title: string;
  subtitle?: string;
  width: 58 | 80;
  logoSrc?: string;
  lines: ReceiptLine[];
}

export interface ReportSection {
  title: string;
  lines: { label: string; value: string; emphasized?: boolean; size?: 'double' }[];
}

export interface ReportDocument extends ThermalReceiptDocument {
  sections: ReportSection[];
}

const money = (amount: number | undefined) => `${formatTnd((amount ?? 0) / 1000)} DT`;
const localDateTime = (value: string | undefined) => value ? new Date(value).toLocaleString() : 'Not recorded';
const columns = (width: 58 | 80) => width === 58 ? 32 : 48;
const divider = (width: 58 | 80) => '-'.repeat(columns(width));

function wrapText(value: string, width: number): string {
  const lines: string[] = [];
  let remaining = Array.from(value);
  while (remaining.length > width) {
    let breakAt = width;
    while (breakAt > 0 && remaining[breakAt] !== ' ') breakAt -= 1;
    if (breakAt === 0) breakAt = width;
    lines.push(remaining.slice(0, breakAt).join('').trimEnd());
    remaining = Array.from(remaining.slice(breakAt).join('').trimStart());
  }
  if (remaining.length) lines.push(remaining.join(''));
  return lines.join('\n');
}

export function formatReceiptRow(label: string, value: string, width: 58 | 80): string {
  const max = columns(width);
  const right = Array.from(value);
  const left = Array.from(label);
  if (!value) return wrapText(label, max);
  if (right.length >= max || left.length > max - right.length) {
    return `${wrapText(label, max)}\n${wrapText(value, max)}`;
  }
  const leftWidth = max - right.length;
  const firstLine = `${left.slice(0, leftWidth).join('').padEnd(leftWidth)}${right.join('')}`;
  return firstLine;
}

function appendSection(sections: ReportSection[], title: string, lines: ReportSection['lines']): void {
  if (lines.length > 0) sections.push({ title, lines });
}

export function buildReportDocument(
  report: ReportRecord,
  store: Pick<StoreRecord, 'name' | 'address' | 'phone' | 'taxId'>,
  settings?: Partial<StoreSettings>,
): ReportDocument {
  const resolved = resolveStoreSettings(report.frozenSettings ?? settings);
  const width = report.frozenPaperWidth ?? resolved.paperWidth;
  const storeName = report.frozenStoreName ?? report.storeName ?? store.name;
  const sections: ReportSection[] = [];
  const customerTabDetails = report.customerTabs ?? [];
  const tabPayments = report.tabsSettledMillimes ?? report.tabPaymentsReceivedMillimes;
  const nonCashTabPayments = report.nonCashTabPaymentsMillimes;
  const allTabPayments = tabPayments === undefined
    ? nonCashTabPayments
    : tabPayments + (nonCashTabPayments ?? 0);
  const reportShifts = report.shifts ?? [];
  const cashFloat = report.cashFloatMillimes ?? reportShifts.reduce((sum, shift) => sum + shift.startingCashMillimes, 0);
  const expectedCashExFloat = report.expectedCashExFloatMillimes ??
    (report.totalExpectedCashMillimes === undefined ? undefined : report.totalExpectedCashMillimes - cashFloat);
  const countedCashExFloat = report.countedCashMillimes === undefined
    ? undefined
    : report.countedCashIncludesFloat
      ? report.countedCashMillimes - cashFloat
      : report.expectedCashExFloatMillimes === undefined
      ? report.countedCashMillimes - cashFloat
      : report.countedCashMillimes;
  const expectedCashForDrawer = report.countedCashIncludesFloat
    ? report.totalExpectedCashMillimes
    : expectedCashExFloat;
  const countedCashForDrawer = report.countedCashIncludesFloat
    ? report.countedCashMillimes
    : countedCashExFloat;
  const cashDifference = report.cashDifference ?? (
    countedCashForDrawer !== undefined && expectedCashForDrawer !== undefined
      ? countedCashForDrawer - expectedCashForDrawer
      : report.cashDifferenceMillimes
  );

  const paymentSplit = report.paymentSplit;
  const cashSales = paymentSplit?.cash ?? report.cashSalesMillimes;
  const drawerCashSales = report.cashSalesMillimes ?? cashSales;
  const tabSales = paymentSplit?.tab ?? report.tabSalesMillimes;
  appendSection(sections, 'SALES', [
    { label: 'Transactions', value: String(report.orderCount) },
    { label: 'Gross sales', value: money(report.grossMillimes ?? report.salesMillimes) },
    ...(report.discountsMillimes !== undefined && report.discountsMillimes !== 0
      ? [{ label: 'Discounts', value: money(report.discountsMillimes) }]
      : []),
    { label: 'Net sales', value: money(report.netMillimes ?? report.salesMillimes), emphasized: true },
    ...(report.salesCollectedMillimes === undefined ? [] : [{ label: 'Sales collected', value: money(report.salesCollectedMillimes) }]),
    ...(cashSales === undefined ? [] : [{ label: 'Cash', value: money(cashSales) }]),
    ...(paymentSplit ? [
      { label: 'Card', value: money(paymentSplit.card), emphasized: true },
      { label: 'Other', value: money(paymentSplit.other) },
    ] : []),
    ...(tabSales === undefined ? [] : [{ label: 'Tab sales', value: money(tabSales) }]),
  ]);
  if (report.expensesMillimes !== undefined || report.netProfitMillimes !== undefined || report.expenseDetails?.length) {
    appendSection(sections, 'EXPENSES / NET', [
      ...(report.expensesMillimes === undefined ? [] : [{ label: 'Expenses', value: money(report.expensesMillimes) }]),
      ...(report.netProfitMillimes === undefined ? [] : [{ label: 'Net after expenses', value: money(report.netProfitMillimes), emphasized: true }]),
      ...(report.expenseDetails ?? []).map((expense) => ({
        label: `${expense.date} · ${expense.category}${expense.supplierId ? ` · Supplier ${expense.supplierId}` : ''} · ${expense.createdBy}${expense.note ? ` · ${expense.note}` : ''}`,
        value: `${money(expense.amountMillimes)} (${money(expense.paidMillimes)} paid)`,
      })),
    ]);
  }

  const items = report.itemsSold ?? [];
  const itemGroups = new Map<string, typeof items>();
  for (const item of items) {
    const category = item.categoryName ?? 'Other';
    const group = itemGroups.get(category) ?? [];
    group.push(item);
    itemGroups.set(category, group);
  }
  const itemLines: ReportSection['lines'] = [];
  for (const [category, categoryItems] of itemGroups) {
    itemLines.push({ label: category, value: '', emphasized: true });
    for (const item of categoryItems) {
      itemLines.push({
        label: `${item.quantity} x ${item.name}${item.unitPriceMillimes === undefined ? '' : ` @ ${money(item.unitPriceMillimes)}`}`,
        value: money(item.totalMillimes),
      });
    }
    itemLines.push({
      label: `${category} subtotal`,
      value: money(categoryItems.reduce((sum, item) => sum + item.totalMillimes, 0)),
      emphasized: true,
    });
  }
  appendSection(sections, 'ITEMS SOLD', itemLines);

  if (report.voids) {
    appendSection(sections, 'VOIDED ORDERS', [
      { label: 'Voided order count', value: String(report.voids.count), emphasized: true },
      { label: 'Voided order total', value: money(report.voids.totalMillimes) },
      ...report.voids.orders.map((item) => ({
        label: item.autoApprovedAtForcedClose
          ? `#${item.ticketNumber} auto-approved at forced close`
          : `#${item.ticketNumber} ${item.reason || 'Reason not recorded'} · ${item.approvedBy ?? 'Unknown'}`,
        value: money(item.totalMillimes),
      })),
    ]);
  }

  if (report.type === 'X' || report.type === 'Z') {
    appendSection(sections, 'PENDING VOIDS (TREATED AS VOIDED FOR SALES AND CASH UNTIL REJECTED)', [
      { label: 'Pending void count', value: report.pendingVoids ? String(report.pendingVoids.count) : 'Not recorded', emphasized: true },
      { label: 'Pending void total', value: report.pendingVoids ? money(report.pendingVoids.totalMillimes) : 'Not recorded' },
      { label: 'Stock handling', value: 'Stock is held until approval.' },
      ...(report.pendingVoids?.orders ?? []).map((item) => ({
        label: `#${item.ticketNumber} · ${item.staffName} · ${item.reason || 'Reason not recorded'}`,
        value: money(item.amountMillimes),
      })),
    ]);
  }

  if ((tabPayments !== undefined && tabPayments !== 0) || (nonCashTabPayments !== undefined && nonCashTabPayments !== 0)) {
    appendSection(sections, 'TAB PAYMENTS', [
      ...(tabPayments === undefined ? [] : [{ label: 'Payments received in cash', value: money(tabPayments) }]),
      ...(nonCashTabPayments === undefined ? [] : [{ label: 'Payments received by card / other (not cash)', value: money(nonCashTabPayments) }]),
    ]);
  }
  if (customerTabDetails.length) {
    appendSection(sections, 'CUSTOMER TABS', [
      { label: 'Issued / settled / outstanding', value: `${money(report.tabsIssuedMillimes ?? customerTabDetails.reduce((sum, item) => sum + item.issuedMillimes, 0))} / ${money(allTabPayments ?? customerTabDetails.reduce((sum, item) => sum + item.paymentsMillimes, 0))} / ${money(report.tabsOutstandingMillimes ?? report.receivableMillimes ?? customerTabDetails.reduce((sum, item) => sum + item.outstandingMillimes, 0))}`, emphasized: true },
      ...customerTabDetails.flatMap((customer) => [
        { label: customer.customerName, value: '' },
        { label: 'Issued / paid', value: `${money(customer.issuedMillimes)} / ${money(customer.paymentsMillimes)}` },
        { label: 'Outstanding', value: money(customer.outstandingMillimes), emphasized: true },
      ]),
    ]);
  } else if (
    report.tabsIssuedMillimes !== undefined ||
    allTabPayments !== undefined ||
    report.tabsOutstandingMillimes !== undefined ||
    report.receivableMillimes !== undefined
  ) {
    appendSection(sections, 'CUSTOMER TABS', [
      {
        label: 'Issued / paid / outstanding',
        value: `${money(report.tabsIssuedMillimes)} / ${money(allTabPayments)} / ${money(report.tabsOutstandingMillimes ?? report.receivableMillimes)}`,
        emphasized: true,
      },
    ]);
  }

  if (report.unresolvedTabReversals?.length) {
    appendSection(sections, 'UNRESOLVED TAB REVERSALS — NOT INCLUDED IN VERIFIED TOTALS', report.unresolvedTabReversals.map((reversal) => ({
      label: `${reversal.paymentMethod.toUpperCase()} · Reversal ${reversal.reversalId} · Settlement ${reversal.originalSettlementId} · Shift ${reversal.reversalShiftId} · ${reversal.reversalCreatedAt}`,
      value: `UNRESOLVED ${money(reversal.amountMillimes)}${reversal.reason ? ` · ${reversal.reason}` : ''}`,
    })));
  }

  if (report.voidAdjustments?.length) {
    appendSection(sections, 'POST-CLOSE VOID ADJUSTMENTS', report.voidAdjustments.map((adjustment) => ({
      label: `Ticket #${adjustment.orderNumber} · ${adjustment.staffName} · ${new Date(adjustment.createdAt).toLocaleString()}`,
      value: `${adjustment.amountMillimes > 0 ? '+' : adjustment.amountMillimes < 0 ? '-' : ''}${money(Math.abs(adjustment.amountMillimes))}`,
    })));
  }

  const cashMovements: ReportSection['lines'] = [];
  if (drawerCashSales !== undefined) cashMovements.push({ label: 'Cash sales', value: `+${money(drawerCashSales)}` });
  if (tabPayments !== undefined) cashMovements.push({ label: 'Tab payments received', value: `+${money(tabPayments)}` });
  if (report.cashInMillimes !== undefined) cashMovements.push({ label: 'Cash in', value: `+${money(report.cashInMillimes)}` });
  if (report.cashOutMillimes !== undefined) cashMovements.push({ label: 'Cash out', value: `-${money(report.cashOutMillimes)}` });
  if (report.cashRefundsMillimes !== undefined) cashMovements.push({ label: 'Cash refunds', value: `-${money(report.cashRefundsMillimes)}` });
  const voidAdjustmentTotal = (report.voidAdjustments ?? []).reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
  if (voidAdjustmentTotal !== 0) {
    cashMovements.push({
      label: 'Post-close void adjustments',
      value: `${voidAdjustmentTotal > 0 ? '+' : '-'}${money(Math.abs(voidAdjustmentTotal))}`,
    });
  }
  const detailedMovements = report.cashMovements?.length ? report.cashMovements : (report.cashOuts ?? []).map((movement) => ({
    ...movement,
    kind: 'out' as const,
  }));
  for (const movement of detailedMovements) {
    cashMovements.push({
      label: `${movement.kind === 'in' ? 'Cash in' : 'Cash out'} · ${movement.reason.replaceAll('_', ' ')} · ${movement.staffName} · ${localDateTime(movement.createdAt)} · Shift ${movement.shiftId}`,
      value: money(movement.amountMillimes),
    });
    const lastLine = cashMovements[cashMovements.length - 1];
    if (movement.note) lastLine.label += ` · ${movement.note}`;
  }
  appendSection(sections, 'CASH MOVEMENTS', cashMovements);

  const employees = new Map<string, {
    staffId?: string;
    name: string;
    orderCount?: number;
    salesMillimes?: number;
    shifts: NonNullable<ReportRecord['shifts']>;
    voidedOrderCount: number;
    voidedTotalMillimes: number;
  }>();
  const employeeKeysByName = new Map<string, string[]>();
  for (const employee of report.employeeBreakdown ?? []) {
    employees.set(employee.staffId, {
      staffId: employee.staffId,
      name: employee.name,
      orderCount: employee.orderCount,
      salesMillimes: employee.salesMillimes,
      shifts: [],
      voidedOrderCount: 0,
      voidedTotalMillimes: 0,
    });
    employeeKeysByName.set(employee.name, [...(employeeKeysByName.get(employee.name) ?? []), employee.staffId]);
  }
  for (const shift of reportShifts) {
    const sameNameKeys = employeeKeysByName.get(shift.staffName) ?? [];
    const staffId = shift.staffId ?? (sameNameKeys.length === 1 ? sameNameKeys[0] : undefined);
    const key = staffId ?? `shift:${shift.shiftId}`;
    const employee = employees.get(key) ?? {
      staffId,
      name: shift.staffName,
      shifts: [],
      voidedOrderCount: 0,
      voidedTotalMillimes: 0,
    };
    employee.shifts.push(shift);
    employees.set(key, employee);
  }
  for (const order of report.voids?.orders ?? []) {
    if (!order.staffId) continue;
    const employee = employees.get(order.staffId) ?? {
      staffId: order.staffId,
      name: order.staffName ?? 'Staff',
      shifts: [],
      voidedOrderCount: 0,
      voidedTotalMillimes: 0,
    };
    employee.voidedOrderCount += 1;
    employee.voidedTotalMillimes += order.totalMillimes;
    employees.set(order.staffId, employee);
  }
  const employeeLines: ReportSection['lines'] = [];
  for (const employee of employees.values()) {
    const shifts = employee.shifts;
    const sumShiftValue = (select: (shift: typeof shifts[number]) => number | undefined) => {
      if (!shifts.length) return undefined;
      const values = shifts.map(select);
      if (values.some((value) => value === undefined)) return undefined;
      return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    };
    const orderCount = employee.orderCount ?? sumShiftValue((shift) => shift.orderCount);
    const salesMillimes = employee.salesMillimes ?? sumShiftValue((shift) => (
      [shift.cashSalesMillimes, shift.cardSalesMillimes, shift.otherSalesMillimes, shift.tabSalesMillimes]
        .some((value) => value === undefined)
        ? undefined
        : (shift.cashSalesMillimes ?? 0) + (shift.cardSalesMillimes ?? 0)
          + (shift.otherSalesMillimes ?? 0) + (shift.tabSalesMillimes ?? 0)
    ));
    employeeLines.push({
      label: `${employee.name} · ${orderCount === undefined ? 'Order count unavailable' : `${orderCount} orders`}`,
      value: salesMillimes === undefined ? 'Sales not recorded' : money(salesMillimes),
      emphasized: true,
    });
    if (employee.voidedOrderCount > 0) {
      employeeLines.push({
        label: 'Voided orders / total',
        value: `${employee.voidedOrderCount} / ${money(employee.voidedTotalMillimes)}`,
      });
    }
    if (!shifts.length) continue;

    const paymentFields = [
      shifts.some((shift) => shift.cashSalesMillimes !== undefined) ? sumShiftValue((shift) => shift.cashSalesMillimes) : undefined,
      shifts.some((shift) => shift.cardSalesMillimes !== undefined) ? sumShiftValue((shift) => shift.cardSalesMillimes) : undefined,
      shifts.some((shift) => shift.otherSalesMillimes !== undefined) ? sumShiftValue((shift) => shift.otherSalesMillimes) : undefined,
      shifts.some((shift) => shift.tabSalesMillimes !== undefined) ? sumShiftValue((shift) => shift.tabSalesMillimes) : undefined,
    ];
    if (paymentFields.some((value) => value !== undefined)) {
      employeeLines.push({
        label: 'Cash / card / other / tab sales',
        value: paymentFields.map((value) => value === undefined ? 'Not recorded' : money(value)).join(' / '),
      });
    }
    employeeLines.push({
      label: 'Shift count / starting cash',
      value: `${shifts.length} / ${money(sumShiftValue((shift) => shift.startingCashMillimes))}`,
    });
    const expected = sumShiftValue((shift) => shift.expectedCashMillimes);
    const counted = sumShiftValue((shift) => shift.countedCashMillimes);
    employeeLines.push({
      label: 'Expected / counted cash',
      value: `${expected === undefined ? 'Not recorded' : money(expected)} / ${counted === undefined ? 'Not recorded' : money(counted)}`,
    });
    const cashIn = sumShiftValue((shift) => shift.cashInMillimes);
    const cashOut = sumShiftValue((shift) => shift.cashOutMillimes);
    if (cashIn !== undefined || cashOut !== undefined) {
      employeeLines.push({
        label: 'Cash in / out',
        value: `${cashIn === undefined ? 'Not recorded' : money(cashIn)} / ${cashOut === undefined ? 'Not recorded' : money(cashOut)}`,
      });
    }
    const shiftIds = new Set(shifts.map((shift) => shift.shiftId));
    const postCloseVoids = (report.voidAdjustments ?? []).filter((item) => shiftIds.has(item.shiftId));
    if (postCloseVoids.length) {
      const count = (kind: NonNullable<ReportRecord['voidAdjustments']>[number]['kind']) =>
        postCloseVoids.filter((item) => item.kind === kind).length;
      employeeLines.push({
        label: 'Post-close cash adjustment records (request / approval / rejection)',
        value: `${count('requested')} / ${count('approved')} / ${count('rejected')}`,
      });
    }
  }
  appendSection(sections, 'BY EMPLOYEE', employeeLines);

  if (reportShifts.length) {
    appendSection(sections, 'BY SHIFT / PERSON', reportShifts.flatMap((shift) => {
      const lines: ReportSection['lines'] = [
        {
          label: `${shift.staffName} · ${shift.orderCount === undefined ? 'Order count unavailable' : `${shift.orderCount} orders`} · ${shift.status === 'in_progress' ? 'Open' : shift.status === 'closed' ? 'Closed' : 'Status unavailable'}`,
          value: '',
        },
        { label: 'Shift ID', value: shift.shiftId },
        { label: 'Opened', value: localDateTime(shift.openedAt) },
        ...(shift.closedAt ? [{ label: 'Closed', value: localDateTime(shift.closedAt) }] : []),
        { label: 'Starting cash', value: money(shift.startingCashMillimes) },
        { label: 'Closed by force', value: shift.forceClosedByOwner ? 'Yes · UNVERIFIED' : 'No' },
        ...(shift.voidsAutoApprovedCount
          ? [{ label: 'Voids auto-approved at forced close', value: String(shift.voidsAutoApprovedCount) }]
          : []),
      ];
      if (shift.cashSalesMillimes !== undefined) lines.push({ label: 'Cash sales', value: money(shift.cashSalesMillimes) });
      if (shift.cardSalesMillimes !== undefined) lines.push({ label: 'Card sales', value: money(shift.cardSalesMillimes), emphasized: true });
      if (shift.otherSalesMillimes !== undefined) lines.push({ label: 'Other sales', value: money(shift.otherSalesMillimes) });
      if (shift.tabSalesMillimes !== undefined) lines.push({ label: 'Tab sales', value: money(shift.tabSalesMillimes) });
      if (shift.tabPaymentsMillimes !== undefined) lines.push({ label: 'Tab payments', value: money(shift.tabPaymentsMillimes) });
      if (shift.expectedCashMillimes !== undefined || shift.countedCashMillimes !== undefined) {
        lines.push({
          label: 'Expected / counted cash',
          value: `${shift.expectedCashMillimes === undefined ? 'Not recorded' : money(shift.expectedCashMillimes)} / ${shift.countedCashMillimes === undefined ? 'Not recorded' : money(shift.countedCashMillimes)}`,
        });
      }
      if (shift.voidAdjustmentMillimes !== undefined) {
        lines.push({ label: 'Post-close void adjustments', value: money(shift.voidAdjustmentMillimes) });
      }
      if (shift.voidRequestsMillimes !== undefined) {
        lines.push({ label: 'Void requests', value: `${shift.voidRequestsMillimes < 0 ? '-' : '+'}${money(Math.abs(shift.voidRequestsMillimes))}` });
      }
      if (shift.voidRejectionsMillimes !== undefined) {
        lines.push({ label: 'Void rejections', value: `${shift.voidRejectionsMillimes < 0 ? '-' : '+'}${money(Math.abs(shift.voidRejectionsMillimes))}` });
      }
      if (report.type === 'Z' && shift.differenceMillimes !== undefined) {
        const difference = shift.differenceMillimes;
        lines.push({
          label: 'Cash difference',
          value: difference < 0
            ? `SHORT ${money(Math.abs(difference))}`
            : difference > 0
              ? `OVER ${money(difference)}`
              : 'BALANCED',
          emphasized: true,
        });
      }
      if (shift.cashInMillimes !== undefined || shift.cashOutMillimes !== undefined) {
        lines.push({
          label: 'Cash in / out',
          value: `${shift.cashInMillimes === undefined ? '—' : money(shift.cashInMillimes)} / ${shift.cashOutMillimes === undefined ? '—' : money(shift.cashOutMillimes)}`,
        });
      }
      return lines;
    }));
  }

  appendSection(sections, 'BY CATEGORY', (report.salesByCategory ?? []).map((category) => ({
    label: `${category.quantity} x ${category.name}`,
    value: money(category.totalMillimes),
  })));

  if (report.comps) {
    appendSection(sections, 'STAFF ITEMS / COMPS', [
      { label: 'Comp count / quantity', value: `${report.comps.count} / ${report.comps.quantity}`, emphasized: true },
      { label: 'Comp value', value: money(report.comps.totalMillimes) },
      ...report.comps.records.map((item) => ({
        label: `${item.quantity} x ${item.itemName} · ${item.staffName} · ${item.reason.replaceAll('_', ' ')}${item.createdAt ? ` · ${localDateTime(item.createdAt)}` : ''}${item.note ? ` · ${item.note}` : ''}`,
        value: money(item.valueMillimes),
      })),
    ]);
  }

  const finalCashLines: ReportSection['lines'] = [
    { label: 'Cash sales', value: money(report.cashSalesMillimes ?? paymentSplit?.cash) },
    { label: 'Tab payments received in cash', value: money(tabPayments) },
    { label: 'Cash in', value: money(report.cashInMillimes) },
    { label: 'Cash out', value: money(report.cashOutMillimes) },
    ...(voidAdjustmentTotal === 0 ? [] : [{ label: 'Post-close void adjustments', value: money(voidAdjustmentTotal) }]),
    {
      label: 'EXPECTED CASH',
      value: expectedCashForDrawer === undefined ? 'Not recorded' : money(expectedCashForDrawer),
      emphasized: true,
      size: 'double',
    },
    ...(report.type === 'Z' ? [
      {
        label: report.countedCashIncludesFloat ? 'COUNTED CASH' : 'COUNTED CASH (EXCLUDING FLOAT)',
        value: countedCashForDrawer === undefined ? 'Not recorded' : money(countedCashForDrawer),
        emphasized: true,
        size: 'double' as const,
      },
      {
        label: cashDifference === undefined
          ? 'DIFFERENCE NOT RECORDED'
          : cashDifference < 0
            ? `SHORT ${money(Math.abs(cashDifference))}`
            : cashDifference > 0
              ? `OVER ${money(cashDifference)}`
              : 'BALANCED',
        value: '',
        emphasized: true,
        size: 'double' as const,
      },
      ...(report.cashDifferenceNote ? [{ label: 'Note', value: report.cashDifferenceNote }] : []),
      { label: 'Counted card', value: money(report.countedCardMillimes) },
      { label: 'Expected card (sales + tab payments)', value: money(report.expectedCardMillimes) },
      {
        label: 'Card difference',
        value: report.cardDifferenceMillimes === undefined
          ? 'Not recorded'
          : report.cardDifferenceMillimes < 0
            ? `SHORT ${money(Math.abs(report.cardDifferenceMillimes))}`
            : report.cardDifferenceMillimes > 0
              ? `OVER ${money(report.cardDifferenceMillimes)}`
              : 'BALANCED',
        emphasized: true,
      },
      ...(report.countedOtherMillimes === undefined ? [] : [
        { label: 'Counted other', value: money(report.countedOtherMillimes) },
        { label: 'Expected other (sales + tab payments)', value: money(report.expectedOtherMillimes) },
        {
          label: 'Other difference',
          value: report.otherDifferenceMillimes === undefined
            ? 'Not recorded'
            : report.otherDifferenceMillimes < 0
              ? `SHORT ${money(Math.abs(report.otherDifferenceMillimes))}`
              : report.otherDifferenceMillimes > 0
                ? `OVER ${money(report.otherDifferenceMillimes)}`
                : 'BALANCED',
          emphasized: true,
        },
      ]),
      ...(report.nonCashDifferenceNote ? [{ label: 'Card / other difference note', value: report.nonCashDifferenceNote }] : []),
    ] : [
      { label: 'Not counted - X report is interim', value: '' },
    ]),
  ];
  appendSection(sections, report.countedCashIncludesFloat ? 'FLOAT (INCLUDED IN DRAWER COUNT)' : 'FLOAT (NOT COUNTED)', [
    ...reportShifts.map((shift) => ({
      label: `${shift.staffName} · ${localDateTime(shift.openedAt)}`,
      value: money(shift.startingCashMillimes),
    })),
    { label: 'Total float', value: money(cashFloat), emphasized: true },
  ]);
  appendSection(sections, 'CASH FLOW BY SHIFT', reportShifts.map((shift) => {
    const flow = shift.cashFlowExFloatMillimes ??
      (shift.expectedCashMillimes === undefined ? undefined : shift.expectedCashMillimes - shift.startingCashMillimes);
    return {
      label: `${shift.staffName} · ${localDateTime(shift.openedAt)}`,
      value: flow === undefined ? 'Not recorded' : money(flow),
    };
  }));
  if (report.type === 'Z') {
    const forcedShifts = reportShifts.filter((shift) => shift.forceClosedByOwner);
    appendSection(sections, 'SHIFT DIFFERENCES', [
      { label: 'Total shift differences', value: money(report.totalDifferenceMillimes), emphasized: true },
      ...reportShifts.map((shift) => ({
        label: `${shift.staffName} · ${shift.forceClosedByOwner ? 'UNVERIFIED · force-closed' : 'shift count'}`,
        value: shift.differenceMillimes === undefined
          ? 'Not recorded'
          : shift.differenceMillimes < 0
            ? `SHORT ${money(Math.abs(shift.differenceMillimes))}`
            : shift.differenceMillimes > 0
              ? `OVER ${money(shift.differenceMillimes)}`
              : 'BALANCED',
      })),
      ...forcedShifts.map((shift) => ({
        label: `${shift.staffName} · force-closed auto-approved voids`,
        value: String(shift.voidsAutoApprovedCount ?? 0),
      })),
    ]);
  }
  appendSection(sections, report.countedCashIncludesFloat
    ? 'CASH TO HAVE IN DRAWER (INCLUDING FLOAT)'
    : 'CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)', finalCashLines);

  const lines: ReceiptLine[] = [
    { text: storeName, align: 'center', bold: true, size: 'double' },
    ...(resolved.showAddress && (report.frozenStoreAddress ?? store.address)
      ? [{ text: report.frozenStoreAddress ?? store.address ?? '', align: 'center' as const }]
      : []),
    ...(resolved.showPhone && (report.frozenStorePhone ?? store.phone)
      ? [{ text: report.frozenStorePhone ?? store.phone ?? '', align: 'center' as const }]
      : []),
    ...(report.frozenStoreTaxId ?? store.taxId ? [{ text: `Tax ID: ${report.frozenStoreTaxId ?? store.taxId}`, align: 'center' as const }] : []),
    { text: divider(width), kind: 'divider' },
    { text: report.type === 'Z' ? 'Z REPORT' : 'X REPORT', align: 'center', bold: true, size: 'double' },
    { text: report.type === 'Z' ? 'OFFICIAL DAY CLOSE' : 'INTERIM - DAY REMAINS OPEN', align: 'center', bold: true },
    { text: formatReceiptRow('Report no.', report.reportNumber ?? `${report.type}-${report.id.slice(-6).toUpperCase()}`, width) },
    { text: formatReceiptRow('Business date', report.businessDate, width) },
    { text: formatReceiptRow('Opened', localDateTime(report.dayOpenedAt ?? report.periodFrom), width) },
    { text: formatReceiptRow(report.type === 'Z' ? 'Closed' : 'Printed', localDateTime(report.dayClosedAt ?? report.periodTo ?? report.createdAt), width) },
    { text: formatReceiptRow('Generated by', report.generatedBy ?? 'Owner', width) },
    ...(report.type === 'Z' && report.pinVerified !== undefined
      ? [{ text: formatReceiptRow('Owner PIN verified', report.pinVerified ? 'Yes' : 'No', width) }]
      : []),
    ...(report.firstTicketNumber === undefined ? [] : [
      { text: formatReceiptRow('First sale ticket', String(report.firstTicketNumber), width) },
    ]),
    ...(report.lastTicketNumber === undefined ? [] : [
      { text: formatReceiptRow('Last sale ticket', String(report.lastTicketNumber), width) },
    ]),
    { text: divider(width), kind: 'divider' },
    ...sections.flatMap((section) => [
      { text: section.title, bold: true, kind: 'section' as const },
      ...section.lines.map((line) => ({
        text: line.value ? formatReceiptRow(line.label, line.value, width) : line.label,
        bold: line.emphasized,
        size: line.size,
      })),
      { text: divider(width), kind: 'divider' as const },
    ]),
    { text: formatReceiptRow('Report generated', localDateTime(report.createdAt), width) },
    ...(report.frozenReportFooterText ?? resolved.reportFooterText)
      .map((text) => ({ text, align: 'center' as const, kind: 'footer' as const })),
  ];
  return {
    title: report.type === 'Z' ? 'Z REPORT' : 'X REPORT',
    subtitle: report.type === 'Z' ? 'Official day close' : 'The business day remains open',
    width,
    logoSrc: resolved.showLogo ? getLogoSrc(resolved.storeLogoId) : undefined,
    lines,
    sections,
  };
}
