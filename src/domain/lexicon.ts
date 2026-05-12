/**
 * Vague terms that reduce requirement clarity (medium confidence warning when found).
 * Source: IEEE 29148 common anti-patterns + project experience.
 */
export const VAGUE_TERMS: readonly string[] = [
  'appropriate',
  'as needed',
  'as appropriate',
  'TBD',
  'and/or',
  'support',
  'efficient',
  'optimal',
  'user-friendly',
  'robust',
  'etc.',
  'etc',
  'e.g.',
  'i.e.',
  'should be able to',
  'if possible',
  'where applicable',
  'reasonable',
  'flexible',
  'easy to use',
  'state of the art',
  'intuitive',
];

/**
 * Risk terms that signal potentially infeasible absolute constraints (low confidence warning).
 * Source: common over-specification anti-patterns.
 */
export const RISK_TERMS: readonly string[] = [
  'always',
  'never',
  '100%',
  'zero false positives',
  'zero false negatives',
  'instant',
  'real-time',
  'unlimited',
  'guaranteed',
  'fail-safe',
  'no downtime',
  'perfect',
  'error-free',
];

export function findVagueTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return VAGUE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

export function findRiskTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return RISK_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

/** Count occurrences of "shall" — high count may indicate multiple requirements merged. */
export function countShall(text: string): number {
  return (text.toLowerCase().match(/\bshall\b/g) ?? []).length;
}
