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
  | 'UNDER'
  | 'NOT UNDER';

export interface FieldFilter {
  field: string;
  operator: Operator;
  value: string | number | boolean | string[] | number[];
}

export interface OrderBy {
  field: string;
  direction: 'ASC' | 'DESC';
}

export const ALL_OPERATORS: readonly Operator[] = [
  '=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>=', 'CONTAINS', 'UNDER', 'NOT UNDER',
] as const;

export const TREEPATH_OPERATORS: readonly Operator[] = ['=', '<>', 'UNDER', 'NOT UNDER'] as const;
export const STRING_OPERATORS: readonly Operator[] = ['=', '<>', 'IN', 'NOT IN', 'CONTAINS'] as const;
export const NUMERIC_OPERATORS: readonly Operator[] = ['=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>='] as const;
export const LONGTEXT_OPERATORS: readonly Operator[] = ['CONTAINS'] as const;
