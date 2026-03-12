export interface PaginationOptions {
  limit?: number; // per-page, default 100
  maxPages?: number; // safety cap, default 50
}

export async function paginateAll<T>(
  fetcher: (
    limit: number,
    offset: number
  ) => Promise<{ results: T[]; totalCount: number }>,
  options?: PaginationOptions
): Promise<T[]> {
  const limit = options?.limit ?? 100;
  const maxPages = options?.maxPages ?? 50;
  const allResults: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const { results } = await fetcher(limit, offset);
    allResults.push(...results);
    if (results.length < limit) {
      break;
    }
  }

  return allResults;
}
