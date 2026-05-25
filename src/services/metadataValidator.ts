import type { AuthContext } from '../auth/authContext.js';
import type { FieldsClient } from '../ado/fieldsClient.js';
import type { LinkTypesClient } from '../ado/linkTypesClient.js';
import type { WorkItemTypesClient } from '../ado/workItemTypesClient.js';
import type { ReviewSource } from '../domain/reviewScope.js';
import type { FilterNode, FieldFilter } from '../domain/fieldFilter.js';

const CACHE_TTL_MS = 60 * 60 * 1_000;

export interface MetadataValidationInput {
  fields: string[];
  workItemTypes: string[];
  linkTypes: string[];
  project: string | undefined;
}

export type MetadataValidationResult =
  | { ok: true }
  | { ok: false; error: 'UNKNOWN_FIELD'; unknown: string[]; hint: string }
  | { ok: false; error: 'UNKNOWN_WORK_ITEM_TYPE'; unknown: string[]; hint: string }
  | { ok: false; error: 'UNKNOWN_LINK_TYPE'; unknown: string[]; hint: string };

interface NamesEntry {
  names: Set<string>;
  expiresAt: number;
}

interface FieldNamesEntry {
  refNames: Set<string>;
  displayNamesLower: Set<string>;
  expiresAt: number;
}

export class MetadataValidator {
  private fieldCache = new Map<string, FieldNamesEntry>();
  private witCache = new Map<string, NamesEntry>();
  private linkTypeCache: NamesEntry | null = null;

  constructor(
    private readonly fieldsClient: FieldsClient,
    private readonly linkTypesClient: LinkTypesClient,
    private readonly workItemTypesClient: WorkItemTypesClient,
    private readonly clock: () => number = Date.now,
  ) {}

  async validate(input: MetadataValidationInput, auth: AuthContext): Promise<MetadataValidationResult> {
    const now = this.clock();

    if (input.workItemTypes.length > 0 && input.project) {
      const witNames = await this.getWitNames(input.project, auth, now);
      const unknown = input.workItemTypes.filter((wit) => !witNames.has(wit));
      if (unknown.length > 0) {
        return { ok: false, error: 'UNKNOWN_WORK_ITEM_TYPE', unknown, hint: 'Use ado_discover_fields or check the project work item process to find valid types.' };
      }
    }

    if (input.linkTypes.length > 0) {
      const ltNames = await this.getLinkTypeNames(auth, now);
      const unknown = input.linkTypes.filter((lt) => !ltNames.has(lt));
      if (unknown.length > 0) {
        return { ok: false, error: 'UNKNOWN_LINK_TYPE', unknown, hint: 'Use ado_discover_link_types to list valid relation type reference names.' };
      }
    }

    if (input.fields.length > 0) {
      const { refNames: fieldRefNames, displayNamesLower: fieldDisplayNamesLower } = await this.getFieldNameSets(auth, now);
      const unknown = input.fields.filter((f) => !fieldRefNames.has(f) && !fieldDisplayNamesLower.has(f.toLowerCase()));
      if (unknown.length > 0) {
        return { ok: false, error: 'UNKNOWN_FIELD', unknown, hint: 'Use ado_discover_fields to list valid field reference names.' };
      }
    }


    return { ok: true };
  }

  private cacheKey(project: string | undefined, auth: AuthContext): string {
    if (auth.mode === 'per_request_pat' && auth.pat) {
      return `${project ?? '__no_project__'}|pat:${auth.pat.slice(-8)}`;
    }
    return `${project ?? '__no_project__'}|server:${auth.mode}`;
  }

  private async getWitNames(project: string, auth: AuthContext, now: number): Promise<Set<string>> {
    const key = this.cacheKey(project, auth);
    const entry = this.witCache.get(key);
    if (entry && now < entry.expiresAt) return entry.names;

    const types = await this.workItemTypesClient.listTypes(auth, project);
    const names = new Set(types.flatMap((t) => [t.name, t.referenceName]));
    this.witCache.set(key, { names, expiresAt: now + CACHE_TTL_MS });
    return names;
  }

