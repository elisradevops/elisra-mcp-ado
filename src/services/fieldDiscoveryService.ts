import type { FieldsClient } from '../ado/fieldsClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { FieldInfo, FieldType } from '../domain/adoFields.js';
import { buildSeedCatalog } from '../domain/adoFields.js';
import {
  TREEPATH_OPERATORS,
  STRING_OPERATORS,
  NUMERIC_OPERATORS,
  LONGTEXT_OPERATORS,
} from '../domain/fieldFilter.js';
import type { Operator } from '../domain/fieldFilter.js';
import { CaseInsensitiveMap } from '../utils/caseInsensitiveMap.js';
import type { AdoFieldDefinition } from '../types/ado.js';

const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

interface CacheEntry {
  catalog: CaseInsensitiveMap<FieldInfo>;
  expiresAt: number;
}

export interface DiscoverOptions {
  auth: AuthContext;
  project?: string;
  workItemType?: string;
  refresh?: boolean;
}

// ADO type strings → our FieldType (they are identical; this is a safety cast)
const ADO_TYPE_MAP: Record<string, FieldType> = {
  string: 'string',
  integer: 'integer',
  double: 'double',
  dateTime: 'dateTime',
  boolean: 'boolean',
  plainText: 'plainText',
  html: 'html',
  treePath: 'treePath',
  identity: 'identity',
  guid: 'guid',
};

function mapType(raw: string): FieldType {
  return ADO_TYPE_MAP[raw] ?? 'string';
}

function deriveOperators(type: FieldType, isTreePath: boolean, isLongText: boolean): readonly Operator[] {
  if (isTreePath) return TREEPATH_OPERATORS;
  if (isLongText) return LONGTEXT_OPERATORS;
  if (type === 'integer' || type === 'double' || type === 'dateTime') return NUMERIC_OPERATORS;
  if (type === 'boolean') return ['=', '<>'] as const;
  return STRING_OPERATORS;
}

function safeForFilteringDefault(type: FieldType): boolean {
  // html/plainText fields can contain unlimited content — unsafe by default
  return type !== 'html' && type !== 'plainText';
}

function safeForGroupingDefault(type: FieldType): boolean {
  return type === 'string' || type === 'integer' || type === 'boolean' || type === 'identity' || type === 'treePath';
}

function adoFieldToInfo(f: AdoFieldDefinition): FieldInfo {
  const type = mapType(f.type);
  const isTreePath = type === 'treePath';
  const isLongText = type === 'html' || type === 'plainText';
  const isIdentity = type === 'identity' || (f.isIdentity ?? false);
  const isCustom = f.referenceName.startsWith('Custom.') || f.referenceName.startsWith('Elisra.');

  return {
    referenceName: f.referenceName,
    displayName: f.name,
    type,
    isCustom,
    isIdentity,
    isLongText,
    isTreePath,
    allowedOperators: deriveOperators(type, isTreePath, isLongText),
    knownInDocGen: false,
    safeForFiltering: safeForFilteringDefault(type),
    safeForGrouping: safeForGroupingDefault(type),
    source: 'discovered',
  };
}

/**
 * Merges ADO-discovered fields with the seed catalog.
 * - Discovered fields override seed entries (canonical ref + type from ADO).
 * - Seed hints (knownInDocGen, safeForFiltering, safeForGrouping) are preserved
 *   for fields present in both catalogs, since ADO doesn't return these.
 * - Seed-only fields remain in the catalog (source: 'seed').
 */
function mergeCatalogs(
  discovered: AdoFieldDefinition[],
  seed: CaseInsensitiveMap<FieldInfo>
): CaseInsensitiveMap<FieldInfo> {
  const merged = CaseInsensitiveMap.fromEntries(seed.entries());

  for (const rawField of discovered) {
    const info = adoFieldToInfo(rawField);
    const seedEntry = seed.get(rawField.referenceName);
    if (seedEntry) {
      // Preserve DocGen-aligned hints from seed
      info.knownInDocGen = seedEntry.knownInDocGen;
      info.safeForFiltering = seedEntry.safeForFiltering;
      info.safeForGrouping = seedEntry.safeForGrouping;
    }
    merged.set(info.referenceName, info);
  }

  return merged;
}

export class FieldDiscoveryService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fieldsClient: FieldsClient,
    private readonly clock: () => number = Date.now
  ) {}

  async discover(options: DiscoverOptions): Promise<CaseInsensitiveMap<FieldInfo>> {
    const { auth, project, workItemType, refresh = false } = options;

    // Cache key: collection-level (not per-project or per-PAT)
    // WIT-scoped results are NOT cached separately — we cache the full collection catalog
    // and post-filter by WIT ref names when workItemType is specified.
    const cacheKey = 'collection';
    const now = this.clock();

    if (!refresh) {
      const entry = this.cache.get(cacheKey);
      if (entry && now < entry.expiresAt) {
        if (workItemType && project) {
          return this.filterByWorkItemType(entry.catalog, auth, project, workItemType);
        }
        return entry.catalog;
      }
    }

    const rawFields = await this.fieldsClient.listFields(auth);
    const seed = buildSeedCatalog();
    const catalog = mergeCatalogs(rawFields, seed);

    this.cache.set(cacheKey, { catalog, expiresAt: now + CACHE_TTL_MS });

    if (workItemType && project) {
      return this.filterByWorkItemType(catalog, auth, project, workItemType);
    }
    return catalog;
  }

  private async filterByWorkItemType(
    fullCatalog: CaseInsensitiveMap<FieldInfo>,
    auth: AuthContext,
    project: string,
    workItemType: string
  ): Promise<CaseInsensitiveMap<FieldInfo>> {
    const witFields = await this.fieldsClient.listWorkItemTypeFields(auth, project, workItemType);
    const witRefs = new Set(witFields.map((f) => f.referenceName.toLowerCase()));

    const filtered = new CaseInsensitiveMap<FieldInfo>();
    for (const [ref, info] of fullCatalog.entries()) {
      if (witRefs.has(ref.toLowerCase())) {
        filtered.set(ref, info);
      }
    }
    return filtered;
  }

  invalidate(): void {
    this.cache.clear();
  }

  getCachedCount(): number {
    return this.cache.size;
  }
}
