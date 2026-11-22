export function parseNonNegativeMillimes(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const commaOnly = trimmed.includes(',') && !trimmed.includes('.');
  const normalized = commaOnly ? trimmed.replace(/,/g, '.') : trimmed.replace(/,/g, '');
  if (!/^(?:\d+)(?:\.\d{0,3})?$/.test(normalized)) return undefined;

  const [dinarsText, decimalsText = ''] = normalized.split('.');
  if (!/^\d+$/.test(dinarsText)) return undefined;

  const dinars = dinarsText.replace(/^0+(?=\d)/, '');
  const decimals = decimalsText.padEnd(3, '0');
  const millimes = Number(dinars) * 1000 + Number(decimals);
  return Number.isSafeInteger(millimes) && millimes >= 0 ? millimes : undefined;
}

export function formatMillimes(amountMillimes: number): string {
  if (!Number.isSafeInteger(amountMillimes) || amountMillimes < 0) return '—';
  const dinars = Math.floor(amountMillimes / 1000);
  const millimes = amountMillimes % 1000;
  return `${dinars}.${String(millimes).padStart(3, '0')}`;
}

export function formatMillimesWithThousands(amountMillimes: number): string {
  if (!Number.isSafeInteger(amountMillimes)) return '—';
  const sign = amountMillimes < 0 ? '-' : '';
  const absolute = Math.abs(amountMillimes);
  const dinars = Math.floor(absolute / 1000);
  const millimes = absolute % 1000;
  return `${sign}${dinars.toLocaleString('en-US')}.${String(millimes).padStart(3, '0')}`;
}

export function formatDinarInput(value: string): string {
  const commaOnly = value.includes(',') && !value.includes('.');
  const normalized = (commaOnly ? value : value.replace(/,/g, '')).replace(/,/g, '.');
  if (!/^\d*(?:\.\d{0,3})?$/.test(normalized)) return value;
  const [rawDinars = '', decimals] = normalized.split('.');
  const dinars = rawDinars === '' ? '' : rawDinars.replace(/^0+(?=\d)/, '');
  const grouped = dinars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals !== undefined ? `${grouped}.${decimals}` : grouped;
}

export function preserveDinarInputCursor(
  before: string,
  after: string,
  cursor: number,
): number {
  if (cursor <= 0) return 0;
  const beforeNormalized = before.replace(/,/g, '.');
  const dotIndex = beforeNormalized.indexOf('.');
  const digitsBeforeCursor = beforeNormalized.slice(0, cursor).replace(/\D/g, '').length;
  if (dotIndex >= 0 && cursor > dotIndex) {
    const afterDotIndex = after.indexOf('.');
    if (afterDotIndex < 0) return after.length;
    const decimalDigits = beforeNormalized.slice(dotIndex + 1, cursor).replace(/\D/g, '').length;
    return Math.min(after.length, afterDotIndex + 1 + decimalDigits);
  }
  let digitsSeen = 0;
  for (let index = 0; index < after.length; index += 1) {
    if (/\d/.test(after[index])) digitsSeen += 1;
    if (digitsSeen >= digitsBeforeCursor) return index + 1;
  }
  return after.length;
}
