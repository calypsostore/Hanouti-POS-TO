import { describe, expect, it } from 'vitest';
import { getReportCloseDate } from '../src/lib/reportArchive';

describe('report archive close date', () => {
  it('uses the store-local close date rather than the report business date', () => {
    const report = {
      businessDate: '2026-11-22',
      createdAt: '2026-11-23T19:07:55.076Z',
    };

    expect(getReportCloseDate(report, 'Africa/Tunis')).toBe('2026-11-23');
  });

  it('uses the store timezone when the close timestamp falls on a different UTC date', () => {
    const report = { createdAt: '2026-11-22T23:30:00.000Z' };

    expect(getReportCloseDate(report, 'Africa/Tunis')).toBe('2026-11-23');
  });
});
