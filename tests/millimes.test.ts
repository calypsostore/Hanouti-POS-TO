import { describe, expect, it } from 'vitest';
import { formatMillimes, parseNonNegativeMillimes } from '../src/lib/millimes';

describe('Dinar millimes parsing', () => {
  it.each([
    ['50', 50000],
    ['25.5', 25500],
    ['25.500', 25500],
    ['0.250', 250],
    ['1.005', 1005],
    ['100.000', 100000],
    ['50,000', 50000],
  ])('parses %s as %i millimes', (input, expected) => {
    expect(parseNonNegativeMillimes(input)).toBe(expected);
  });

  it.each(['', '  ', '-200', 'not a number', '1.0000', '9007199254740992', '1e3', '.250'])(
    'rejects invalid Dinar input (%s)',
    (input) => {
      expect(parseNonNegativeMillimes(input)).toBeUndefined();
    },
  );

  it('formats Millimes without float conversion', () => {
    expect(formatMillimes(50000)).toBe('50.000');
    expect(formatMillimes(25500)).toBe('25.500');
    expect(formatMillimes(250)).toBe('0.250');
  });
});
