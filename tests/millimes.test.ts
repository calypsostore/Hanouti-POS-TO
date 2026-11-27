import { describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../src/i18n';
import { formatMillimesAmountsInText, formatTnd } from '../src/lib/format';
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

  it('formats displayed Dinars using the selected language conventions', () => {
    const previousLanguage = getLanguage();
    try {
      setLanguage('fr');
      expect(formatMillimesWithThousands(1250000)).toBe('1\u202f250,000');
      expect(formatMillimesWithThousands(-250)).toBe('-0,250');
      expect(formatTnd(1250)).toBe('1\u202f250,000');
    } finally {
      setLanguage(previousLanguage);
    }
  });

  it('formats legacy millime amounts in display text as DT', () => {
    expect(formatMillimesAmountsInText('Cash difference of -1223 millimes; total 1,234,567 millimes.'))
      .toBe('Cash difference of -1.223 DT; total 1,234.567 DT.');
    expect(formatMillimesAmountsInText('Changed the price from 50000 to 25000 millimes.'))
      .toBe('Changed the price from 50.000 DT to 25.000 DT.');
    expect(formatMillimesAmountsInText('The amount is already 1.223 DT.'))
      .toBe('The amount is already 1.223 DT.');
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
