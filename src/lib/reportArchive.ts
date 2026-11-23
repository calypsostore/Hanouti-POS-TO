import type { ReportRecord } from '../types/domain';
import { dateKeyInTimezone } from './date';

export function getReportCloseDate(report: Pick<ReportRecord, 'createdAt'>, timeZone: string): string {
  return dateKeyInTimezone(new Date(report.createdAt), timeZone);
}
