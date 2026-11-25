import { isSupabaseDriver } from '../../data/driver';
import { getBusinessDayStatus as getRemoteBusinessDayStatus, listReports as listRemoteReports } from '../../data/repositories/reportRepository';
import { getPreviouslyReportedZShiftIds } from '../reportPeriod';
import { compService } from '../compService';
import { orderService } from '../orderService';
import { shiftService } from '../shiftService';
import { userService } from '../userService';
import { getReports, sinceLastZ, expensesIncludedInZReports, getRangeStart } from './reportHelpers';
import { summarize } from './reportSummaryRemote';

export const reportAnalyticsMethods = {
  async getCurrentPeriodSummary(storeId: string) {
    const [reports, store, shifts, dayStatus] = await Promise.all([
      isSupabaseDriver() ? listRemoteReports(storeId) : Promise.resolve(getReports()),
      userService.getStore(storeId),
      shiftService.listShifts(storeId),
      isSupabaseDriver() ? getRemoteBusinessDayStatus(storeId) : Promise.resolve(undefined),
    ]);
    if (!store) throw new Error('The store could not be found.');
    const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const periodTo = Date.now();
    const serverPeriodStart = dayStatus?.periodFrom ?? dayStatus?.lastZBoundary;
    const periodFrom = isSupabaseDriver() && serverPeriodStart
      ? Date.parse(serverPeriodStart)
      : new Date(sinceLastZ(storeId, reports, timeZone, shifts, periodTo)).getTime();
    const summary = await summarize(
      storeId,
      periodFrom,
      periodTo,
      expensesIncludedInZReports(storeId, reports),
      true,
      isSupabaseDriver() ? serverPeriodStart : undefined,
      !isSupabaseDriver() ? getPreviouslyReportedZShiftIds(storeId, reports) : undefined,
    );
    return {
      ...summary,
      shiftLines: summary.shiftLines.filter((shift) => {
        const openedAt = new Date(shift.openedAt).getTime();
        const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : undefined;
        return openedAt >= periodFrom && openedAt <= periodTo &&
          (shift.status === 'in_progress' ||
            (closedAt !== undefined && closedAt >= periodFrom && closedAt <= periodTo));
      }),
    };
  },

  async getInsights(storeId: string, from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error('Choose a valid insights date range.');
    }
    const toInclusive = to - 1;
    const [summary, allOrders, shifts, staff, comps] = await Promise.all([
      summarize(storeId, from, toInclusive),
      orderService.listAll(storeId),
      shiftService.listShifts(storeId),
      userService.listUsers(storeId),
      compService.listComps(storeId),
    ]);
    const orders = allOrders.filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return timestamp >= from && timestamp < to;
    });
    const completedOrders = orders.filter((order) => order.status === 'done');
    const dailySales = new Map<string, number>();
    const hourlySales = Array.from({ length: 24 }, (_, hour) => ({ hour, salesMillimes: 0 }));
    const staffTotals = new Map<string, {
      staffId: string;
      name: string;
      orders: number;
      salesMillimes: number;
      voids: number;
      compsMillimes: number;
      cashDifferenceMillimes: number;
    }>();
    const ensureStaff = (staffId: string, fallbackName = 'Staff') => {
      let total = staffTotals.get(staffId);
      if (!total) {
        total = {
          staffId,
          name: staff.find((member) => member.id === staffId)?.name ?? fallbackName,
          orders: 0,
          salesMillimes: 0,
          voids: 0,
          compsMillimes: 0,
          cashDifferenceMillimes: 0,
        };
        staffTotals.set(staffId, total);
      }
      return total;
    };
    for (const member of staff.filter((user) => user.role === 'staff')) ensureStaff(member.id, member.name);
    for (const order of orders) {
      if (order.status === 'done') {
        const total = ensureStaff(order.staffId, order.staffName);
        total.orders += 1;
        total.salesMillimes += order.totalMillimes;
        const date = new Date(order.createdAt);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        dailySales.set(dateKey, (dailySales.get(dateKey) ?? 0) + order.totalMillimes);
        hourlySales[date.getHours()].salesMillimes += order.totalMillimes;
      }
    }
    for (const order of allOrders) {
      if (order.status !== 'voided') continue;
      const voidedAt = new Date(order.voidedAt ?? order.createdAt).getTime();
      if (voidedAt >= from && voidedAt < to) ensureStaff(order.staffId, order.staffName).voids += 1;
    }
    for (const comp of comps) {
      const timestamp = new Date(comp.createdAt).getTime();
      if (timestamp >= from && timestamp < to) {
        ensureStaff(comp.staffId).compsMillimes += comp.valueMillimes;
      }
    }
    for (const shift of shifts) {
      const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Number.NaN;
      if (closedAt >= from && closedAt < to) {
        ensureStaff(shift.staffId).cashDifferenceMillimes += shift.differenceMillimes ?? 0;
      }
    }
    const firstDay = new Date(from);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(to - 1);
    lastDay.setHours(0, 0, 0, 0);
    const salesByDay: { date: string; salesMillimes: number }[] = [];
    for (const day = new Date(firstDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
      const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      salesByDay.push({ date: dateKey, salesMillimes: dailySales.get(dateKey) ?? 0 });
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(todayStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const sumDay = (start: Date) => {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const dayOrders = allOrders.filter((order) => {
        const timestamp = new Date(order.createdAt).getTime();
        return order.status === 'done' && timestamp >= start.getTime() && timestamp < end.getTime();
      });
      return {
        salesMillimes: dayOrders.reduce((sum, order) => sum + order.totalMillimes, 0),
        orderCount: dayOrders.length,
      };
    };
    return {
      salesByDay,
      salesByHour: hourlySales,
      salesByStaff: [...staffTotals.values()].sort((left, right) => right.salesMillimes - left.salesMillimes),
      salesByCategory: summary.salesByCategory,
      staffPerformance: [...staffTotals.values()].sort((left, right) => right.salesMillimes - left.salesMillimes)
        .map((member) => ({ ...member, averageOrderMillimes: member.orders ? member.salesMillimes / member.orders : 0 })),
      dayComparison: { today: sumDay(todayStart), lastWeek: sumDay(lastWeekStart) },
      salesCollectedMillimes: summary.salesCollectedMillimes,
      expensesMillimes: summary.expensesMillimes,
      netProfitMillimes: summary.netProfitMillimes,
      compsMillimes: summary.comps.totalMillimes,
      orderCount: completedOrders.length,
    };
  },

  async getDashboard(storeId: string, period: 'day' | 'week' | 'month' | 'year' = 'day') {
    const from = getRangeStart(period).getTime();
    return await summarize(storeId, from, Date.now());
  },
};
