import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';

// ADO WIQL response — supports both flat (workItems) and link/tree (workItemRelations) query types
interface AdoWiqlResponse {
  queryType: string;
  queryResultType: string;
  workItems?: { id: number; url: string }[];
  workItemRelations?: {
    rel: string | null;
    source: { id: number; url: string } | null;
    target: { id: number; url: string } | null;
  }[];
  asOf?: string;
}

// Public interface — allows test doubles without depending on the concrete class
export interface IWiqlClient {
  execute(options: WiqlExecuteOptions): Promise<WiqlResult>;
}

export interface WiqlExecuteOptions {
  project: string;
  wiql: string;
  auth: AuthContext;
  top?: number;
}

export interface WiqlResult {
  ids: number[];
  sourceIds: number[];
  targetIds: number[];
  totalMatched: number;
  queryType: string;
  // ADO WIQL hard ceiling: server returns at most 20000 ids per query regardless of scope size.
  wiqlMaybeTruncated: boolean;
}

export class WiqlClient implements IWiqlClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async execute(options: WiqlExecuteOptions): Promise<WiqlResult> {
    const { project, wiql, auth, top } = options;
    const url = `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/wiql`;

    const params: Record<string, string | number> = {
      'api-version': this.config.adoApiVersion,
    };
    // Cap WIQL results to avoid huge ID lists; callers can pass top=undefined for no cap
    if (top !== undefined) params['$top'] = top;

    this.logger.debug({ project, url }, 'Executing WIQL');

    const response = await this.client.request<AdoWiqlResponse>({
      method: 'POST',
      url,
      auth,
      params,
      data: { query: wiql },
      apiVersionFallback: true,
    });

    const extracted = extractIds(response);
    const result: WiqlResult = {
      ids: extracted.allIds,
      sourceIds: extracted.sourceIds,
      targetIds: extracted.targetIds,
      totalMatched: extracted.allIds.length,
      queryType: response.queryType ?? 'unknown',
      wiqlMaybeTruncated: extracted.allIds.length === 20000,
    };

    this.logger.debug({ totalMatched: result.totalMatched, queryType: result.queryType }, 'WIQL complete');
    return result;
  }
}

interface ExtractedIds {
  allIds: number[];
  sourceIds: number[];
  targetIds: number[];
}

function extractIds(response: AdoWiqlResponse): ExtractedIds {
  // Flat query — no source/target distinction
  if (response.workItems && response.workItems.length > 0) {
    const ids = response.workItems.map((wi) => wi.id);
    return { allIds: ids, sourceIds: ids, targetIds: [] };
  }
  // Link/tree query — preserve source and target separately
  if (response.workItemRelations) {
    const sources = new Set<number>();
    const targets = new Set<number>();
    for (const rel of response.workItemRelations) {
      if (rel.source?.id) sources.add(rel.source.id);
      if (rel.target?.id) targets.add(rel.target.id);
    }
    const all = new Set<number>([...sources, ...targets]);
    return {
      allIds: Array.from(all),
      sourceIds: Array.from(sources),
      targetIds: Array.from(targets),
    };
  }
  return { allIds: [], sourceIds: [], targetIds: [] };
}
