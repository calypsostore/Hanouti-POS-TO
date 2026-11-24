import { describe, expect, it } from 'vitest';
import { findMatches } from '../src/lib/workspaceSearch';
import type { GlobalSearchResult } from '../src/types/workspaceSearch';

const results: GlobalSearchResult[] = [
  {
    id: 'product:creme',
    title: 'Crème Brûlée',
    detail: 'Desserts',
    group: 'Products',
    href: '/owner/catalog',
    icon: 'inventory_2',
    searchText: 'creme brulee desserts',
  },
  {
    id: 'customer:amina',
    title: 'Amina',
    detail: 'Customer',
    group: 'Customers',
    href: '/customers/amina',
    icon: 'person',
    searchText: 'amina 555-0101',
  },
];

describe('workspace search matching', () => {
  it('matches case-insensitively and ignores accents', () => {
    expect(findMatches(results, 'CREME BRULEE').map((result) => result.id)).toEqual(['product:creme']);
  });

  it('requires every query word to match', () => {
    expect(findMatches(results, 'amina missing')).toEqual([]);
  });
});
