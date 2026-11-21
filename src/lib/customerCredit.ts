import type { CustomerCreditStatus } from '../services/customerService';

export type CustomerCreditState = 'ok' | 'near' | 'over' | 'no_limit';

export interface CustomerCreditTone {
  barClass: string;
  color: string;
}

export async function loadCustomerCreditStatuses(
  load: () => Promise<Record<string, CustomerCreditStatus>>,
): Promise<{ statuses: Record<string, CustomerCreditStatus>; unavailable: boolean }> {
  try {
    return { statuses: await load(), unavailable: false };
  } catch (error) {
    console.error('Unable to load customer credit statuses.', error);
    return { statuses: {}, unavailable: true };
  }
}

export function getCustomerCreditTone(state: CustomerCreditState, percentUsed = 0): CustomerCreditTone {
  const roundedPercentUsed = Math.round(percentUsed);
  if (state === 'over' || roundedPercentUsed >= 75) return { barClass: 'bg-error-dark', color: '#b3261e' };
  if (state === 'near' || roundedPercentUsed >= 50) return { barClass: 'bg-secondary', color: '#b26a00' };
  if (state === 'no_limit') return { barClass: 'bg-surface-container-high', color: '#c8c6c3' };
  return { barClass: 'bg-success-dark', color: '#238636' };
}
