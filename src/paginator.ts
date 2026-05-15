/**
 * Fixed Paginator - Eliminates unnecessary extra API call
 * 
 * Bug: When results perfectly align with page size, the paginator
 * makes an extra API call that returns empty results.
 * 
 * Fix: Track total count and check if we've reached it before
 * making the next call.
 */

export interface PaginatorConfig {
  pageSize: number;
  maxItems?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export class Paginator<T> {
  private page = 0;
  private fetchedItems = 0;
  private total: number | null = null;

  constructor(
    private fetcher: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
    private config: PaginatorConfig
  ) {}

  async next(): Promise<PageResult<T> | null> {
    // FIX: Check if we already fetched all items before making another API call
    if (this.total !== null && this.fetchedItems >= this.total) {
      return null;
    }

    // FIX: Also respect maxItems limit
    if (this.config.maxItems && this.fetchedItems >= this.config.maxItems) {
      return null;
    }

    const pageSize = this.config.maxItems
      ? Math.min(this.config.pageSize, this.config.maxItems - this.fetchedItems)
      : this.config.pageSize;

    const result = await this.fetcher(this.page, pageSize);
    
    // Update total from API response
    this.total = result.total;
    this.fetchedItems += result.items.length;
    this.page++;

    const hasMore = this.fetchedItems < this.total &&
      (!this.config.maxItems || this.fetchedItems < this.config.maxItems);

    return {
      items: result.items,
      total: result.total,
      page: this.page,
      pageSize,
      hasMore,
    };
  }

  async all(): Promise<T[]> {
    const all: T[] = [];
    let result: PageResult<T> | null;
    while ((result = await this.next()) !== null) {
      all.push(...result.items);
    }
    return all;
  }

  reset(): void {
    this.page = 0;
    this.fetchedItems = 0;
    this.total = null;
  }
}
