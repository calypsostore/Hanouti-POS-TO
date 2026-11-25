import { describe, expect, it } from 'vitest';
import {
  dateKeyInTimezone,
  fiscalPeriodForPreset,
  resolveFiscalPeriod,
  shiftDateKey,
} from '../src/services/fiscal/fiscalReportService';

describe('fiscal report period resolution', () => {
  it('uses inclusive start and exclusive end dates for custom ranges', () => {
    const period = resolveFiscalPeriod('custom', 'Africa/Tunis', '2026-11-01', '2026-11-30');
    expect(period).toEqual({
      start: '2026-11-01',
      endExclusive: '2026-12-01',
      label: '2026-11-01 to 2026-11-30',
    });
  });

  it('allows a single-day custom range and rejects impossible calendar dates', () => {
    expect(resolveFiscalPeriod('custom', 'Africa/Tunis', '2026-11-25', '2026-11-25')).toEqual({
      start: '2026-11-25',
      endExclusive: '2026-11-26',
      label: '2026-11-25 to 2026-11-25',
    });
    expect(resolveFiscalPeriod('custom', 'Africa/Tunis', '2026-02-31', '2026-02-31')).toBeNull();
  });

  it('handles month and year boundaries without boundary overlap', () => {
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(fiscalPeriodForPreset('previous_month', 'Africa/Tunis', '', '')).not.toBeNull();
  });

  it('rejects custom ranges with missing or reversed dates', () => {
    expect(resolveFiscalPeriod('custom', 'Africa/Tunis', '', '2026-11-30')).toBeNull();
    expect(resolveFiscalPeriod('custom', 'Africa/Tunis', '2026-12-01', '2026-11-30')).toBeNull();
  });

  it('resolves this month to the next calendar month exclusive boundary', () => {
    const period = fiscalPeriodForPreset('this_month', 'Africa/Tunis');
    expect(period?.start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(period?.endExclusive).toMatch(/^\d{4}-\d{2}-01$/);
    expect(period?.endExclusive).not.toBe(period?.start);
  });

  it('resolves each named calendar period with a positive exclusive end', () => {
    const now = new Date();
    const today = dateKeyInTimezone(now, 'Africa/Tunis');
    for (const preset of ['today', 'yesterday', 'this_week', 'this_month', 'previous_month', 'this_year', 'previous_year'] as const) {
      const period = fiscalPeriodForPreset(preset, 'Africa/Tunis');
      expect(period, preset).not.toBeNull();
      expect(period!.start < period!.endExclusive, preset).toBe(true);
    }
    expect(fiscalPeriodForPreset('today', 'Africa/Tunis')?.start).toBe(today);
  });
});
