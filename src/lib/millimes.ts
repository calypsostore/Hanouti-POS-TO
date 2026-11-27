import { getLanguage } from '../i18n';

export function parseNonNegativeMillimes(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const commaOnly = trimmed.includes(',') && !trimmed.includes('.');
  const groupedInteger = /^\d{1,3}(?:,\d{3})+$/.test(trimmed) && !trimmed.startsWith('0,');
  const normalized = commaOnly && !groupedInteger
    ? trimmed.replace(/,/g, '.')
    : trimmed.replace(/,/g, '');
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
  const locale = getLanguage();
  const sign = amountMillimes < 0 ? '-' : '';
  const absolute = Math.abs(amountMillimes);
  const dinars = Math.floor(absolute / 1000);
  const millimes = absolute % 1000;
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(dinars);
  const decimal = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).formatToParts(0.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const formatDigit = new Intl.NumberFormat(locale, { useGrouping: false });
  const fraction = String(millimes).padStart(3, '0')
    .replace(/\d/g, (digit) => formatDigit.format(Number(digit)));
  return `${sign}${integer}${decimal}${fraction}`;
}

export function formatMetricWithUnit(value: string, unit?: string): string {
  return unit ? `${value} ${unit}` : value;
}

export function formatDinarInput(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';

  const millimes = digits.padStart(4, '0');
  const dinars = millimes.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${dinars}.${millimes.slice(-3)}`;
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
