import { describe, expect, it } from 'vitest';
import {
  requiresShiftDifferenceNote,
  shouldRequireShiftReview,
} from '../src/lib/shiftClosePolicy';

describe('blind shift close policy', () => {
  it('keeps the review step for normal closes and skips it for blind closes', () => {
    expect(shouldRequireShiftReview(false, false)).toBe(true);
    expect(shouldRequireShiftReview(false, true)).toBe(false);
    expect(shouldRequireShiftReview(true, false)).toBe(false);
  });

  it('requires a variance note only when the staff member can review the difference', () => {
    expect(requiresShiftDifferenceNote(1_000, false)).toBe(true);
    expect(requiresShiftDifferenceNote(1_000, true)).toBe(false);
    expect(requiresShiftDifferenceNote(0, false)).toBe(false);
  });
});
