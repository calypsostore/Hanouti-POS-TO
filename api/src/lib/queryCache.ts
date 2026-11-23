interface QueryCacheEntry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

interface QueryCacheUpdatedDetail {
  tags: string[];
}

interface InFlightQuery {
  promise: Promise<unknown>;
  tags: string[];
  versions: Map<string, number>;
}

export const QUERY_CACHE_UPDATED_EVENT = '7anouti-query-cache-updated';

const MAX_CACHE_ENTRIES = 100;
const entries = new Map<string, QueryCacheEntry>();
const inFlight = new Map<string, InFlightQuery>();
const tagVersions = new Map<string, number>();

function emitUpdated(tags: string[]): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<QueryCacheUpdatedDetail>(QUERY_CACHE_UPDATED_EVENT, { detail: { tags } }));
  }
}

function remember(key: string, entry: QueryCacheEntry): void {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > MAX_CACHE_ENTRIES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey !== undefined) entries.delete(oldestKey);
  }
}

export async function fetchCachedQuery<T>(
  key: string,
  tags: string[],
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const pending = inFlight.get(key);
  const pendingIsCurrent = pending && pending.tags.every((tag) =>
    (tagVersions.get(tag) ?? 0) === pending.versions.get(tag),
  );
  if (pendingIsCurrent) return cached ? cached.value as T : pending.promise as Promise<T>;

  const versions = new Map(tags.map((tag) => [tag, tagVersions.get(tag) ?? 0]));
  const request: InFlightQuery = { promise: Promise.resolve(undefined), tags, versions };
  request.promise = fetcher().then((value) => {
    const stillCurrent = tags.every((tag) => (tagVersions.get(tag) ?? 0) === versions.get(tag));
    if (stillCurrent) {
      remember(key, { value, expiresAt: Date.now() + ttlMs, tags });
      if (cached) emitUpdated(tags);
    }
    return value;
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);

  if (cached) {
    void request.promise.catch((error: unknown) => {
      console.error(`[query-cache] Background refresh failed for ${key}.`, error);
    });
    return cached.value as T;
  }
  return request.promise as Promise<T>;
}

export function invalidateQueryCache(tags: string[]): void {
  const invalidatedTags = new Set(tags);
  for (const tag of invalidatedTags) tagVersions.set(tag, (tagVersions.get(tag) ?? 0) + 1);
  for (const [key, entry] of entries) {
    if (entry.tags.some((tag) => invalidatedTags.has(tag))) entries.delete(key);
  }
}

export function clearQueryCache(): void {
  entries.clear();
  for (const tag of tagVersions.keys()) tagVersions.set(tag, tagVersions.get(tag)! + 1);
}
