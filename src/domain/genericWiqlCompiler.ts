import type { FieldFilter, FilterNode, FilterValue, OrderBy } from './fieldFilter.js';
import type { FieldInfo } from './adoFields.js';
import type { CaseInsensitiveMap } from '../utils/caseInsensitiveMap.js';
import { formatScalarValue, formatArrayValue, formatAsOf, getMacroMinApiVersion } from './wiqlEscape.js';
import { parseApiMajor } from '../ado/apiVersionLadder.js';

export interface CompileOptions {
  project?: string;
  /** Flat filter list — treated as implicit AND root. Ignored when filterTree is provided. */
  filters?: FieldFilter[];
  /** Explicit filter tree (OR/NOT/grouping). Wins over filters when both supplied. */
  filterTree?: FilterNode;
  orderBy?: OrderBy[];
  /** ASOF clause — ISO date (2025-01-01) or WIQL macro (@Today - 7d). Emitted between WHERE and ORDER BY. */
  asOf?: string;
  /** Override default "SELECT [System.Id] FROM WorkItems" preamble. Used by link queries. */
  _selectFrom?: string;
}

export type LinkQueryMode = 'MustContain' | 'MayContain' | 'DoesNotContain' | 'Recursive';

export interface LinkQueryOptions {
  project?: string;
  sourceFilter?: FilterNode;
  targetFilter?: FilterNode;
  linkTypes?: string[];
  mode: LinkQueryMode;
  orderBy?: OrderBy[];
  asOf?: string;
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
    private readonly allowUnknownFields: boolean,
    private readonly adoApiVersion: string = '7.0'
  ) {}

  private warnMacro(rawValue: string, warnings: string[]): void {
    const trimmed = rawValue.trim();
    if (!trimmed.startsWith('@')) return;
    const name = trimmed.replace(/^@/, '').split(/[\s(+-]/)[0];
    const minVersion = getMacroMinApiVersion(name);
    if (!minVersion) return;
    if (parseApiMajor(this.adoApiVersion) < parseApiMajor(minVersion)) {
      warnings.push(
        `WIQL macro "@${name}" requires ADO Server 2019+ (api-version ${minVersion}). ` +
        `Configured ADO_API_VERSION="${this.adoApiVersion}" may not accept it. See docs/onprem-ado.md.`
      );
    }
  }

  compile(options: CompileOptions): CompileResult {
    const { project, filters, filterTree, orderBy, asOf, _selectFrom = 'SELECT [System.Id] FROM WorkItems' } = options;
    const warnings: string[] = [];

    const clauses: string[] = [];

    // Project clause always first — uses @project macro so ADO resolves it
    if (project) {
      clauses.push('[System.TeamProject] = @project');
    }

    // Warn when caller supplies both — filterTree wins, filters are discarded
    if (filterTree && filters?.length) {
      warnings.push('Both filters and filterTree were provided; filterTree takes precedence and filters were ignored.');
    }

    // Filter clauses — filterTree wins when present
    if (filterTree) {
      // Top-level AND: flatten children into separate clauses (no outer parens)
      if (filterTree.kind === 'and') {
        for (const child of filterTree.nodes) {
          clauses.push(this.buildNode(child, warnings));
        }
      } else {
        clauses.push(this.buildNode(filterTree, warnings));
      }
    } else {
      for (const filter of (filters ?? [])) {
        clauses.push(this.compileFilter(filter, warnings));
      }
    }

    const whereSection =
      clauses.length > 0 ? `WHERE ${clauses.join('\n  AND ')}` : '';

    if (asOf) this.warnMacro(asOf, warnings);
    const asOfSection = asOf ? `ASOF ${formatAsOf(asOf)}` : '';

    const orderSection =
      orderBy && orderBy.length > 0
        ? `ORDER BY ${validateAndFormatOrderBy(orderBy)}`
        : '';

    const parts = [_selectFrom, whereSection, asOfSection, orderSection].filter(Boolean);
    const wiql = parts.join('\n');

    if (wiql.length > 32_000) {
      warnings.push(
        `Generated WIQL is ${wiql.length} chars; server limit is 32 768. Tighten filters or split the query.`
      );
    }

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
      if (typeof value === 'string') this.warnMacro(value, warnings);
      return buildClause(canonicalField, operator, value, 'string', this.catalog);
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

    if (typeof value === 'string') this.warnMacro(value, warnings);
    return buildClause(canonicalField, operator, value, fieldInfo.type, this.catalog);
  }

  private buildNode(node: FilterNode, warnings: string[]): string {
    switch (node.kind) {
      case 'condition':
        return this.compileFilter({ field: node.field, operator: node.operator, value: node.value }, warnings);
      case 'and':
        return `(${node.nodes.map(n => this.buildNode(n, warnings)).join(' AND ')})`;
      case 'or':
        return `(${node.nodes.map(n => this.buildNode(n, warnings)).join(' OR ')})`;
      case 'not':
        return `NOT (${this.buildNode(node.node, warnings)})`;
    }
  }

  // ─── Link query compilation ──────────────────────────────────────────────────

  compileLinkQuery(options: LinkQueryOptions): CompileResult {
    const { project, sourceFilter, targetFilter, linkTypes, mode, orderBy, asOf } = options;
    const warnings: string[] = [];

    if (!sourceFilter && !targetFilter && !linkTypes?.length) {
      throw new Error('linkQuery requires at least one of sourceFilter, targetFilter, or linkTypes.');
    }

    if (mode === 'Recursive') {
      if (orderBy?.length) throw new Error('ORDER BY is not allowed with MODE (Recursive) in link queries.');
      if (asOf) throw new Error('ASOF is not allowed with MODE (Recursive) in link queries.');
    }

    const clauses: string[] = [];

    if (project) {
      clauses.push('([Source].[System.TeamProject] = @project)');
    }
    if (sourceFilter) {
      clauses.push(this.buildLinkNode(sourceFilter, warnings, 'Source'));
    }
    if (linkTypes?.length) {
      const expr = linkTypes.length === 1
        ? `[System.Links.LinkType] = ${formatScalarValue(linkTypes[0])}`
        : `[System.Links.LinkType] IN ${formatArrayValue(linkTypes)}`;
      clauses.push(expr);
    }
    if (targetFilter) {
      clauses.push(this.buildLinkNode(targetFilter, warnings, 'Target'));
    }

    const whereSection = clauses.length > 0 ? `WHERE ${clauses.join('\n  AND ')}` : '';
    if (asOf) this.warnMacro(asOf, warnings);
    const asOfSection = asOf ? `ASOF ${formatAsOf(asOf)}` : '';
    const orderSection = orderBy?.length
      ? `ORDER BY ${validateAndFormatOrderBy(orderBy)}`
      : '';
    const modeSection = `MODE (${mode})`;

    const parts = ['SELECT [System.Id] FROM WorkItemLinks', whereSection, asOfSection, orderSection, modeSection].filter(Boolean);
    const wiql = parts.join('\n');

    if (wiql.length > 32_000) {
      warnings.push(
        `Generated WIQL is ${wiql.length} chars; server limit is 32 768. Tighten filters or split the query.`
      );
    }

    return { wiql, warnings };
  }

  private buildLinkNode(node: FilterNode, warnings: string[], prefix: 'Source' | 'Target'): string {
    switch (node.kind) {
      case 'condition':
        return this.compileLinkFilter(node.field, node.operator, node.value, warnings, prefix);
      case 'and':
        return `(${node.nodes.map(n => this.buildLinkNode(n, warnings, prefix)).join(' AND ')})`;
      case 'or':
        return `(${node.nodes.map(n => this.buildLinkNode(n, warnings, prefix)).join(' OR ')})`;
      case 'not':
        return `NOT (${this.buildLinkNode(node.node, warnings, prefix)})`;
    }
  }

  private compileLinkFilter(
    inputField: string,
    operator: string,
    value: FilterValue | undefined,
    warnings: string[],
    prefix: 'Source' | 'Target'
  ): string {
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
    }

    // WAS / WAS EVER are only valid in flat FROM WorkItems queries — ADO rejects them in link queries
    if (operator === 'WAS' || operator === 'WAS EVER') {
      throw new Error(
        `Operator "${operator}" is not supported in link queries. ` +
        `WAS and WAS EVER are only valid in flat WorkItems queries.`
      );
    }

    if (fieldInfo) {
      if (fieldInfo.isTreePath && operator === 'CONTAINS') {
        throw new Error(
          `CONTAINS is not supported for TreePath field "${canonicalField}". Use UNDER, NOT UNDER, =, or <> instead.`
        );
      }
      if (!(fieldInfo.allowedOperators as readonly string[]).includes(operator)) {
        const allowed = fieldInfo.allowedOperators.join(', ');
        throw new Error(
          `Operator "${operator}" is not valid for field "${canonicalField}" ` +
          `(type: ${fieldInfo.type}). Allowed: ${allowed}.`
        );
      }
    }

    if (typeof value === 'string') this.warnMacro(value, warnings);
    const fieldExpr = `[${prefix}].[${canonicalField}]`;
    return buildValueClause(fieldExpr, operator, value, fieldInfo?.type ?? 'string', this.catalog);
  }
}

