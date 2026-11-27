import type { OrderSummaryRecord, ReportRecord } from '../../types/domain';
import { resolveStoreSettings } from '../../types/domain';
import type { ReportDayStatus } from './types';
import { userService } from '../userService';
import { shiftService } from '../shiftService';
import { orderService } from '../orderService';
import { notificationService } from '../notificationService';
import { writeData } from '../storage';
import { activityService } from '../activityService';
import { isSupabaseDriver } from '../../data/driver';
import { listReports as listRemoteReports, saveReport as saveRemoteReport } from '../../data/repositories/reportRepository';
import { getPreviouslyReportedZShiftIds } from '../reportPeriod';
import { getReports, datePartsInTimezone, todayKey, sinceLastZ, expensesIncludedInZReports } from './reportHelpers';
import { summarize } from './reportSummaryRemote';
import { aggregateFiscalOrders } from '../fiscal/fiscalReporting';
import type { OrderListOptions } from '../../data/repositories/orderRepository';

async function summarizeFiscalSnapshots(storeId: string, from: string, to: string) {
  const loadPages = async (
    options: Partial<Pick<OrderListOptions, 'status' | 'createdAfter' | 'createdBefore' | 'voidedAfter' | 'voidedBefore'>>,
  ) => {
    const orders: OrderSummaryRecord[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await orderService.listOrderSummaries(storeId, {
        ...options,
        limit: pageSize,
        range: { from: offset, to: offset + pageSize - 1 },
      });
      orders.push(...page);
      if (page.length < pageSize) break;
    }
    return orders;
  };
  const [completedOrders, voidedOrders] = await Promise.all([
    loadPages({ status: 'done', createdAfter: from, createdBefore: to }),
    loadPages({ status: 'voided', voidedAfter: from, voidedBefore: to }),
  ]);
  return aggregateFiscalOrders([...completedOrders, ...voidedOrders]);
}

