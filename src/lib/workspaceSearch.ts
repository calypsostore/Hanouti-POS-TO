import type { GlobalSearchResult } from '../types/workspaceSearch';

const MAX_RESULTS = 8;

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

export function findMatches(results: GlobalSearchResult[], query: string): GlobalSearchResult[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) return [];
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return results
    .map((result) => {
      const title = normalizeSearchText(result.title);
      const searchableText = normalizeSearchText(`${title} ${result.searchText}`);
      const matches = title.includes(normalizedQuery) || queryWords.every((word) => searchableText.includes(word));
      if (!matches) return undefined;
      const score = title === normalizedQuery ? 0
        : title.startsWith(normalizedQuery) ? 1
          : title.includes(normalizedQuery) ? 2
            : 3;
      return { result, score };
    })
    .filter((match): match is { result: GlobalSearchResult; score: number } => match !== undefined)
    .sort((left, right) => left.score - right.score || left.result.title.localeCompare(right.result.title))
    .slice(0, MAX_RESULTS)
    .map((match) => match.result);
}
