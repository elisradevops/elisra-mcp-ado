import { describe, it, expect, vi } from 'vitest';
import { chunk, processBatches, processBatchesFlat, ADO_BATCH_MAX } from '../../src/utils/batching.js';

describe('chunk', () => {
  it('splits evenly', () => {
    const result = chunk([1, 2, 3, 4], 2);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('handles remainder', () => {
    const result = chunk([1, 2, 3, 4, 5], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('empty array returns empty', () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it('respects ADO_BATCH_MAX default', () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const batches = chunk(ids);
    expect(batches.length).toBe(3); // 200 + 200 + 50
    expect(batches[0]?.length).toBe(200);
    expect(batches[1]?.length).toBe(200);
    expect(batches[2]?.length).toBe(50);
  });

  it('respects ADO_BATCH_MAX constant (max 200)', () => {
    expect(ADO_BATCH_MAX).toBe(200);
  });

  it('throws on size <= 0', () => {
    expect(() => chunk([1, 2], 0)).toThrow();
  });

  it('preserves order', () => {
    const ids = Array.from({ length: 500 }, (_, i) => i);
    const flat = chunk(ids, 200).flat();
    expect(flat).toEqual(ids);
  });
});

describe('processBatches', () => {
  it('calls fn once per batch', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await processBatches([1, 2, 3, 4, 5], 2, 3, fn);
    expect(fn).toHaveBeenCalledTimes(3); // [1,2], [3,4], [5]
  });

  it('respects concurrency', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const fn = async (batch: number[]) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return batch;
    };
    await processBatches([1, 2, 3, 4, 5, 6, 7, 8], 2, 2, fn);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('processBatchesFlat', () => {
  it('flattens results', async () => {
    const fn = (batch: number[]) => Promise.resolve(batch.map((x) => x * 2));
    const result = await processBatchesFlat([1, 2, 3, 4], 2, 2, fn);
    expect(result).toEqual([2, 4, 6, 8]);
  });
});
