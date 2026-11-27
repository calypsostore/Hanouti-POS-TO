export function requiresShiftDifferenceNote(differenceMillimes: number, blindClose: boolean): boolean {
  return differenceMillimes !== 0 && !blindClose;
}

export function shouldRequireShiftReview(blindClose: boolean, reviewed: boolean): boolean {
  return !blindClose && !reviewed;
}
