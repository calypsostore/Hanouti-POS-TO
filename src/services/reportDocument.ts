import { formatTnd } from '../lib/format';
import type { ReportRecord, StoreRecord, StoreSettings } from '../types/domain';
import { resolveStoreSettings } from '../types/domain';
import { getLogoSrc } from '../data/logoCatalog';
import { formatTicketDateTime, formatTicketPaymentMethod, ticketT } from '../i18n/tickets';

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
const localDateTime = (value: string | undefined) => value ? formatTicketDateTime(value) : ticketT('Not recorded');
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
  appendSection(sections, ticketT('SALES'), [
    { label: ticketT('Transactions'), value: String(report.orderCount) },
    { label: ticketT('Gross sales'), value: money(report.grossMillimes ?? report.salesMillimes) },
    ...(report.discountsMillimes !== undefined && report.discountsMillimes !== 0
      ? [{ label: ticketT('Discounts'), value: money(report.discountsMillimes) }]
      : []),
    { label: ticketT('Net sales'), value: money(report.netMillimes ?? report.salesMillimes), emphasized: true },
    ...(report.salesCollectedMillimes === undefined ? [] : [{ label: ticketT('Sales collected'), value: money(report.salesCollectedMillimes) }]),
    ...(cashSales === undefined ? [] : [{ label: ticketT('Cash'), value: money(cashSales) }]),
    ...(paymentSplit ? [
      { label: ticketT('Card'), value: money(paymentSplit.card), emphasized: true },
      { label: ticketT('Other'), value: money(paymentSplit.other) },
    ] : []),
    ...(tabSales === undefined ? [] : [{ label: ticketT('Tab sales'), value: money(tabSales) }]),
  ]);
  if (report.fiscalSummary) {
    const fiscal = report.fiscalSummary;
    appendSection(sections, ticketT('FISCAL SNAPSHOTS (HISTORICAL DATA ONLY)'), [
      { label: ticketT('Completed orders with snapshots'), value: `${fiscal.ordersWithFiscalSnapshot} / ${fiscal.completedOrderCount}` },
      ...(fiscal.ordersMissingFiscalSnapshot === 0 ? [] : [{
        label: ticketT('Completed orders missing fiscal snapshots'),
        value: String(fiscal.ordersMissingFiscalSnapshot),
        emphasized: true,
      }]),
      { label: ticketT('Snapshot net amount (HT)'), value: money(fiscal.netAmountMillimes) },
      { label: ticketT('Snapshot tax amount'), value: money(fiscal.taxAmountMillimes) },
      { label: ticketT('Snapshot gross amount (TTC)'), value: money(fiscal.grossAmountMillimes), emphasized: true },
      ...fiscal.taxes.flatMap((tax) => [
        {
          label: `${ticketT(tax.taxType)} · ${ticketT(tax.treatment)}${tax.ruleId ? ` · ${tax.ruleId} v${tax.ruleVersion}` : ''} ${ticketT('Base')}`,
          value: money(tax.taxableBaseMillimes),
        },
        {
            label: `${ticketT(tax.taxType)} · ${ticketT(tax.treatment)}${tax.ruleId ? ` · ${tax.ruleId} v${tax.ruleVersion}` : ''} ${ticketT('Tax')}`,
            value: money(tax.amountMillimes),
        },
      ]),
      { label: ticketT('Not a tax declaration or compliance certification'), value: '' },
    ]);
    appendSection(sections, ticketT('FISCAL VOID REVERSALS (ORIGINAL SNAPSHOTS)'), [
      { label: ticketT('Voided orders with snapshots'), value: `${fiscal.voidedOrdersWithFiscalSnapshot ?? 0} / ${fiscal.voidedOrderCount ?? 0}` },
      ...((fiscal.voidedOrdersMissingFiscalSnapshot ?? 0) === 0 ? [] : [{
        label: ticketT('Voided orders missing fiscal snapshots'),
        value: String(fiscal.voidedOrdersMissingFiscalSnapshot),
        emphasized: true,
      }]),
      { label: ticketT('Reversed net amount (HT)'), value: money(fiscal.reversedNetAmountMillimes ?? 0) },
      { label: ticketT('Reversed tax amount'), value: money(fiscal.reversedTaxAmountMillimes ?? 0) },
      { label: ticketT('Reversed gross amount (TTC)'), value: money(fiscal.reversedGrossAmountMillimes ?? 0), emphasized: true },
      ...(fiscal.reversedTaxes ?? []).map((tax) => ({
        label: `${ticketT(tax.taxType)} · ${ticketT(tax.treatment)}${tax.ruleId ? ` · ${tax.ruleId} v${tax.ruleVersion}` : ''} ${ticketT('Reversal')}`,
        value: money(tax.amountMillimes),
      })),
    ]);
  }
  if (report.expensesMillimes !== undefined || report.netProfitMillimes !== undefined || report.expenseDetails?.length) {
    appendSection(sections, ticketT('EXPENSES / NET'), [
      ...(report.expensesMillimes === undefined ? [] : [{ label: ticketT('Expenses'), value: money(report.expensesMillimes) }]),
      ...(report.netProfitMillimes === undefined ? [] : [{ label: ticketT('Net after expenses'), value: money(report.netProfitMillimes), emphasized: true }]),
      ...(report.expenseDetails ?? []).map((expense) => ({
        label: `${expense.date} · ${ticketT(expense.category)}${expense.supplierId ? ` · ${ticketT('Supplier {id}', { id: expense.supplierId })}` : ''} · ${expense.createdBy}${expense.note ? ` · ${expense.note}` : ''}`,
        value: `${money(expense.amountMillimes)} ${ticketT('({amount} paid)', { amount: money(expense.paidMillimes) })}`,
      })),
    ]);
  }

  const items = report.itemsSold ?? [];
  const itemGroups = new Map<string, typeof items>();
  for (const item of items) {
    const category = item.categoryName ?? ticketT('Other');
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
      label: ticketT('{category} subtotal', { category }),
      value: money(categoryItems.reduce((sum, item) => sum + item.totalMillimes, 0)),
      emphasized: true,
    });
  }
  appendSection(sections, ticketT('ITEMS SOLD'), itemLines);

  if (report.voids) {
    appendSection(sections, ticketT('VOIDED ORDERS'), [
      { label: ticketT('Voided order count'), value: String(report.voids.count), emphasized: true },
      { label: ticketT('Voided order total'), value: money(report.voids.totalMillimes) },
      ...report.voids.orders.map((item) => ({
        label: item.autoApprovedAtForcedClose
          ? ticketT('#{ticket} auto-approved at forced close', { ticket: item.ticketNumber })
          : ticketT('#{ticket} {reason} · {approver}', {
            ticket: item.ticketNumber,
            reason: item.reason || ticketT('Reason not recorded'),
            approver: item.approvedBy ?? ticketT('Unknown'),
          }),
        value: money(item.totalMillimes),
      })),
    ]);
  }

  if (report.type === 'X' || report.type === 'Z') {
    appendSection(sections, ticketT('PENDING VOIDS (TREATED AS VOIDED FOR SALES AND CASH UNTIL REJECTED)'), [
      { label: ticketT('Pending void count'), value: report.pendingVoids ? String(report.pendingVoids.count) : ticketT('Not recorded'), emphasized: true },
      { label: ticketT('Pending void total'), value: report.pendingVoids ? money(report.pendingVoids.totalMillimes) : ticketT('Not recorded') },
      { label: ticketT('Stock handling'), value: ticketT('Stock is held until approval.') },
      ...(report.pendingVoids?.orders ?? []).map((item) => ({
        label: ticketT('#{ticket} · {staff} · {reason}', { ticket: item.ticketNumber, staff: item.staffName, reason: item.reason || ticketT('Reason not recorded') }),
        value: money(item.amountMillimes),
      })),
    ]);
  }

  if ((tabPayments !== undefined && tabPayments !== 0) || (nonCashTabPayments !== undefined && nonCashTabPayments !== 0)) {
    appendSection(sections, ticketT('TAB PAYMENTS'), [
      ...(tabPayments === undefined ? [] : [{ label: ticketT('Payments received in cash'), value: money(tabPayments) }]),
      ...(nonCashTabPayments === undefined ? [] : [{ label: ticketT('Payments received by card / other (not cash)'), value: money(nonCashTabPayments) }]),
    ]);
  }
  if (customerTabDetails.length) {
    appendSection(sections, ticketT('CUSTOMER TABS'), [
      { label: ticketT('Issued / settled / outstanding'), value: `${money(report.tabsIssuedMillimes ?? customerTabDetails.reduce((sum, item) => sum + item.issuedMillimes, 0))} / ${money(allTabPayments ?? customerTabDetails.reduce((sum, item) => sum + item.paymentsMillimes, 0))} / ${money(report.tabsOutstandingMillimes ?? report.receivableMillimes ?? customerTabDetails.reduce((sum, item) => sum + item.outstandingMillimes, 0))}`, emphasized: true },
      ...customerTabDetails.flatMap((customer) => [
        { label: customer.customerName, value: '' },
        { label: ticketT('Issued / paid'), value: `${money(customer.issuedMillimes)} / ${money(customer.paymentsMillimes)}` },
        { label: ticketT('Outstanding'), value: money(customer.outstandingMillimes), emphasized: true },
      ]),
    ]);
  } else if (
    report.tabsIssuedMillimes !== undefined ||
    allTabPayments !== undefined ||
    report.tabsOutstandingMillimes !== undefined ||
    report.receivableMillimes !== undefined
  ) {
    appendSection(sections, ticketT('CUSTOMER TABS'), [
      {
        label: ticketT('Issued / paid / outstanding'),
        value: `${money(report.tabsIssuedMillimes)} / ${money(allTabPayments)} / ${money(report.tabsOutstandingMillimes ?? report.receivableMillimes)}`,
        emphasized: true,
      },
    ]);
  }

  if (report.unresolvedTabReversals?.length) {
    appendSection(sections, ticketT('UNRESOLVED TAB REVERSALS — NOT INCLUDED IN VERIFIED TOTALS'), report.unresolvedTabReversals.map((reversal) => ({
      label: `${formatTicketPaymentMethod(reversal.paymentMethod)} · ${ticketT('Reversal {id}', { id: reversal.reversalId })} · ${ticketT('Settlement {id}', { id: reversal.originalSettlementId })} · ${ticketT('Shift {id}', { id: reversal.reversalShiftId })} · ${formatTicketDateTime(reversal.reversalCreatedAt)}`,
      value: ticketT('UNRESOLVED {amount}', { amount: `${money(reversal.amountMillimes)}${reversal.reason ? ` · ${reversal.reason}` : ''}` }),
    })));
  }

  if (report.voidAdjustments?.length) {
    appendSection(sections, ticketT('POST-CLOSE VOID ADJUSTMENTS'), report.voidAdjustments.map((adjustment) => ({
      label: ticketT('Ticket #{number} · {staff} · {date}', { number: adjustment.orderNumber, staff: adjustment.staffName, date: formatTicketDateTime(adjustment.createdAt) }),
      value: `${adjustment.amountMillimes > 0 ? '+' : adjustment.amountMillimes < 0 ? '-' : ''}${money(Math.abs(adjustment.amountMillimes))}`,
    })));
  }

  const cashMovements: ReportSection['lines'] = [];
  if (drawerCashSales !== undefined) cashMovements.push({ label: ticketT('Cash sales'), value: `+${money(drawerCashSales)}` });
  if (tabPayments !== undefined) cashMovements.push({ label: ticketT('Tab payments received'), value: `+${money(tabPayments)}` });
  if (report.cashInMillimes !== undefined) cashMovements.push({ label: ticketT('Cash in'), value: `+${money(report.cashInMillimes)}` });
  if (report.cashOutMillimes !== undefined) cashMovements.push({ label: ticketT('Cash out'), value: `-${money(report.cashOutMillimes)}` });
  if (report.cashRefundsMillimes !== undefined) cashMovements.push({ label: ticketT('Cash refunds'), value: `-${money(report.cashRefundsMillimes)}` });
  const voidAdjustmentTotal = (report.voidAdjustments ?? []).reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
  if (voidAdjustmentTotal !== 0) {
    cashMovements.push({
      label: ticketT('Post-close void adjustments'),
      value: `${voidAdjustmentTotal > 0 ? '+' : '-'}${money(Math.abs(voidAdjustmentTotal))}`,
    });
  }
  const detailedMovements = report.cashMovements?.length ? report.cashMovements : (report.cashOuts ?? []).map((movement) => ({
    ...movement,
    kind: 'out' as const,
  }));
  for (const movement of detailedMovements) {
    cashMovements.push({
      label: `${ticketT(movement.kind === 'in' ? 'Cash in' : 'Cash out')} · ${ticketT(movement.reason)} · ${movement.staffName} · ${localDateTime(movement.createdAt)} · ${ticketT('Shift {id}', { id: movement.shiftId })}`,
      value: money(movement.amountMillimes),
    });
    const lastLine = cashMovements[cashMovements.length - 1];
    if (movement.note) lastLine.label += ` · ${movement.note}`;
  }
  appendSection(sections, ticketT('CASH MOVEMENTS'), cashMovements);

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
      name: order.staffName ?? ticketT('Staff'),
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
      label: `${employee.name} · ${orderCount === undefined ? ticketT('Order count unavailable') : ticketT('{count} orders', { count: orderCount })}`,
      value: salesMillimes === undefined ? ticketT('Sales not recorded') : money(salesMillimes),
      emphasized: true,
    });
    if (employee.voidedOrderCount > 0) {
      employeeLines.push({
        label: ticketT('Voided orders / total'),
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
        label: ticketT('Cash / card / other / tab sales'),
        value: paymentFields.map((value) => value === undefined ? ticketT('Not recorded') : money(value)).join(' / '),
      });
    }
    employeeLines.push({
      label: ticketT('Shift count / starting cash'),
      value: `${shifts.length} / ${money(sumShiftValue((shift) => shift.startingCashMillimes))}`,
    });
    const expected = sumShiftValue((shift) => shift.expectedCashMillimes);
    const counted = sumShiftValue((shift) => shift.countedCashMillimes);
    employeeLines.push({
      label: ticketT('Expected / counted cash'),
      value: `${expected === undefined ? ticketT('Not recorded') : money(expected)} / ${counted === undefined ? ticketT('Not recorded') : money(counted)}`,
    });
    const cashIn = sumShiftValue((shift) => shift.cashInMillimes);
    const cashOut = sumShiftValue((shift) => shift.cashOutMillimes);
    if (cashIn !== undefined || cashOut !== undefined) {
      employeeLines.push({
        label: ticketT('Cash in / out'),
        value: `${cashIn === undefined ? ticketT('Not recorded') : money(cashIn)} / ${cashOut === undefined ? ticketT('Not recorded') : money(cashOut)}`,
      });
    }
    const shiftIds = new Set(shifts.map((shift) => shift.shiftId));
    const postCloseVoids = (report.voidAdjustments ?? []).filter((item) => shiftIds.has(item.shiftId));
    if (postCloseVoids.length) {
      const count = (kind: NonNullable<ReportRecord['voidAdjustments']>[number]['kind']) =>
        postCloseVoids.filter((item) => item.kind === kind).length;
      employeeLines.push({
        label: ticketT('Post-close cash adjustment records (request / approval / rejection)'),
        value: `${count('requested')} / ${count('approved')} / ${count('rejected')}`,
      });
    }
  }
  appendSection(sections, ticketT('BY EMPLOYEE'), employeeLines);

  if (reportShifts.length) {
    appendSection(sections, ticketT('BY SHIFT / PERSON'), reportShifts.flatMap((shift) => {
      const lines: ReportSection['lines'] = [
        {
          label: `${shift.staffName} · ${shift.orderCount === undefined ? ticketT('Order count unavailable') : ticketT('{count} orders', { count: shift.orderCount })} · ${shift.status === 'in_progress' ? ticketT('Open') : shift.status === 'closed' ? ticketT('Closed') : ticketT('Status unavailable')}`,
          value: '',
        },
        { label: ticketT('Shift ID'), value: shift.shiftId },
        { label: ticketT('Opened'), value: localDateTime(shift.openedAt) },
        ...(shift.closedAt ? [{ label: ticketT('Closed'), value: localDateTime(shift.closedAt) }] : []),
        { label: ticketT('Starting cash'), value: money(shift.startingCashMillimes) },
        { label: ticketT('Closed by force'), value: shift.forceClosedByOwner ? `${ticketT('Yes')} · ${ticketT('UNVERIFIED · force-closed')}` : ticketT('No') },
        ...(shift.voidsAutoApprovedCount
          ? [{ label: ticketT('Voids auto-approved at forced close'), value: String(shift.voidsAutoApprovedCount) }]
          : []),
      ];
      if (shift.cashSalesMillimes !== undefined) lines.push({ label: ticketT('Cash sales'), value: money(shift.cashSalesMillimes) });
      if (shift.cardSalesMillimes !== undefined) lines.push({ label: ticketT('Card sales'), value: money(shift.cardSalesMillimes), emphasized: true });
      if (shift.otherSalesMillimes !== undefined) lines.push({ label: ticketT('Other sales'), value: money(shift.otherSalesMillimes) });
      if (shift.tabSalesMillimes !== undefined) lines.push({ label: ticketT('Tab sales'), value: money(shift.tabSalesMillimes) });
      if (shift.tabPaymentsMillimes !== undefined) lines.push({ label: ticketT('Tab payments'), value: money(shift.tabPaymentsMillimes) });
      if (shift.expectedCashMillimes !== undefined || shift.countedCashMillimes !== undefined) {
        lines.push({
          label: ticketT('Expected / counted cash'),
          value: `${shift.expectedCashMillimes === undefined ? ticketT('Not recorded') : money(shift.expectedCashMillimes)} / ${shift.countedCashMillimes === undefined ? ticketT('Not recorded') : money(shift.countedCashMillimes)}`,
        });
      }
      if (shift.voidAdjustmentMillimes !== undefined) {
        lines.push({ label: ticketT('Post-close void adjustments'), value: money(shift.voidAdjustmentMillimes) });
      }
      if (shift.voidRequestsMillimes !== undefined) {
        lines.push({ label: ticketT('Void requests'), value: `${shift.voidRequestsMillimes < 0 ? '-' : '+'}${money(Math.abs(shift.voidRequestsMillimes))}` });
      }
      if (shift.voidRejectionsMillimes !== undefined) {
        lines.push({ label: ticketT('Void rejections'), value: `${shift.voidRejectionsMillimes < 0 ? '-' : '+'}${money(Math.abs(shift.voidRejectionsMillimes))}` });
      }
      if (report.type === 'Z' && shift.differenceMillimes !== undefined) {
        const difference = shift.differenceMillimes;
        lines.push({
          label: ticketT('Cash difference'),
          value: difference < 0
            ? ticketT('SHORT {amount}', { amount: money(Math.abs(difference)) })
            : difference > 0
              ? ticketT('OVER {amount}', { amount: money(difference) })
              : ticketT('BALANCED'),
          emphasized: true,
        });
      }
      if (shift.cashInMillimes !== undefined || shift.cashOutMillimes !== undefined) {
        lines.push({
          label: ticketT('Cash in / out'),
          value: `${shift.cashInMillimes === undefined ? '—' : money(shift.cashInMillimes)} / ${shift.cashOutMillimes === undefined ? '—' : money(shift.cashOutMillimes)}`,
        });
      }
      return lines;
    }));
  }

  appendSection(sections, ticketT('BY CATEGORY'), (report.salesByCategory ?? []).map((category) => ({
    label: `${category.quantity} x ${category.name}`,
    value: money(category.totalMillimes),
  })));

  if (report.comps) {
    appendSection(sections, ticketT('STAFF ITEMS / COMPS'), [
      { label: ticketT('Comp count / quantity'), value: `${report.comps.count} / ${report.comps.quantity}`, emphasized: true },
      { label: ticketT('Comp value'), value: money(report.comps.totalMillimes) },
      ...report.comps.records.map((item) => ({
        label: `${item.quantity} x ${item.itemName} · ${item.staffName} · ${ticketT(item.reason)}${item.createdAt ? ` · ${localDateTime(item.createdAt)}` : ''}${item.note ? ` · ${item.note}` : ''}`,
        value: money(item.valueMillimes),
      })),
    ]);
  }

  const finalCashLines: ReportSection['lines'] = [
    { label: ticketT('Cash sales'), value: money(report.cashSalesMillimes ?? paymentSplit?.cash) },
    { label: ticketT('Tab payments received in cash'), value: money(tabPayments) },
    { label: ticketT('Cash in'), value: money(report.cashInMillimes) },
    { label: ticketT('Cash out'), value: money(report.cashOutMillimes) },
    ...(voidAdjustmentTotal === 0 ? [] : [{ label: ticketT('Post-close void adjustments'), value: money(voidAdjustmentTotal) }]),
    {
      label: ticketT('EXPECTED CASH'),
      value: expectedCashForDrawer === undefined ? ticketT('Not recorded') : money(expectedCashForDrawer),
      emphasized: true,
      size: 'double',
    },
    ...(report.type === 'Z' ? [
      {
        label: ticketT(report.countedCashIncludesFloat ? 'COUNTED CASH' : 'COUNTED CASH (EXCLUDING FLOAT)'),
        value: countedCashForDrawer === undefined ? ticketT('Not recorded') : money(countedCashForDrawer),
        emphasized: true,
        size: 'double' as const,
      },
      {
        label: cashDifference === undefined
          ? ticketT('DIFFERENCE NOT RECORDED')
          : cashDifference < 0
            ? ticketT('SHORT {amount}', { amount: money(Math.abs(cashDifference)) })
            : cashDifference > 0
              ? ticketT('OVER {amount}', { amount: money(cashDifference) })
              : ticketT('BALANCED'),
        value: '',
        emphasized: true,
        size: 'double' as const,
      },
      ...(report.cashDifferenceNote ? [{ label: ticketT('Note'), value: report.cashDifferenceNote }] : []),
      { label: ticketT('Counted card'), value: money(report.countedCardMillimes) },
      { label: ticketT('Expected card (sales + tab payments)'), value: money(report.expectedCardMillimes) },
      {
        label: ticketT('Card difference'),
        value: report.cardDifferenceMillimes === undefined
          ? ticketT('Not recorded')
          : report.cardDifferenceMillimes < 0
            ? ticketT('SHORT {amount}', { amount: money(Math.abs(report.cardDifferenceMillimes)) })
            : report.cardDifferenceMillimes > 0
              ? ticketT('OVER {amount}', { amount: money(report.cardDifferenceMillimes) })
              : ticketT('BALANCED'),
        emphasized: true,
      },
      ...(report.countedOtherMillimes === undefined ? [] : [
        { label: ticketT('Counted other'), value: money(report.countedOtherMillimes) },
        { label: ticketT('Expected other (sales + tab payments)'), value: money(report.expectedOtherMillimes) },
        {
          label: ticketT('Other difference'),
          value: report.otherDifferenceMillimes === undefined
            ? ticketT('Not recorded')
            : report.otherDifferenceMillimes < 0
              ? ticketT('SHORT {amount}', { amount: money(Math.abs(report.otherDifferenceMillimes)) })
              : report.otherDifferenceMillimes > 0
                ? ticketT('OVER {amount}', { amount: money(report.otherDifferenceMillimes) })
                : ticketT('BALANCED'),
          emphasized: true,
        },
      ]),
      ...(report.nonCashDifferenceNote ? [{ label: ticketT('Card / other difference note'), value: report.nonCashDifferenceNote }] : []),
    ] : [
      { label: ticketT('Not counted - X report is interim'), value: '' },
    ]),
  ];
  appendSection(sections, ticketT(report.countedCashIncludesFloat ? 'FLOAT (INCLUDED IN DRAWER COUNT)' : 'FLOAT (NOT COUNTED)'), [
    ...reportShifts.map((shift) => ({
      label: `${shift.staffName} · ${localDateTime(shift.openedAt)}`,
      value: money(shift.startingCashMillimes),
    })),
    { label: ticketT('Total float'), value: money(cashFloat), emphasized: true },
  ]);
  appendSection(sections, ticketT('CASH FLOW BY SHIFT'), reportShifts.map((shift) => {
    const flow = shift.cashFlowExFloatMillimes ??
      (shift.expectedCashMillimes === undefined ? undefined : shift.expectedCashMillimes - shift.startingCashMillimes);
    return {
      label: `${shift.staffName} · ${localDateTime(shift.openedAt)}`,
      value: flow === undefined ? ticketT('Not recorded') : money(flow),
    };
  }));
  if (report.type === 'Z') {
    const forcedShifts = reportShifts.filter((shift) => shift.forceClosedByOwner);
    appendSection(sections, ticketT('SHIFT DIFFERENCES'), [
      { label: ticketT('Total shift differences'), value: money(report.totalDifferenceMillimes), emphasized: true },
      ...reportShifts.map((shift) => ({
        label: `${shift.staffName} · ${shift.forceClosedByOwner ? ticketT('UNVERIFIED · force-closed') : ticketT('shift count')}`,
        value: shift.differenceMillimes === undefined
          ? ticketT('Not recorded')
          : shift.differenceMillimes < 0
            ? ticketT('SHORT {amount}', { amount: money(Math.abs(shift.differenceMillimes)) })
            : shift.differenceMillimes > 0
              ? ticketT('OVER {amount}', { amount: money(shift.differenceMillimes) })
              : ticketT('BALANCED'),
      })),
      ...forcedShifts.map((shift) => ({
        label: `${shift.staffName} · ${ticketT('force-closed auto-approved voids')}`,
        value: String(shift.voidsAutoApprovedCount ?? 0),
      })),
    ]);
  }
  appendSection(sections, ticketT(report.countedCashIncludesFloat
    ? 'CASH TO HAVE IN DRAWER (INCLUDING FLOAT)'
    : 'CASH TO HAVE IN DRAWER (EXCLUDING FLOAT)'), finalCashLines);

  const lines: ReceiptLine[] = [
    { text: storeName, align: 'center', bold: true, size: 'double' },
    ...(resolved.showAddress && (report.frozenStoreAddress ?? store.address)
      ? [{ text: report.frozenStoreAddress ?? store.address ?? '', align: 'center' as const }]
      : []),
    ...(resolved.showPhone && (report.frozenStorePhone ?? store.phone)
      ? [{ text: report.frozenStorePhone ?? store.phone ?? '', align: 'center' as const }]
      : []),
    ...(report.frozenStoreTaxId ?? store.taxId ? [{ text: `${ticketT('Tax ID')}: ${report.frozenStoreTaxId ?? store.taxId}`, align: 'center' as const }] : []),
    { text: divider(width), kind: 'divider' },
    { text: ticketT(report.type === 'Z' ? 'Z REPORT' : 'X REPORT'), align: 'center', bold: true, size: 'double' },
    { text: ticketT(report.type === 'Z' ? 'OFFICIAL DAY CLOSE' : 'INTERIM - DAY REMAINS OPEN'), align: 'center', bold: true },
    { text: formatReceiptRow(ticketT('Report no.'), report.reportNumber ?? `${report.type}-${report.id.slice(-6).toUpperCase()}`, width) },
    { text: formatReceiptRow(ticketT('Business date'), report.businessDate, width) },
    { text: formatReceiptRow(ticketT('Opened'), localDateTime(report.dayOpenedAt ?? report.periodFrom), width) },
    { text: formatReceiptRow(ticketT(report.type === 'Z' ? 'Closed' : 'Printed'), localDateTime(report.dayClosedAt ?? report.periodTo ?? report.createdAt), width) },
    { text: formatReceiptRow(ticketT('Generated by'), report.generatedBy ?? ticketT('Owner'), width) },
    ...(report.type === 'Z' && report.pinVerified !== undefined
      ? [{ text: formatReceiptRow(ticketT('Owner PIN verified'), ticketT(report.pinVerified ? 'Yes' : 'No'), width) }]
      : []),
    ...(report.firstTicketNumber === undefined ? [] : [
      { text: formatReceiptRow(ticketT('First sale ticket'), String(report.firstTicketNumber), width) },
    ]),
    ...(report.lastTicketNumber === undefined ? [] : [
      { text: formatReceiptRow(ticketT('Last sale ticket'), String(report.lastTicketNumber), width) },
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
    { text: formatReceiptRow(ticketT('Report generated'), localDateTime(report.createdAt), width) },
    ...(report.frozenReportFooterText ?? resolved.reportFooterText)
      .map((text) => ({ text, align: 'center' as const, kind: 'footer' as const })),
  ];
  return {
    title: ticketT(report.type === 'Z' ? 'Z REPORT' : 'X REPORT'),
    subtitle: ticketT(report.type === 'Z' ? 'Official day close' : 'The business day remains open'),
    width,
    logoSrc: resolved.showLogo ? getLogoSrc(resolved.storeLogoId) : undefined,
    lines,
    sections,
  };
}
