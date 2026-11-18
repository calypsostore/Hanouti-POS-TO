import type { ReportRecord } from '../types/domain';
import { orderService } from './orderService';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { readData, writeData } from './storage';
import { seedReports } from './seedData';

const getReports = () => readData('reports', seedReports);
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function getRangeStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === 'month') {
    start.setDate(1);
  } else if (period === 'year') {
    start.setMonth(0, 1);
  }
  return start;
}

async function summarize(storeId: string, period: 'day' | 'week' | 'month' | 'year' = 'day') {
  const rangeStart = getRangeStart(period).getTime();
  const orders = (await orderService.listAll(storeId)).filter((order) =>
    order.status === 'done' && new Date(order.createdAt).getTime() >= rangeStart,
  );
  const shifts = (await shiftService.listShifts(storeId)).filter((shift) =>
    new Date(shift.openedAt).getTime() >= rangeStart,
  );
  return {
    salesMillimes: orders.reduce((sum, order) => sum + order.totalMillimes, 0),
    orderCount: orders.length,
    cashDifferenceMillimes: shifts.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0),
    topItems: orders.flatMap((order) => order.items).reduce<Record<string, number>>((totals, item) => {
      totals[item.name] = (totals[item.name] ?? 0) + item.quantity;
      return totals;
    }, {}),
    shifts,
  };
}

export const reportService = {
  async getDashboard(storeId: string, period: 'day' | 'week' | 'month' | 'year' = 'day') {
    return await summarize(storeId, period);
  },

  async listReports(storeId: string): Promise<ReportRecord[]> {
    return getReports().filter((report) => report.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createXReport(storeId: string): Promise<ReportRecord> {
    const summary = await summarize(storeId);
    const report: ReportRecord = {
      id: `report-${crypto.randomUUID()}`,
      storeId,
      type: 'X',
      businessDate: todayKey(),
      createdAt: new Date().toISOString(),
      salesMillimes: summary.salesMillimes,
      orderCount: summary.orderCount,
      cashDifferenceMillimes: summary.cashDifferenceMillimes,
    };
    writeData('reports', [...getReports(), report]);
    return report;
  },

  async closeDayWithZReport(storeId: string): Promise<ReportRecord> {
    if ((await shiftService.listOpenShifts(storeId)).length > 0) throw new Error('Close every shift before creating a Z report.');
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    if (store.dayClosedOn === todayKey()) throw new Error('A Z report has already closed this business day.');
    const summary = await summarize(storeId);
    const report: ReportRecord = {
      id: `report-${crypto.randomUUID()}`,
      storeId,
      type: 'Z',
      businessDate: todayKey(),
      createdAt: new Date().toISOString(),
      salesMillimes: summary.salesMillimes,
      orderCount: summary.orderCount,
      cashDifferenceMillimes: summary.cashDifferenceMillimes,
    };
    writeData('reports', [...getReports(), report]);
    writeData('stores', (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: todayKey() } : candidate));
    return report;
  },
};
