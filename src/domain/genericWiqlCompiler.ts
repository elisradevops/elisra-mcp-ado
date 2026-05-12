import type { FieldFilter, OrderBy } from './fieldFilter.js';
import type { FieldInfo } from './adoFields.js';
import type { CaseInsensitiveMap } from '../utils/caseInsensitiveMap.js';
import { formatScalarValue, formatArrayValue } from './wiqlEscape.js';

export interface CompileOptions {
  project?: string;
  filters: FieldFilter[];
  orderBy?: OrderBy[];
}

export interface CompileResult {
  wiql: string;
  warnings: string[];
}

/**
 * The only module allowed to build WIQL from FieldFilter[].
 * Enforces field/operator validation and TreePath restrictions.
 *
 * Tools must call this class; they must not concatenate WIQL strings manually.
 */
export class GenericWiqlCompiler {
  constructor(
    private readonly catalog: CaseInsensitiveMap<FieldInfo>,
    private readonly allowUnknownFields: boolean
  ) {}

  compile(options: CompileOptions): CompileResult {
    const { project, filters, orderBy } = options;
    const warnings: string[] = [];

    const clauses: string[] = [];

    // Project clause always first — uses @project macro so ADO resolves it
    if (project) {
      clauses.push('[System.TeamProject] = @project');
    }

    // Filter clauses
    for (const filter of filters) {
      const clause = this.compileFilter(filter, warnings);
      clauses.push(clause);
    }

    const whereSection =
      clauses.length > 0 ? `WHERE ${clauses.join('\n  AND ')}` : '';

    if (orderBy) {
      for (const o of orderBy) {
        if (!/^[A-Za-z0-9_.]+$/.test(o.field)) {
          throw new Error(`Invalid ORDER BY field: "${o.field}". Only alphanumeric, dot, and underscore characters are allowed.`);
        }
        if (o.direction !== 'ASC' && o.direction !== 'DESC') {
          throw new Error(`Invalid ORDER BY direction: "${o.direction}". Must be ASC or DESC.`);
        }
      }
    }

    const orderSection =
      orderBy && orderBy.length > 0
        ? `ORDER BY ${orderBy.map((o) => `[${o.field}] ${o.direction}`).join(', ')}`
        : '';

    const parts = ['SELECT [System.Id] FROM WorkItems', whereSection, orderSection].filter(Boolean);
    const wiql = parts.join('\n');

    return { wiql, warnings };
  }

  private compileFilter(filter: FieldFilter, warnings: string[]): string {
    const { field: inputField, operator, value } = filter;

    // Resolve canonical field name from catalog
    const fieldInfo = this.catalog.get(inputField);
    const canonicalField = this.catalog.getCanonicalKey(inputField) ?? inputField;

    if (!fieldInfo) {
      if (!this.allowUnknownFields) {
        throw new Error(
          `Unknown field "${inputField}". ` +
          `Use ado_discover_fields to see available fields, or set ADO_ALLOW_UNKNOWN_FIELDS=true to bypass validation.`
        );
      }
      warnings.push(
        `Field "${inputField}" is not in the known field catalog — treating as string. ` +
        `Run ado_discover_fields to verify it exists in this collection.`
      );
      // Unknown field: treat as string, validate operator loosely
      return buildClause(canonicalField, operator, value, 'string');
    }

    // CONTAINS on TreePath is silently broken in ADO — reject it explicitly before generic validation
    if (fieldInfo.isTreePath && operator === 'CONTAINS') {
      throw new Error(
        `CONTAINS is not supported for TreePath field "${canonicalField}". ` +
        `Use UNDER, NOT UNDER, =, or <> instead.`
      );
    }

    // Operator validation
    if (!(fieldInfo.allowedOperators as readonly string[]).includes(operator)) {
      const allowed = fieldInfo.allowedOperators.join(', ');
      throw new Error(
        `Operator "${operator}" is not valid for field "${canonicalField}" ` +
        `(type: ${fieldInfo.type}). Allowed: ${allowed}.`
      );
    }

    return buildClause(canonicalField, operator, value, fieldInfo.type);
  }
}

// ─── Clause builder ───────────────────────────────────────────────────────────

type FieldTypeHint = 'string' | 'integer' | 'double' | 'dateTime' | 'boolean' | 'plainText' | 'html' | 'treePath' | 'identity' | 'guid';

function buildClause(
  canonicalField: string,
  operator: string,
  value: FieldFilter['value'],
  typeHint: FieldTypeHint
): string {
  if (/[[\]]/.test(canonicalField)) {
    throw new Error(`Field name contains illegal bracket characters: "${canonicalField}"`);
  }
  const fieldExpr = `[${canonicalField}]`;

  if (operator === 'IN' || operator === 'NOT IN') {
    if (!Array.isArray(value)) {
      // Wrap scalar in array with a note — permissive for UX
      value = [value as string | number] as string[] | number[];
    }
    const arr = value as string[] | number[];
    return `${fieldExpr} ${operator} ${formatArrayValue(arr)}`;
  }

  if (Array.isArray(value)) {
    throw new Error(
      `Operator "${operator}" requires a scalar value for field "${canonicalField}", not an array. ` +
      `Use IN or NOT IN for multi-value filters.`
    );
  }

  const scalar = value as string | number | boolean;
  const formatted =
    typeHint === 'boolean'
      ? scalar === true || scalar === 'true' || scalar === 'True' ? 'True' : 'False'
      : formatScalarValue(scalar);

  return `${fieldExpr} ${operator} ${formatted}`;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

import { SEED_FIELD_CATALOG } from './adoFields.js';

/**
 * Create a compiler backed by the seed catalog.
 * Phase 5 overrides this with a discovered catalog per ADO collection.
 */
export function createDefaultCompiler(allowUnknownFields: boolean): GenericWiqlCompiler {
  return new GenericWiqlCompiler(SEED_FIELD_CATALOG, allowUnknownFields);
}
