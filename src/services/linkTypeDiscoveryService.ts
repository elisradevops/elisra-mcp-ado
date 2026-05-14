import type { LinkTypesClient } from '../ado/linkTypesClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AdoDiscoverLinkTypesOutput } from '../types/mcp.js';
import type { AdoWorkItemRelationType } from '../types/ado.js';
import {
  buildSeedLinkTypes,
  LINK_TYPE_SEMANTIC_HINTS,
  NON_WI_RELATION_TYPES,
} from '../domain/adoLinkTypes.js';
import type { SeedLinkType } from '../domain/adoLinkTypes.js';

const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

export interface LinkTypeInfo {
  referenceName: string;
  name: string;
  usage: string;
  isWorkItemLink: boolean;
  isCustom: boolean;
  knownInDocGen: boolean;
  semanticHint?: string;
  source: 'discovered' | 'seed' | 'both';
}

interface CacheEntry {
  catalog: Map<string, LinkTypeInfo>;
  expiresAt: number;
}

export interface DiscoverLinkTypesOptions {
  auth: AuthContext;
  includeAll?: boolean;
  refresh?: boolean;
}

function isCustomRef(referenceName: string): boolean {
  return referenceName.startsWith('Custom.') || referenceName.startsWith('Elisra.');
}

function mergeCatalogs(
  discovered: AdoWorkItemRelationType[],
  seed: SeedLinkType[]
): Map<string, LinkTypeInfo> {
  const catalog = new Map<string, LinkTypeInfo>();

  for (const s of seed) {
    catalog.set(s.referenceName, {
      referenceName: s.referenceName,
      name: s.name,
      usage: s.usage,
      isWorkItemLink: s.isWorkItemLink,
      isCustom: s.isCustom,
      knownInDocGen: s.knownInDocGen,
      semanticHint: s.semanticHint,
      source: 'seed',
    });
  }

  for (const d of discovered) {
    const existing = catalog.get(d.referenceName);
    const usage = d.attributes?.usage ?? 'resourceLink';
    // NON_WI_RELATION_TYPES is authoritative — overrides ADO's usage when attributes absent
    const isWorkItemLink = usage === 'workItemLink' && !NON_WI_RELATION_TYPES.has(d.referenceName);
    const info: LinkTypeInfo = {
      referenceName: d.referenceName,
      name: d.name,
      usage,
      isWorkItemLink,
      isCustom: isCustomRef(d.referenceName),
      knownInDocGen: existing?.knownInDocGen ?? false,
      semanticHint: LINK_TYPE_SEMANTIC_HINTS[d.referenceName] ?? existing?.semanticHint,
      source: existing ? 'both' : 'discovered',
    };
    catalog.set(d.referenceName, info);
  }

  return catalog;
}

export class LinkTypeDiscoveryService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly client: LinkTypesClient,
    private readonly clock: () => number = Date.now
  ) {}

  async discover(options: DiscoverLinkTypesOptions): Promise<AdoDiscoverLinkTypesOutput> {
    const { auth, includeAll = false, refresh = false } = options;

    const cacheKey = 'collection';
    const now = this.clock();

    if (!refresh) {
      const entry = this.cache.get(cacheKey);
      if (entry && now < entry.expiresAt) {
        return this.buildOutput(entry.catalog, includeAll, 'discovered', []);
      }
    }

    const raw = await this.client.listRelationTypes(auth);
    const seed = buildSeedLinkTypes();
    const catalog = mergeCatalogs(raw, seed);
    this.cache.set(cacheKey, { catalog, expiresAt: now + CACHE_TTL_MS });

    return this.buildOutput(catalog, includeAll, 'discovered', []);
  }

  buildSeedFallback(errorMessage: string, includeAll = false): AdoDiscoverLinkTypesOutput {
    const seed = buildSeedLinkTypes();
    const catalog = new Map<string, LinkTypeInfo>();
    for (const s of seed) {
      catalog.set(s.referenceName, { ...s, source: 'seed' });
    }
    return this.buildOutput(catalog, includeAll, 'seed_fallback', [
      `Link type discovery failed: ${errorMessage}. Returning seed catalog (${catalog.size} entries).`,
    ]);
  }

  private buildOutput(
    catalog: Map<string, LinkTypeInfo>,
    includeAll: boolean,
    source: 'discovered' | 'seed_fallback',
    warnings: string[]
  ): AdoDiscoverLinkTypesOutput {
    let items = Array.from(catalog.values());

    if (!includeAll) {
      items = items.filter((lt) => lt.isWorkItemLink);
    }

    items.sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
      return a.referenceName.localeCompare(b.referenceName);
    });

    return {
      totalLinkTypes: items.length,
      source,
      linkTypes: items.map((lt) => ({
        referenceName: lt.referenceName,
        name: lt.name,
        usage: lt.usage,
        isWorkItemLink: lt.isWorkItemLink,
        isCustom: lt.isCustom,
        knownInDocGen: lt.knownInDocGen,
        ...(lt.semanticHint !== undefined ? { semanticHint: lt.semanticHint } : {}),
        source: lt.source,
      })),
      warnings,
    };
  }

  invalidate(): void {
    this.cache.clear();
  }

  getCachedCount(): number {
    return this.cache.size;
  }
}
