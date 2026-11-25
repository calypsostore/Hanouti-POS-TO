import { describe, expect, it } from 'vitest';
import { formatMetricWithUnit } from '../src/lib/millimes';

describe('Fiscal Reports summary formatting', () => {
  it('renders transaction counts without a monetary suffix', () => {
    expect(formatMetricWithUnit('10')).toBe('10');
  });

  it('keeps the currency suffix on monetary metrics', () => {
    expect(formatMetricWithUnit('1,234.567', 'DT')).toBe('1,234.567 DT');
  });
});
