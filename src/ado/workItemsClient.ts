import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { AdoWorkItem, AdoWorkItemsBatchResponse } from '../types/ado.js';
import { parseApiMajor } from './apiVersionLadder.js';

export type WorkItemExpand = 'none' | 'relations' | 'all';

export interface IWorkItemsClient {
  fetchBatch(ids: number[], auth: AuthContext, fields?: string[], expand?: WorkItemExpand, project?: string, allowEmptyResult?: boolean): Promise<AdoWorkItem[]>;
  fetchSingle(id: number, auth: AuthContext, expand?: WorkItemExpand, project?: string): Promise<AdoWorkItem>;
}

export class WorkItemsClient implements IWorkItemsClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig,
    private readonly logger?: Logger
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
    expand?: WorkItemExpand,
    project?: string,
    allowEmptyResult = false
  ): Promise<AdoWorkItem[]> {
    if (ids.length === 0) return [];
    if (ids.length > 200) {
      throw new RangeError(`fetchBatch: ADO workitemsbatch limit is 200 IDs, got ${ids.length}. Use WorkItemService.fetchMany to batch automatically.`);
    }

    // Use GET path for: TFS 2018 (no batch endpoint) OR any $expand request.
    // POST workitemsbatch + $expand=relations returns 500 on many on-prem TFS versions.
    // GET /_apis/wit/workitems?ids=...&$expand=... is supported on all versions.
    const useGetPath = this.isPreBatchTfs() || (expand !== undefined && expand !== 'none');

    if (useGetPath) {
      // GET /{project}/_apis/wit/workitems?ids=1,2,3[&fields=...][&$expand=...]
      if (!project) this.logger?.warn({ idCount: ids.length }, 'fetchBatch: no project — using org-scoped URL, may 404 on on-prem ADO Server');
      const url = project
        ? `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems`
        : `${this.config.adoOrgUrl}/_apis/wit/workitems`;
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
      const result = response.value ?? [];
      if (result.length === 0 && ids.length > 0 && !allowEmptyResult) {
        throw new Error(`ADO returned 0 of ${ids.length} requested items — verify the project parameter matches the items' project and that the PAT has read access.`);
      }
      return result;
    }

    // 5.0+ path: POST /{project}/_apis/wit/workitemsbatch (fields-only, no expand)
    if (!project) this.logger?.warn({ idCount: ids.length }, 'fetchBatch: no project — using org-scoped URL, may 404 on on-prem ADO Server');
    const url = project
      ? `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitemsbatch`
      : `${this.config.adoOrgUrl}/_apis/wit/workitemsbatch`;
    const params: Record<string, string> = {
      'api-version': this.config.adoApiVersion,
    };

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
    const result = response.value ?? [];
    if (result.length === 0 && ids.length > 0 && !allowEmptyResult) {
      throw new Error(`ADO returned 0 of ${ids.length} requested items — verify the project parameter matches the items' project and that the PAT has read access.`);
    }
    return result;
  }

  async fetchSingle(id: number, auth: AuthContext, expand?: WorkItemExpand, project?: string): Promise<AdoWorkItem> {
    if (!project) this.logger?.warn({ id }, 'fetchSingle: no project — using org-scoped URL, may 404 on on-prem ADO Server');
    const url = project
      ? `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}`
      : `${this.config.adoOrgUrl}/_apis/wit/workitems/${id}`;
    const params: Record<string, string | number> = {
      'api-version': this.config.adoApiVersion,
    };
    if (expand && expand !== 'none') {
      params['$expand'] = expand;
    }
    return this.client.request<AdoWorkItem>({ method: 'GET', url, auth, params, apiVersionFallback: true });
  }
}
