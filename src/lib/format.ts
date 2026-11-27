import { getLanguage } from '../i18n';
import { formatMillimesWithThousands } from './millimes';

export function formatTnd(amountInDinars: number): string {
  if (!Number.isFinite(amountInDinars)) return '—';
  return new Intl.NumberFormat(getLanguage(), {
    useGrouping: true,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amountInDinars);
}

export function formatTndMillimes(amountMillimes: number): string {
  return formatMillimesWithThousands(amountMillimes);
}

export function formatMillimesAmountsInText(value: string): string {
  const formatAmount = (amount: string): string | undefined => {
    const millimes = Number(amount.replace(/,/g, ''));
    return Number.isSafeInteger(millimes) ? `${formatTndMillimes(millimes)} DT` : undefined;
  };
  const convertedRanges = value.replace(
    /\bfrom\s+(-?[\d,]+)\s+to\s+(-?[\d,]+)\s+millimes?\b/gi,
    (match, from: string, to: string) => {
      const formattedFrom = formatAmount(from);
      const formattedTo = formatAmount(to);
      return formattedFrom && formattedTo ? `from ${formattedFrom} to ${formattedTo}` : match;
    },
  );
  return convertedRanges.replace(/(^|[^\d.,])(-?\d[\d,]*)\s+millimes?\b/gi, (match, prefix: string, amount: string) => {
    const formattedAmount = formatAmount(amount);
    return formattedAmount ? `${prefix}${formattedAmount}` : match;
  });
}
