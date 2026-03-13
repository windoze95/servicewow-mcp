import { describe, it, expect, vi } from "vitest";
import { paginateAll } from "../../../src/servicenow/paginator.js";

describe("paginateAll", () => {
  it("returns all results from a single page (results < limit)", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: [{ id: 1 }, { id: 2 }],
      totalCount: 2,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, { limit: 100 });

    expect(results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(totalCount).toBe(2);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(100, 0);
  });

  it("accumulates results across multiple pages", async () => {
    const fetcher = vi.fn();

    // Page 0: full page of 3
    fetcher.mockResolvedValueOnce({
      results: [{ id: 1 }, { id: 2 }, { id: 3 }],
      totalCount: 5,
    });
    // Page 1: partial page of 2 (signals end)
    fetcher.mockResolvedValueOnce({
      results: [{ id: 4 }, { id: 5 }],
      totalCount: 5,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, { limit: 3 });

    expect(results).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
    expect(totalCount).toBe(5);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops when results.length < limit", async () => {
    const fetcher = vi.fn();

    fetcher.mockResolvedValueOnce({
      results: [{ id: 1 }, { id: 2 }],
      totalCount: 2,
    });

    const { results, truncated } = await paginateAll(fetcher, { limit: 5 });

    expect(results).toHaveLength(2);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops at maxPages safety cap", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: [{ id: 1 }, { id: 2 }],
      totalCount: 1000,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, { limit: 2, maxPages: 3 });

    // 3 pages * 2 results per page = 6 results
    expect(results).toHaveLength(6);
    expect(totalCount).toBe(1000);
    expect(truncated).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("uses default limit (100) and maxPages (50)", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: [{ id: 1 }],
      totalCount: 1,
    });

    await paginateAll(fetcher);

    // Single page with 1 result < 100 limit, so only one call
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(100, 0);
  });

  it("respects custom limit and maxPages options", async () => {
    const fetcher = vi.fn();

    // Return full pages to force pagination up to maxPages
    fetcher.mockResolvedValue({
      results: Array.from({ length: 10 }, (_, i) => ({ id: i })),
      totalCount: 100,
    });

    const { results, truncated } = await paginateAll(fetcher, { limit: 10, maxPages: 2 });

    expect(results).toHaveLength(20);
    expect(truncated).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(10, 0);
    expect(fetcher).toHaveBeenCalledWith(10, 10);
  });

  it("returns empty array when first page returns empty results", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: [],
      totalCount: 0,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher);

    expect(results).toEqual([]);
    expect(totalCount).toBe(0);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns truncated false when maxPages exactly exhausts all data", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: Array.from({ length: 100 }, (_, i) => ({ id: i })),
      totalCount: 500,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, { limit: 100, maxPages: 5 });

    expect(results).toHaveLength(500);
    expect(totalCount).toBe(500);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("returns truncated false when startOffset plus fetched results reaches totalCount", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      results: Array.from({ length: 100 }, (_, i) => ({ id: i })),
      totalCount: 600,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, {
      limit: 100,
      maxPages: 1,
      startOffset: 500,
    });

    expect(results).toHaveLength(100);
    expect(totalCount).toBe(600);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("applies startOffset to all fetcher calls", async () => {
    const fetcher = vi.fn();

    fetcher.mockResolvedValueOnce({
      results: Array.from({ length: 100 }, (_, i) => ({ id: 200 + i })),
      totalCount: 350,
    });
    fetcher.mockResolvedValueOnce({
      results: Array.from({ length: 50 }, (_, i) => ({ id: 300 + i })),
      totalCount: 350,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, {
      limit: 100,
      maxPages: 5,
      startOffset: 200,
    });

    expect(results).toHaveLength(150);
    expect(totalCount).toBe(350);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, 100, 200);
    expect(fetcher).toHaveBeenNthCalledWith(2, 100, 300);
  });

  it("calls fetcher with correct limit and offset values for each page", async () => {
    const fetcher = vi.fn();

    fetcher.mockResolvedValueOnce({
      results: Array.from({ length: 25 }, (_, i) => ({ id: i })),
      totalCount: 60,
    });
    fetcher.mockResolvedValueOnce({
      results: Array.from({ length: 25 }, (_, i) => ({ id: 25 + i })),
      totalCount: 60,
    });
    fetcher.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => ({ id: 50 + i })),
      totalCount: 60,
    });

    const { results, totalCount, truncated } = await paginateAll(fetcher, { limit: 25 });

    expect(results).toHaveLength(60);
    expect(totalCount).toBe(60);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(1, 25, 0);
    expect(fetcher).toHaveBeenNthCalledWith(2, 25, 25);
    expect(fetcher).toHaveBeenNthCalledWith(3, 25, 50);
  });
});
