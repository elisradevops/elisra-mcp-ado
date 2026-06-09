import { htmlToText } from './htmlToText.js';

/**
 * Extracts hierarchical WBS (Work Breakdown Structure) codes from a text or HTML string.
 * It strips HTML tags first, then scans the plain text for dotted numeric patterns
 * (e.g., 1.2, 10.2.3.4) and alphanumeric prefixed WBS patterns (e.g., WBS-1.2.3, P-4.5).
 */
export function extractWbsCodes(input: string | null | undefined): string[] {
  if (!input) return [];

  // Strip HTML tags to prevent matching numeric codes inside HTML attribute values
  const plainText = htmlToText(input);

  // 1. Standard dotted numeric hierarchy (e.g. 1.2, 3.4.5, 10.20.30.40)
  // Requires at least one dot, bounded by word boundaries, and not preceded by a hyphen, alphanumeric char, or dot.
  const dottedNumericRegex = /(?<![\w-.])\d+(?:\.\d+)+\b/g;

  // 2. Alphanumeric prefixed WBS codes (e.g., WBS-1.2.3, A-4.5)
  const prefixedWbsRegex = /\b[A-Za-z]+-\d+(?:\.\d+)*\b/g;

  const matches = new Set<string>();

  let match;
  while ((match = dottedNumericRegex.exec(plainText)) !== null) {
    matches.add(match[0]);
  }

  while ((match = prefixedWbsRegex.exec(plainText)) !== null) {
    matches.add(match[0]);
  }

  return Array.from(matches);
}
