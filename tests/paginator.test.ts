import { describe, it, expect, vi } from 'vitest';
import { Paginator } from '../src/paginator';

describe('Paginator', () => {
  it('should not make extra call when results align with page size', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3], total: 3 })
      .mockResolvedValueOnce({ items: [], total: 3 });

    const paginator = new Paginator<number>(fetcher, { pageSize: 3 });
    
    const page1 = await paginator.next();
    expect(page1?.items).toEqual([1, 2, 3]);
    expect(page1?.hasMore).toBe(false);
    
    // Should return null without making another API call
    const page2 = await paginator.next();
    expect(page2).toBeNull();
    
    // Should only have called fetcher once
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple pages correctly', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 4 })
      .mockResolvedValueOnce({ items: [3, 4], total: 4 });

    const paginator = new Paginator<number>(fetcher, { pageSize: 2 });
    
    const p1 = await paginator.next();
    expect(p1?.hasMore).toBe(true);
    
    const p2 = await paginator.next();
    expect(p2?.hasMore).toBe(false);
    expect(p2?.items).toEqual([3, 4]);
    
    const p3 = await paginator.next();
    expect(p3).toBeNull();
    
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('should respect maxItems limit', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3, 4, 5], total: 10 });

    const paginator = new Paginator<number>(fetcher, { pageSize: 5, maxItems: 3 });
    
    const page = await paginator.next();
    expect(page?.items).toEqual([1, 2, 3]);
    
    const next = await paginator.next();
    expect(next).toBeNull();
  });

  it('should collect all items', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 4 })
      .mockResolvedValueOnce({ items: [3, 4], total: 4 });

    const paginator = new Paginator<number>(fetcher, { pageSize: 2 });
    const all = await paginator.all();
    expect(all).toEqual([1, 2, 3, 4]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
