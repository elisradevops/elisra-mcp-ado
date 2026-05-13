import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoWorkItem, AdoWorkItemsBatchResponse } from '../types/ado.js';

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

    const url = `${this.config.adoOrgUrl}/_apis/wit/workitemsbatch`;
    const params: Record<string, string> = {
      'api-version': this.config.adoApiVersion,
    };
    if (expand && expand !== 'none') {
      params['$expand'] = expand;
    }

    const body: Record<string, unknown> = { ids };
    if (fields && fields.length > 0) {
      body['fields'] = fields;
    }

    const response = await this.client.request<AdoWorkItemsBatchResponse>({
      method: 'POST',
      url,
      auth,
      params,
      data: body,
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
    return this.client.get<AdoWorkItem>(url, auth, params);
  }
}
