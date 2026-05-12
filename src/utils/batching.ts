import pLimit from 'p-limit';

export const ADO_BATCH_MAX = 200;

/**
 * Split an array into chunks of at most `size` items.
 * Preserves order.
 */
export function chunk<T>(items: T[], size: number = ADO_BATCH_MAX): T[][] {
  if (size <= 0) throw new RangeError(`chunk size must be > 0, got ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process items in bounded-concurrency batches.
 * concurrency defaults to 5 (safe for on-prem ADO rate limits).
 */
export async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  concurrency: number,
  fn: (batch: T[]) => Promise<R>
): Promise<R[]> {
  const batches = chunk(items, batchSize);
  const limit = pLimit(concurrency);
  const results = await Promise.all(batches.map((batch) => limit(() => fn(batch))));
  return results;
}

/**
 * Flatten results from processBatches when each batch returns an array.
 */
export async function processBatchesFlat<T, R>(
  items: T[],
  batchSize: number,
  concurrency: number,
  fn: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const batched = await processBatches(items, batchSize, concurrency, fn);
  return batched.flat();
}
