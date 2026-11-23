import { describe, expect, it } from 'vitest';
import {
  formatDinarInput,
  formatMillimes,
  formatMillimesWithThousands,
  parseNonNegativeMillimes,
  preserveDinarInputCursor,
} from '../src/lib/millimes';

describe('Dinar millimes parsing', () => {
  it.each([
    ['50', 50000],
    ['25.5', 25500],
    ['25.500', 25500],
    ['0.250', 250],
    ['1.005', 1005],
    ['100.000', 100000],
    ['50,000', 50000000],
    ['1,250.000', 1250000],
    ['0,500', 500],
  ])('parses %s as %i millimes', (input, expected) => {
    expect(parseNonNegativeMillimes(input)).toBe(expected);
  });

  it.each(['', '  ', '-200', 'not a number', '1.0000', '9007199254740992', '1e3', '.250', '1 005'])(
    'rejects invalid Dinar input (%s)',
    (input) => {
      expect(parseNonNegativeMillimes(input)).toBeUndefined();
    },
  );

  it('formats Millimes without float conversion', () => {
    expect(formatMillimes(50000)).toBe('50.000');
    expect(formatMillimes(25500)).toBe('25.500');
    expect(formatMillimes(250)).toBe('0.250');
    expect(formatMillimesWithThousands(1250000)).toBe('1,250.000');
  });

  it('formats raw millime digits as grouped dinar amounts', () => {
    expect(formatDinarInput('50')).toBe('0.050');
    expect(formatDinarInput('1250')).toBe('1.250');
    expect(formatDinarInput('50000')).toBe('50.000');
    expect(formatDinarInput('1000000')).toBe('1,000.000');
    expect(formatDinarInput('50.000')).toBe('50.000');
    expect(formatDinarInput('1,000.000')).toBe('1,000.000');
    expect(formatDinarInput('0,500')).toBe('0.500');

    expect(parseNonNegativeMillimes(formatDinarInput('50'))).toBe(50);
    expect(parseNonNegativeMillimes(formatDinarInput('50000'))).toBe(50000);
    expect(parseNonNegativeMillimes(formatDinarInput('1000000'))).toBe(1000000);
  });

  it('preserves the approximate cursor position across thousands formatting', () => {
    expect(preserveDinarInputCursor('1250', '1,250', 4)).toBe(5);
    expect(preserveDinarInputCursor('1250.5', '1,250.5', 6)).toBe(7);
  });
});
