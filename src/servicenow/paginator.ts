export interface PaginationOptions {
  limit?: number; // per-page, default 100
  maxPages?: number; // safety cap, default 50
}

export interface PaginationResult<T> {
  results: T[];
  totalCount: number;
  truncated: boolean;
}

export async function paginateAll<T>(
  fetcher: (
    limit: number,
    offset: number
  ) => Promise<{ results: T[]; totalCount: number }>,
  options?: PaginationOptions
): Promise<PaginationResult<T>> {
  const limit = options?.limit ?? 100;
  const maxPages = options?.maxPages ?? 50;
  const allResults: T[] = [];
  let totalCount = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const response = await fetcher(limit, offset);
    totalCount = response.totalCount;
    allResults.push(...response.results);
    if (response.results.length < limit) {
      return { results: allResults, totalCount, truncated: false };
    }
  }

  return { results: allResults, totalCount, truncated: true };
}
