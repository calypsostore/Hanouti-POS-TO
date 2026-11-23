import { formatMillimesWithThousands } from './millimes';

export function formatTnd(amountInDinars: number): string {
  if (!Number.isFinite(amountInDinars)) return '—';
  return new Intl.NumberFormat('en-US', {
    useGrouping: true,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amountInDinars);
}

export function formatTndMillimes(amountMillimes: number): string {
  return formatMillimesWithThousands(amountMillimes);
}
