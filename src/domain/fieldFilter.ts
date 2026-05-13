import { z } from 'zod';

export type Operator =
  | '='
  | '<>'
  | 'IN'
  | 'NOT IN'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'CONTAINS'
  | 'DOES NOT CONTAIN'
  | 'CONTAINS WORDS'
  | 'DOES NOT CONTAIN WORDS'
  | 'IS EMPTY'
  | 'IS NOT EMPTY'
  | 'UNDER'
  | 'NOT UNDER'
  | 'EVER'
  | 'WAS EVER'
  | 'IN GROUP'
  | 'NOT IN GROUP';

/** A reference to another field for field-to-field comparisons, e.g. { fieldRef: 'System.CreatedDate' } */
export interface FieldRef {
  fieldRef: string;
}

export type FilterValue = string | number | boolean | string[] | number[] | FieldRef;

export interface FieldFilter {
  field: string;
  operator: Operator;
  value?: FilterValue;
}

export interface OrderBy {
  field: string;
  direction: 'ASC' | 'DESC';
}

export const ALL_OPERATORS: readonly Operator[] = [
  '=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>=',
  'CONTAINS', 'DOES NOT CONTAIN', 'CONTAINS WORDS', 'DOES NOT CONTAIN WORDS',
  'IS EMPTY', 'IS NOT EMPTY',
  'UNDER', 'NOT UNDER',
  'EVER', 'WAS EVER',
  'IN GROUP', 'NOT IN GROUP',
] as const;

export const TREEPATH_OPERATORS: readonly Operator[] = ['=', '<>', 'UNDER', 'NOT UNDER'] as const;
export const STRING_OPERATORS: readonly Operator[] = [
  '=', '<>', 'IN', 'NOT IN',
  'CONTAINS', 'DOES NOT CONTAIN', 'CONTAINS WORDS', 'DOES NOT CONTAIN WORDS',
  'IS EMPTY', 'IS NOT EMPTY',
] as const;
export const NUMERIC_OPERATORS: readonly Operator[] = ['=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>='] as const;
export const LONGTEXT_OPERATORS: readonly Operator[] = [
  'CONTAINS', 'DOES NOT CONTAIN', 'CONTAINS WORDS', 'DOES NOT CONTAIN WORDS',
  'IS EMPTY', 'IS NOT EMPTY',
] as const;
export const IDENTITY_OPERATORS: readonly Operator[] = [
  '=', '<>', 'IN', 'NOT IN',
  'CONTAINS', 'DOES NOT CONTAIN',
  'IN GROUP', 'NOT IN GROUP',
  'EVER', 'WAS EVER',
  'IS EMPTY', 'IS NOT EMPTY',
] as const;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

/** Zod schema for { fieldRef } value shape used in field-to-field comparisons. */
export const FieldRefSchema = z.object({ fieldRef: z.string().min(1) });

/** Zod schema for the value of a FieldFilter — scalar, array, or fieldRef. */
export const FilterValueSchema = z.union([
  FieldRefSchema,
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
]);

const OPERATOR_ALIASES: Record<string, Operator> = {
  '!=': '<>',
  '==': '=',
};

function normalizeOperator(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const cleaned = v.trim().toUpperCase().replace(/\s+/g, ' ');
  return OPERATOR_ALIASES[cleaned] ?? cleaned;
}

export const OperatorSchema = z.preprocess(
  normalizeOperator,
  z.enum([
    '=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>=',
    'CONTAINS', 'DOES NOT CONTAIN', 'CONTAINS WORDS', 'DOES NOT CONTAIN WORDS',
    'IS EMPTY', 'IS NOT EMPTY',
    'UNDER', 'NOT UNDER',
    'EVER', 'WAS EVER',
    'IN GROUP', 'NOT IN GROUP',
  ])
);