export async function createReport(
  storeId: string,
  type: 'X' | 'Z',
  generatedBy: string,
  getDayStatus: (storeId: string) => Promise<ReportDayStatus>,
  ownerPin?: string,
  closeDetails?: {
    countedCashMillimes: number;
    countedCardMillimes?: number;
    countedOtherMillimes?: number;
    note?: string;
  },
): Promise<ReportRecord> {
  const dayStatus = await getDayStatus(storeId);
  if (dayStatus.dayIsClosed || !dayStatus.hasActivity) {
    throw new Error('The business day is closed. Open a new shift before creating another report.');
  }
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const createdAt = new Date().toISOString();
  const reports = isSupabaseDriver() ? await listRemoteReports(storeId) : getReports();
  const storeTimeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shifts = await shiftService.listShifts(storeId);
  const periodFrom = isSupabaseDriver()
    ? dayStatus.periodFrom
    : sinceLastZ(storeId, reports, storeTimeZone, shifts, Date.parse(createdAt));
  if (!periodFrom) {
    throw new Error('The server could not determine the first unreported shift in this Z period.');
  }
  const summary = await summarize(
    storeId,
    new Date(periodFrom).getTime(),
    new Date(createdAt).getTime(),
    expensesIncludedInZReports(storeId, reports),
    true,
    isSupabaseDriver() ? periodFrom : undefined,
    !isSupabaseDriver() && type === 'Z' ? getPreviouslyReportedZShiftIds(storeId, reports) : undefined,
  );
  const fiscalSummary = await summarizeFiscalSnapshots(storeId, periodFrom, createdAt);
  if (type === 'Z' && summary.pendingVoids.count > 0) {
    throw new Error('Resolve every void request before creating a Z report.');
  }
  if (type === 'Z' && (summary.unresolvedTabReversals?.length ?? 0) > 0) {
    throw new Error('Resolve every ambiguous tab reversal before creating a Z report.');
  }
  if (type === 'Z' && dayStatus.openShiftCount > 0) {
    throw new Error('Force-close or close every shift before creating a Z report.');
  }
  if (type === 'Z' && !closeDetails) throw new Error('Counted cash excluding opening floats is required to close the business day.');
  const cashDifference = closeDetails
    ? closeDetails.countedCashMillimes - summary.expectedCashExFloatMillimes
    : undefined;
  const expectedCardMillimes = summary.paymentSplit.card + summary.cardTabPaymentsMillimes;
  const expectedOtherMillimes = summary.paymentSplit.other + summary.otherTabPaymentsMillimes;
  const cardDifferenceMillimes = closeDetails
    ? (closeDetails.countedCardMillimes ?? 0) - expectedCardMillimes
    : undefined;
  const otherDifferenceMillimes = closeDetails
    ? (closeDetails.countedOtherMillimes ?? 0) - expectedOtherMillimes
    : undefined;
  if (closeDetails && (!Number.isSafeInteger(closeDetails.countedCashMillimes) || closeDetails.countedCashMillimes < 0)) {
    throw new Error('Counted cash must be a non-negative whole number of millimes.');
  }
  if (closeDetails && ((closeDetails.countedCardMillimes !== undefined &&
      (!Number.isSafeInteger(closeDetails.countedCardMillimes) || closeDetails.countedCardMillimes < 0)) ||
      (closeDetails.countedOtherMillimes !== undefined &&
      (!Number.isSafeInteger(closeDetails.countedOtherMillimes) || closeDetails.countedOtherMillimes < 0)))) {
    throw new Error('Card and other counts must be non-negative whole numbers of millimes.');
  }
  const differenceNote = closeDetails?.note?.trim() || undefined;
  const storeSettings = resolveStoreSettings(store.settings);
  const firstShiftAt = summary.shifts.map((shift) => shift.openedAt).sort()[0];
  const businessDate = firstShiftAt
    ? `${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).year}-${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).month}-${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).day}`
    : todayKey(storeTimeZone);
  const zNumber = type === 'Z'
    ? Math.max(0, ...reports.filter((report) => report.storeId === storeId && report.type === 'Z').map((report) => report.zNumber ?? 0)) + 1
    : undefined;
  const xNumber = type === 'X'
    ? reports.filter((report) => report.storeId === storeId && report.type === 'X' && report.businessDate === businessDate).length + 1
    : undefined;
  const report: ReportRecord = {
    id: `report-${crypto.randomUUID()}`,
    storeId,
    storeName: store.name,
    frozenStoreName: store.name,
    frozenStoreAddress: store.address,
    frozenStorePhone: store.phone,
    frozenStoreTaxId: store.taxId,
    frozenSettings: {
      reportFooterText: storeSettings.reportFooterText,
      storeLogoId: storeSettings.storeLogoId,
      showLogo: storeSettings.showLogo,
      showAddress: storeSettings.showAddress,
      showPhone: storeSettings.showPhone,
      paperWidth: storeSettings.paperWidth,
    },
    frozenReportFooterText: storeSettings.reportFooterText,
    frozenPaperWidth: storeSettings.paperWidth,
    type,
    businessDate,
    createdAt,
    salesMillimes: summary.salesMillimes,
    salesCollectedMillimes: summary.salesCollectedMillimes,
    expensesMillimes: summary.expensesMillimes,
    netProfitMillimes: summary.netProfitMillimes,
    receivableMillimes: summary.receivableMillimes,
    orderCount: summary.orderCount,
    cashDifferenceMillimes: cashDifference ?? summary.cashDifferenceMillimes,
    fiscalSummary,
    grossMillimes: summary.salesMillimes,
    netMillimes: summary.salesMillimes,
    zNumber,
    reportNumber: zNumber
      ? `Z-${String(zNumber).padStart(6, '0')}`
      : `X-${String(xNumber ?? 1).padStart(6, '0')}`,
    periodFrom,
    periodTo: createdAt,
    dayOpenedAt: summary.shifts.map((shift) => shift.openedAt).sort()[0] ?? periodFrom,
    dayClosedAt: type === 'Z' ? createdAt : undefined,
    firstTicketNumber: summary.firstTicketNumber,
    lastTicketNumber: summary.lastTicketNumber,
    generatedBy,
    salesByCategory: summary.salesByCategory,
    itemsSold: summary.itemsSold,
    voids: summary.voids,
    pendingVoids: summary.pendingVoids,
    voidAdjustments: summary.voidAdjustments,
    comps: summary.comps,
    expenseDetails: summary.expenseDetails,
    shifts: summary.shiftLines,
    paymentSplit: summary.paymentSplit,
    totalExpectedCashMillimes: summary.totalExpectedCashMillimes,
    expectedCashExFloatMillimes: summary.expectedCashExFloatMillimes,
    totalCountedMillimes: summary.totalCountedMillimes,
    totalDifferenceMillimes: summary.totalDifferenceMillimes,
    cashSalesMillimes: summary.cashSalesMillimes,
    tabSalesMillimes: summary.tabSalesMillimes,
    tabPaymentsReceivedMillimes: summary.tabPaymentsReceivedMillimes,
    cashFloatMillimes: summary.cashFloatMillimes,
    cashInMillimes: summary.cashInMillimes,
    cashOutMillimes: summary.cashOutMillimes,
    cashRefundsMillimes: summary.cashRefundsMillimes,
    ambiguousTabReversalIds: summary.ambiguousTabReversalIds,
    unresolvedTabReversals: summary.unresolvedTabReversals,
    cashMovements: summary.cashMovements,
    employeeBreakdown: summary.employeeBreakdown,
    cashOuts: summary.cashOuts,
    customerTabs: summary.customerTabs,
    tabsIssuedMillimes: summary.tabsIssuedMillimes,
    tabsSettledMillimes: summary.tabsSettledMillimes,
    nonCashTabPaymentsMillimes: summary.nonCashTabPaymentsMillimes,
    tabsOutstandingMillimes: summary.tabsOutstandingMillimes,
    countedCashMillimes: closeDetails?.countedCashMillimes,
    countedCashIncludesFloat: false,
    cashDifference,
    cashDifferenceNote: differenceNote,
    countedCardMillimes: closeDetails ? closeDetails.countedCardMillimes ?? 0 : undefined,
    expectedCardMillimes: type === 'Z' ? expectedCardMillimes : undefined,
    cardDifferenceMillimes,
    countedOtherMillimes: closeDetails ? closeDetails.countedOtherMillimes ?? 0 : undefined,
    expectedOtherMillimes: type === 'Z' ? expectedOtherMillimes : undefined,
    otherDifferenceMillimes,
    nonCashDifferenceNote: cardDifferenceMillimes || otherDifferenceMillimes ? differenceNote : undefined,
    pinVerified: type === 'Z',
  };
  const savedReport = isSupabaseDriver()
    ? await saveRemoteReport(report, ownerPin)
    : report;
  if (!isSupabaseDriver()) writeData('reports', [...getReports(), report]);
  await activityService.log({
    storeId,
    action: type === 'X' ? 'report.x' : 'report.z',
    summary: `Generated ${type} report${savedReport.zNumber ? ` #${savedReport.zNumber}` : ''}.`,
    entityType: 'report',
    entityId: savedReport.id,
    meta: {
      after: {
        type: savedReport.type,
        businessDate: savedReport.businessDate,
        salesMillimes: savedReport.salesMillimes,
        salesCollectedMillimes: savedReport.salesCollectedMillimes,
        expensesMillimes: savedReport.expensesMillimes,
        netProfitMillimes: savedReport.netProfitMillimes,
        receivableMillimes: savedReport.receivableMillimes,
        orderCount: savedReport.orderCount,
        cashDifferenceMillimes: savedReport.cashDifferenceMillimes,
        generatedBy: savedReport.generatedBy,
      },
    },
  });
  return savedReport;
}

