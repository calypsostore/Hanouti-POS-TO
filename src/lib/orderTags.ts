import type { OrderRecord } from '../types/domain';

export interface OrderTag {
  id: string;
  label: string;
  kind: 'attention' | 'payment' | 'location' | 'note';
}

export function getOrderTags(order: OrderRecord): OrderTag[] {
  const tags: OrderTag[] = [];

  if (order.syncStatus === 'queued') {
    tags.push({ id: 'sync:queued', label: 'Waiting to sync', kind: 'attention' });
  } else if (order.syncStatus === 'needs_attention') {
    tags.push({ id: 'sync:needs_attention', label: 'Sync needs attention', kind: 'attention' });
  }

  if (order.verificationStatus === 'to_verify') {
    tags.push({ id: 'verification:to_verify', label: 'Credit to verify', kind: 'attention' });
  }

  const paymentLabels = {
    cash: 'Cash',
    card: 'Card',
    other: 'Other payment',
    tab: 'Customer tab',
  } as const;
  tags.push({
    id: `payment:${order.paymentMethod}`,
    label: paymentLabels[order.paymentMethod],
    kind: 'payment',
  });

  const location = order.location?.trim();
  if (location) {
    tags.push({
      id: `location:${location.toLocaleLowerCase()}`,
      label: `Location: ${location}`,
      kind: 'location',
    });
  }

  if (order.note?.trim() || order.items.some((item) => item.modifiers.length > 0)) {
    tags.push({ id: 'note:special_instructions', label: 'Special instructions', kind: 'note' });
  }

  return tags;
}

export function matchesOrderSearch(order: OrderRecord, staffName: string, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;

  const searchableText = [
    order.number,
    order.status,
    order.paymentMethod,
    order.location,
    order.note,
    order.voidReason,
    order.staffName,
    staffName,
    ...order.items.flatMap((item) => [item.name, ...item.modifiers]),
  ].filter(Boolean).join(' ').toLocaleLowerCase();

  return searchableText.includes(query);
}
