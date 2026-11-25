import type { ReportRecord } from '../types/domain';
import { reportLifecycleMethods } from './reports/reportLifecycle';
import { reportAnalyticsMethods } from './reports/reportAnalytics';
import { shiftKpiMethods } from './reports/shiftKpiAnalytics';
import { ownShiftXReportMethods } from './reports/ownShiftXReport';
import { createXReport as createXReportRecord, closeDayWithZReport as closeZReport } from './reports/reportGeneration';

export type { ReportDayStatus } from './reports/types';

export const reportService = {
  ...reportLifecycleMethods,
  ...reportAnalyticsMethods,
  ...shiftKpiMethods,
  ...ownShiftXReportMethods,
  async createXReport(storeId: string, generatedBy = 'Owner'): Promise<ReportRecord> {
    return createXReportRecord(storeId, (targetStoreId) => reportService.getDayStatus(targetStoreId), generatedBy);
  },
  async closeDayWithZReport(
    storeId: string,
    generatedBy = 'Owner',
    ownerPin?: string,
    closeDetails?: {
      countedCashMillimes: number;
      countedCardMillimes?: number;
      countedOtherMillimes?: number;
      note?: string;
    },
  ): Promise<ReportRecord> {
    return closeZReport(storeId, (targetStoreId) => reportService.getDayStatus(targetStoreId), generatedBy, ownerPin, closeDetails);
  },
};