export async function createXReport(
  storeId: string,
  getDayStatus: (storeId: string) => Promise<ReportDayStatus>,
  generatedBy = 'Owner',
): Promise<ReportRecord> {
    return createReport(storeId, 'X', generatedBy, getDayStatus);
  }

export async function closeDayWithZReport(
    storeId: string,
    getDayStatus: (storeId: string) => Promise<ReportDayStatus>,
    generatedBy = 'Owner',
    ownerPin?: string,
    closeDetails?: {
      countedCashMillimes: number;
      countedCardMillimes?: number;
      countedOtherMillimes?: number;
      note?: string;
    },
  ): Promise<ReportRecord> {
    if (!ownerPin || !/^\d{4}$/.test(ownerPin)) {
      throw new Error('Owner PIN is required for every Z report unless an authorized staff PIN is provided.');
    }
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!isSupabaseDriver()) {
      if ((await orderService.listAll(storeId)).some((order) => order.status === 'pending_void')) {
        throw new Error('Resolve every void request before creating a Z report.');
      }
      if (!await userService.verifyStorePin(storeId, ownerPin, 'z_report')) throw new Error('The PIN is incorrect.');
    }
    const report = await createReport(storeId, 'Z', generatedBy, getDayStatus, ownerPin, closeDetails);
    if (!isSupabaseDriver()) {
      writeData('stores', (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: todayKey() } : candidate));
    }
    await notificationService.notifyZReportClosed(storeId, report.id, report.zNumber);
    return report;
  }