// ─── Clause builder ───────────────────────────────────────────────────────────

type FieldTypeHint = 'string' | 'integer' | 'double' | 'dateTime' | 'boolean' | 'plainText' | 'html' | 'treePath' | 'identity' | 'guid';

const FIELD_TO_FIELD_OPERATORS = new Set(['=', '<>', '<', '<=', '>', '>=']);

function isFieldRef(v: FilterValue): v is { fieldRef: string } {
  return typeof v === 'object' && !Array.isArray(v) && 'fieldRef' in v;
}

/** Shared value-formatting logic for both flat and link-query clause builders. */
function buildValueClause(
  fieldExpr: string,
  operator: string,
  value: FilterValue | undefined,
  typeHint: FieldTypeHint,
  catalog?: { get: (k: string) => unknown; getCanonicalKey: (k: string) => string | undefined }
): string {
  if (operator === 'IS EMPTY' || operator === 'IS NOT EMPTY') {
    return `${fieldExpr} ${operator}`;
  }

  if (value === undefined || value === null) {
    throw new Error(
      `Operator "${operator}" requires a value for field "${fieldExpr}". ` +
      `Only IS EMPTY and IS NOT EMPTY can be used without a value.`
    );
  }

  if (isFieldRef(value)) {
    if (!FIELD_TO_FIELD_OPERATORS.has(operator)) {
      throw new Error(
        `Operator "${operator}" does not support field-to-field comparison for field "${fieldExpr}". ` +
        `Allowed operators for field refs: ${[...FIELD_TO_FIELD_OPERATORS].join(', ')}.`
      );
    }
    const refName = value.fieldRef;
    if (!refName.trim()) {
      throw new Error(`fieldRef must be a non-empty field reference name for field "${fieldExpr}".`);
    }
    if (/[[\]]/.test(refName)) {
      throw new Error(`fieldRef contains illegal bracket characters: "${refName}"`);
    }
    const canonicalRef = catalog?.getCanonicalKey(refName) ?? refName;
    return `${fieldExpr} ${operator} [${canonicalRef}]`;
  }

  if (operator === 'IN' || operator === 'NOT IN') {
    if (!Array.isArray(value)) {
      value = [value as string | number] as string[] | number[];
    }
    const arr = value as string[] | number[];
    return `${fieldExpr} ${operator} ${formatArrayValue(arr)}`;
  }

  if (Array.isArray(value)) {
    throw new Error(
      `Operator "${operator}" requires a scalar value for field "${fieldExpr}", not an array. ` +
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

function buildClause(
  canonicalField: string,
  operator: string,
  value: FilterValue | undefined,
  typeHint: FieldTypeHint,
  catalog?: { get: (k: string) => unknown; getCanonicalKey: (k: string) => string | undefined }
): string {
  if (/[[\]]/.test(canonicalField)) {
    throw new Error(`Field name contains illegal bracket characters: "${canonicalField}"`);
  }
  return buildValueClause(`[${canonicalField}]`, operator, value, typeHint, catalog);
}

function validateAndFormatOrderBy(orderBy: OrderBy[]): string {
  for (const o of orderBy) {
    if (!/^[A-Za-z0-9_.]+$/.test(o.field)) {
      throw new Error(`Invalid ORDER BY field: "${o.field}". Only alphanumeric, dot, and underscore characters are allowed.`);
    }
    if (o.direction !== 'ASC' && o.direction !== 'DESC') {
      throw new Error(`Invalid ORDER BY direction: "${o.direction}". Must be ASC or DESC.`);
    }
  }
  return orderBy.map((o) => `[${o.field}] ${o.direction}`).join(', ');
}

// ─── Factory ──────────────────────────────────────────────────────────────────

import { SEED_FIELD_CATALOG } from './adoFields.js';

/**
 * Create a compiler backed by the seed catalog.
 * Phase 5 overrides this with a discovered catalog per ADO collection.
 */
export function createDefaultCompiler(allowUnknownFields: boolean, adoApiVersion = '7.0'): GenericWiqlCompiler {
  return new GenericWiqlCompiler(SEED_FIELD_CATALOG, allowUnknownFields, adoApiVersion);
}