  private async getLinkTypeNames(auth: AuthContext, now: number): Promise<Set<string>> {
    if (this.linkTypeCache && now < this.linkTypeCache.expiresAt) return this.linkTypeCache.names;

    const types = await this.linkTypesClient.listRelationTypes(auth);
    const names = new Set(types.map((t) => t.referenceName));
    this.linkTypeCache = { names, expiresAt: now + CACHE_TTL_MS };
    return names;
  }

  private async getFieldNameSets(auth: AuthContext, now: number): Promise<FieldNamesEntry> {
    const key = this.cacheKey(undefined, auth);
    const entry = this.fieldCache.get(key);
    if (entry && now < entry.expiresAt) return entry;

    const fields = await this.fieldsClient.listFields(auth);
    const refNames = new Set(fields.map((f) => f.referenceName));
    const displayNamesLower = new Set(fields.map((f) => f.name.toLowerCase()));
    const result: FieldNamesEntry = { refNames, displayNamesLower, expiresAt: now + CACHE_TTL_MS };
    this.fieldCache.set(key, result);
    return result;
  }
}

// ─── Identifier extraction ────────────────────────────────────────────────────

function collectFilterNodeFields(node: FilterNode, fields: Set<string>, workItemTypes: Set<string>): void {
  if (node.kind === 'condition') {
    fields.add(node.field);
    if (
      node.field === 'System.WorkItemType' &&
      (node.operator === '=' || node.operator === 'IN') &&
      node.value !== undefined
    ) {
      if (Array.isArray(node.value)) {
        (node.value as string[]).forEach((v) => { if (typeof v === 'string') workItemTypes.add(v); });
      } else if (typeof node.value === 'string') {
        workItemTypes.add(node.value);
      }
    }
  } else if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) collectFilterNodeFields(child, fields, workItemTypes);
  } else if (node.kind === 'not') {
    collectFilterNodeFields(node.node, fields, workItemTypes);
  }
}

function collectFlatFilterFields(filters: FieldFilter[], fields: Set<string>, workItemTypes: Set<string>): void {
  for (const f of filters) {
    fields.add(f.field);
    if (
      f.field === 'System.WorkItemType' &&
      (f.operator === '=' || f.operator === 'IN') &&
      f.value !== undefined
    ) {
      if (Array.isArray(f.value)) {
        (f.value as string[]).forEach((v) => { if (typeof v === 'string') workItemTypes.add(v); });
      } else if (typeof f.value === 'string') {
        workItemTypes.add(f.value);
      }
    }
  }
}

export function extractMetadataRefs(
  source: ReviewSource | undefined,
  extraFields?: string[],
  traceabilityLinkTokens?: string[],
): MetadataValidationInput {
  const fields = new Set<string>();
  const workItemTypes = new Set<string>();
  const linkTypes = new Set<string>();

  if (source) {
    if (source.type === 'fieldFilters') {
      if (source.filters) collectFlatFilterFields(source.filters, fields, workItemTypes);
      if (source.filterTree) collectFilterNodeFields(source.filterTree, fields, workItemTypes);
    } else if (source.type === 'linkQuery') {
      for (const lt of source.linkTypes ?? []) linkTypes.add(lt);
      if (source.sourceFilter) collectFilterNodeFields(source.sourceFilter, fields, workItemTypes);
      if (source.targetFilter) collectFilterNodeFields(source.targetFilter, fields, workItemTypes);
    } else if (source.type === 'linkedItems') {
      for (const rt of source.relationTypes ?? []) linkTypes.add(rt);
    }
  }

  for (const f of extraFields ?? []) fields.add(f);
  for (const lt of traceabilityLinkTokens ?? []) linkTypes.add(lt);

  return {
    fields: [...fields],
    workItemTypes: [...workItemTypes],
    linkTypes: [...linkTypes],
    project: undefined,
  };
}
