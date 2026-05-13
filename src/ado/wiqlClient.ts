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
  totalMatched: number;
  queryType: string;
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
    });

    const ids = extractIds(response);
    const result: WiqlResult = {
      ids,
      totalMatched: ids.length,
      queryType: response.queryType ?? 'unknown',
    };

    this.logger.debug({ totalMatched: result.totalMatched, queryType: result.queryType }, 'WIQL complete');
    return result;
  }
}

function extractIds(response: AdoWiqlResponse): number[] {
  // Flat query
  if (response.workItems && response.workItems.length > 0) {
    return response.workItems.map((wi) => wi.id);
  }
  // Link/tree query — extract all unique IDs from source + target
  if (response.workItemRelations) {
    const seen = new Set<number>();
    for (const rel of response.workItemRelations) {
      if (rel.source?.id) seen.add(rel.source.id);
      if (rel.target?.id) seen.add(rel.target.id);
    }
    return Array.from(seen);
  }
  return [];
}
