/**
 * Map<K, V> where all string key lookups are case-insensitive.
 * Stores the canonical (original-casing) key alongside the value.
 *
 * Used by GenericWiqlCompiler to resolve e.g. "Custom.CustomerId" → "Custom.CustomerID".
 */
export class CaseInsensitiveMap<V> {
  private readonly data = new Map<string, V>();
  private readonly canonical = new Map<string, string>(); // lowercase → original key

  set(key: string, value: V): this {
    const lower = key.toLowerCase();
    this.data.set(lower, value);
    this.canonical.set(lower, key);
    return this;
  }

  get(key: string): V | undefined {
    return this.data.get(key.toLowerCase());
  }

  /** Returns the canonical (original-case) key for the given input, or undefined. */
  getCanonicalKey(key: string): string | undefined {
    return this.canonical.get(key.toLowerCase());
  }

  has(key: string): boolean {
    return this.data.has(key.toLowerCase());
  }

  delete(key: string): boolean {
    const lower = key.toLowerCase();
    this.canonical.delete(lower);
    return this.data.delete(lower);
  }

  get size(): number {
    return this.data.size;
  }

  entries(): IterableIterator<[string, V]> {
    // Yield with canonical keys
    const canonical = this.canonical;
    const data = this.data;
    function* gen(): Generator<[string, V]> {
      for (const [lower, value] of data) {
        yield [canonical.get(lower) ?? lower, value];
      }
    }
    return gen();
  }

  values(): IterableIterator<V> {
    return this.data.values();
  }

  static fromEntries<V>(entries: Iterable<[string, V]>): CaseInsensitiveMap<V> {
    const map = new CaseInsensitiveMap<V>();
    for (const [k, v] of entries) map.set(k, v);
    return map;
  }
}
