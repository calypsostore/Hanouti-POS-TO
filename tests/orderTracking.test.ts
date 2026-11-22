import { describe, expect, it } from 'vitest';
import { getOrderTags, matchesOrderSearch } from '../src/lib/orderTags';
import type { OrderRecord } from '../src/types/domain';

const order: OrderRecord = {
  id: 'order-1',
  number: 42,
  storeId: 'store-1',
  staffId: 'staff-1',
  staffName: 'Samira',
  shiftId: 'shift-1',
  location: 'Table 7',
  status: 'done',
  paymentMethod: 'tab',
  note: 'No ice, please',
  items: [{
    itemId: 'drink-1',
    name: 'Iced coffee',
    quantity: 1,
    unitPriceMillimes: 4500,
    lineTotalMillimes: 4500,
    modifiers: ['Oat milk'],
  }],
  totalMillimes: 4500,
  createdAt: '2026-11-20T20:00:00.000Z',
  syncStatus: 'queued',
  verificationStatus: 'to_verify',
};

describe('order ticket tracking', () => {
  it('derives filters from saved order data without inventing workflow statuses', () => {
    expect(getOrderTags(order).map((tag) => tag.id)).toEqual([
      'sync:queued',
      'verification:to_verify',
      'payment:tab',
      'location:table 7',
      'note:special_instructions',
    ]);
  });

  it('searches ticket numbers, staff, item modifiers, notes, and locations', () => {
    expect(matchesOrderSearch(order, 'Samira', '42')).toBe(true);
    expect(matchesOrderSearch(order, 'Samira', 'oat milk')).toBe(true);
    expect(matchesOrderSearch(order, 'Samira', 'table 7')).toBe(true);
    expect(matchesOrderSearch(order, 'Samira', 'not found')).toBe(false);
  });
});
