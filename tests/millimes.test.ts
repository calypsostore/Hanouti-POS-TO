import { describe, expect, it } from 'vitest';
import { parseNonNegativeMillimes } from '../src/lib/millimes';

describe('parseNonNegativeMillimes', () => {
  it.each([
    ['200', 200],
    ['1800', 1800],
    [' 0 ', 0],
  ])('keeps entered millimes unchanged (%s)', (input, expected) => {
    expect(parseNonNegativeMillimes(input)).toBe(expected);
  });

  it.each(['', '  ', '1.8', '-200', 'not a number', '9007199254740992'])(
    'rejects invalid millimes input (%s)',
    (input) => {
      expect(parseNonNegativeMillimes(input)).toBeUndefined();
    },
  );
});
