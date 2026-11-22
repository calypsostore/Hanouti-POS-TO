import { formatMillimes } from './millimes';

export function formatTnd(amountInDinars: number): string {
  return Number.isFinite(amountInDinars) ? amountInDinars.toFixed(3) : '—';
}

export function formatTndMillimes(amountMillimes: number): string {
  return formatMillimes(amountMillimes);
}
