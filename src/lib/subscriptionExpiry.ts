const MILLISECONDS_PER_DAY = 86_400_000;

export function getSubscriptionDaysRemaining(paidUntil: string, now = new Date()): number | null {
  const expiry = new Date(`${paidUntil}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / MILLISECONDS_PER_DAY);
}
