import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoWorkItem, AdoWorkItemsBatchResponse } from '../types/ado.js';
import { parseApiMajor } from './apiVersionLadder.js';

export type WorkItemExpand = 'none' | 'relations' | 'all';

export interface IWorkItemsClient {
  fetchBatch(ids: number[], auth: AuthContext, fields?: string[], expand?: WorkItemExpand): Promise<AdoWorkItem[]>;
  fetchSingle(id: number, auth: AuthContext, expand?: WorkItemExpand): Promise<AdoWorkItem>;
}

export class WorkItemsClient implements IWorkItemsClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  private isPreBatchTfs(): boolean {
    // POST workitemsbatch requires api-version 5.0+ (ADO Server 2019+).
    // TFS 2018 max is 4.x — use GET /_apis/wit/workitems?ids=... instead.
    const major = parseApiMajor(this.config.adoApiVersion);
    return Number.isFinite(major) && major < 5;
  }

  async fetchBatch(
    ids: number[],
    auth: AuthContext,
    fields?: string[],
    expand?: WorkItemExpand
  ): Promise<AdoWorkItem[]> {
    if (ids.length === 0) return [];
    if (ids.length > 200) {
      throw new RangeError(`fetchBatch: ADO workitemsbatch limit is 200 IDs, got ${ids.length}. Use WorkItemService.fetchMany to batch automatically.`);
    }

    if (this.isPreBatchTfs()) {
      // TFS 2018 path: GET /_apis/wit/workitems?ids=1,2,3[&fields=...][&$expand=...]
      const url = `${this.config.adoOrgUrl}/_apis/wit/workitems`;
      const params: Record<string, string> = {
        ids: ids.join(','),
        'api-version': this.config.adoApiVersion,
      };
      if (fields && fields.length > 0) params['fields'] = fields.join(',');
      if (expand && expand !== 'none') params['$expand'] = expand;

      const response = await this.client.request<AdoWorkItemsBatchResponse>({
        method: 'GET',
        url,
        auth,
        params,
        apiVersionFallback: true,
      });
      return response.value ?? [];
    }

    // 5.0+ path: POST /_apis/wit/workitemsbatch
    const url = `${this.config.adoOrgUrl}/_apis/wit/workitemsbatch`;
    const params: Record<string, string> = {
      'api-version': this.config.adoApiVersion,
    };
    if (expand && expand !== 'none') {
      params['$expand'] = expand;
    }

    const body: Record<string, unknown> = { ids, errorPolicy: 'omit' };
    if (fields && fields.length > 0) {
      body['fields'] = fields;
    }

    const response = await this.client.request<AdoWorkItemsBatchResponse>({
      method: 'POST',
      url,
      auth,
      params,
      data: body,
      apiVersionFallback: true,
    });
    return response.value ?? [];
  }

  async fetchSingle(id: number, auth: AuthContext, expand?: WorkItemExpand): Promise<AdoWorkItem> {
    const url = `${this.config.adoOrgUrl}/_apis/wit/workitems/${id}`;
    const params: Record<string, string | number> = {
      'api-version': this.config.adoApiVersion,
    };
    if (expand && expand !== 'none') {
      params['$expand'] = expand;
    }
    return this.client.request<AdoWorkItem>({ method: 'GET', url, auth, params, apiVersionFallback: true });
  }
}
