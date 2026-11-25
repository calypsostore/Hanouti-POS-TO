import type { ReportRecord } from '../../types/domain';
import type { ReportDayStatus, ReportServiceContext } from './types';
import { isSupabaseDriver } from '../../data/driver';
import { getBusinessDayStatus as getRemoteBusinessDayStatus, listReports as listRemoteReports } from '../../data/repositories/reportRepository';
import { shiftService } from '../shiftService';
import { getReports } from './reportHelpers';
import { getLatestZReport, getUnreportedShiftsAfterLastZ, getZReportBoundaryValue } from '../reportPeriod';

export const reportLifecycleMethods = {
  async getDayStatus(this: ReportServiceContext, storeId: string): Promise<ReportDayStatus> {
    if (isSupabaseDriver()) {
      return getRemoteBusinessDayStatus(storeId);
    }
    const [reports, shifts] = await Promise.all([
      this.listReports(storeId),
      shiftService.listShifts(storeId),
    ]);
    const lastZReport = getLatestZReport(storeId, reports);
    const activityShifts = getUnreportedShiftsAfterLastZ(storeId, reports, shifts);
    const hasActivity = activityShifts.length > 0;
    return {
      dayIsClosed: Boolean(lastZReport) && !hasActivity,
      hasActivity,
      openShiftCount: shifts.filter((shift) => shift.status === 'open').length,
      periodFrom: activityShifts[0]?.openedAt,
      lastZBoundary: lastZReport ? getZReportBoundaryValue(lastZReport) : undefined,
      lastZ: lastZReport
        ? {
          reportNumber: lastZReport.reportNumber ?? `Z-${String(lastZReport.zNumber ?? 0).padStart(6, '0')}`,
          createdAt: lastZReport.createdAt,
        }
        : undefined,
    };
  },

  async listReports(storeId: string): Promise<ReportRecord[]> {
    if (isSupabaseDriver()) return listRemoteReports(storeId);
    return getReports().filter((report) => report.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
