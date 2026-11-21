import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueryCache, fetchCachedQuery, invalidateQueryCache } from '../src/lib/queryCache';

describe('keyed query cache', () => {
  beforeEach(() => clearQueryCache());

  it('serves stale data while revalidating and stores the refreshed result', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('refreshed');

    await expect(fetchCachedQuery('catalog:store-a', ['catalog_items'], 0, fetcher)).resolves.toBe('initial');
    await expect(fetchCachedQuery('catalog:store-a', ['catalog_items'], 1000, fetcher)).resolves.toBe('initial');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(fetchCachedQuery('catalog:store-a', ['catalog_items'], 1000, fetcher)).resolves.toBe('refreshed');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidates only entries tagged with the changed table', async () => {
    const catalogFetcher = vi.fn().mockResolvedValue(['coffee']);
    const storeFetcher = vi.fn().mockResolvedValue({ name: 'Cafe' });

    await fetchCachedQuery('catalog:store-a', ['catalog_items'], 1000, catalogFetcher);
    await fetchCachedQuery('store:store-a', ['stores'], 1000, storeFetcher);
    invalidateQueryCache(['catalog_items']);

    await fetchCachedQuery('catalog:store-a', ['catalog_items'], 1000, catalogFetcher);
    await fetchCachedQuery('store:store-a', ['stores'], 1000, storeFetcher);

    expect(catalogFetcher).toHaveBeenCalledTimes(2);
    expect(storeFetcher).toHaveBeenCalledOnce();
  });
});
