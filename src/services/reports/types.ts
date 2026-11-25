export interface ReportDayStatus {
  dayIsClosed: boolean;
  hasActivity: boolean;
  openShiftCount: number;
  periodFrom?: string;
  lastZBoundary?: string;
  lastZ?: { reportNumber: string; createdAt: string };
}

export interface ReportServiceContext {
  listReports(storeId: string): Promise<import('../../types/domain').ReportRecord[]>;
}
