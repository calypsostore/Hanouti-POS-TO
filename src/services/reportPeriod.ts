import type { ReportRecord, ShiftRecord } from '../types/domain';

type ZReport = Pick<
  ReportRecord,
  'id' | 'storeId' | 'type' | 'createdAt' | 'periodTo' | 'shifts' | 'reportNumber' | 'zNumber'
>;

const FULL_TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

export function getLatestZReport(storeId: string, reports: ReportRecord[]): ZReport | undefined {
  return reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )[0];
}

export function getZReportBoundaryValue(report?: Pick<ZReport, 'createdAt' | 'periodTo'>): string | undefined {
  if (!report) return undefined;
  const periodTo = report.periodTo;
  if (periodTo && FULL_TIMESTAMP_WITH_ZONE.test(periodTo) && Number.isFinite(Date.parse(periodTo))) {
    return periodTo;
  }
  return report.createdAt;
}

export function getZReportBoundaryMilliseconds(report?: Pick<ZReport, 'createdAt' | 'periodTo'>): number {
  const value = getZReportBoundaryValue(report);
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
}

export function getPreviouslyReportedZShiftIds(storeId: string, reports: ReportRecord[]): Set<string> {
  return new Set(reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .flatMap((report) => report.shifts ?? [])
    .map((shift) => shift.shiftId)
    .filter((shiftId) => typeof shiftId === 'string' && shiftId.length > 0));
}

export function getUnreportedShiftsAfterLastZ(
  storeId: string,
  reports: ReportRecord[],
  shifts: ShiftRecord[],
  through = Number.POSITIVE_INFINITY,
): ShiftRecord[] {
  const lastZ = getLatestZReport(storeId, reports);
  const boundary = getZReportBoundaryMilliseconds(lastZ);
  const alreadyReported = getPreviouslyReportedZShiftIds(storeId, reports);
  return shifts
    .filter((shift) => {
      const openedAt = Date.parse(shift.openedAt);
      return shift.storeId === storeId &&
        openedAt > boundary &&
        openedAt <= through &&
        !alreadyReported.has(shift.id);
    })
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt));
}
