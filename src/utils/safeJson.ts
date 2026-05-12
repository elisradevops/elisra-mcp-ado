const MAX_SAFE_SERIALIZE_BYTES = 2 * 1024 * 1024; // 2MB guard

/**
 * Serialize to JSON without throwing on circular refs or oversized values.
 * Truncates the result if it exceeds MAX_SAFE_SERIALIZE_BYTES.
 */
export function safeJsonStringify(value: unknown, indent?: number): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val as unknown;
    },
    indent
  );
  if (serialized.length > MAX_SAFE_SERIALIZE_BYTES) {
    return JSON.stringify({
      _truncated: true,
      _bytes: serialized.length,
      _limit: MAX_SAFE_SERIALIZE_BYTES,
      _message: 'Response too large — narrow your scope or use a more specific query.',
    });
  }
  return serialized;
}

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
