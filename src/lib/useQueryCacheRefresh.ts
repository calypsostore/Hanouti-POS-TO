import { useEffect, useState } from 'react';
import { QUERY_CACHE_UPDATED_EVENT } from './queryCache';

interface QueryCacheUpdatedDetail {
  tags: string[];
}

export function useQueryCacheRefresh(tags: string[]): number {
  const [revision, setRevision] = useState(0);
  const tagKey = [...new Set(tags)].sort().join('|');

  useEffect(() => {
    const watchedTags = new Set(tagKey.split('|'));
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<QueryCacheUpdatedDetail>).detail;
      if (detail?.tags.some((tag) => watchedTags.has(tag))) {
        setRevision((current) => current + 1);
      }
    };
    window.addEventListener(QUERY_CACHE_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(QUERY_CACHE_UPDATED_EVENT, handleUpdate);
  }, [tagKey]);

  return revision;
}
