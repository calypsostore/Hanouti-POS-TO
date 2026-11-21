export function parseNonNegativeMillimes(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const millimes = Number(trimmed);
  return Number.isSafeInteger(millimes) && millimes >= 0 ? millimes : undefined;
}
