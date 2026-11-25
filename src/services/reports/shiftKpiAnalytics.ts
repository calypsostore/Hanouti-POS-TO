import type { TabRecord } from '../../types/domain';
import { getShiftOverviewAnalyticsFromRecords, type ShiftOverviewAnalytics, type ShiftOverviewDateRange } from '../../lib/shiftOverview';
import { orderService } from '../orderService';
import { shiftService } from '../shiftService';
import { userService } from '../userService';
import { expenseService } from '../expenseService';
import { readData } from '../storage';
import { isSupabaseDriver } from '../../data/driver';
import { getShiftKpiAnalytics as getRemoteShiftKpiAnalytics } from '../../data/repositories/reportRepository';
import { parseRemoteShiftKpiAnalytics } from './reportHelpers';

export const shiftKpiMethods = {
  async getShiftKpiAnalytics(storeId: string, range: ShiftOverviewDateRange): Promise<ShiftOverviewAnalytics> {
    const dates = [range.from, range.to, range.previousFrom, range.previousTo];
    if (!storeId || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      range.from > range.to || range.previousFrom > range.previousTo) {
      throw new Error('Choose a valid shift KPI date range.');
    }

    if (isSupabaseDriver()) {
      return parseRemoteShiftKpiAnalytics(await getRemoteShiftKpiAnalytics(storeId, range));
    }

    const [store, orders, expenses, tabs, shifts] = await Promise.all([
      userService.getStore(storeId),
      orderService.listAll(storeId),
      expenseService.list(storeId),
      Promise.resolve(readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId)),
      shiftService.listShifts(storeId),
    ]);
    if (!store) throw new Error('The store could not be found.');
    const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return getShiftOverviewAnalyticsFromRecords(
      range,
      orders,
      expenses,
      tabs,
      shifts,
      timeZone,
      store.createdAt,
    );
  }
};
