import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { NormalizedWorkItemInput } from '../approvals/writeApprovalStore.js';

export interface CreatedWorkItem {
  id: number;
  url?: string;
  webUrl?: string;
}

interface AdoWitCreateResponse {
  id: number;
  _links?: {
    html?: { href?: string };
    self?: { href?: string };
  };
}

type JsonPatchOp = { op: 'add'; path: string; value: unknown };

function buildPatchDocument(input: NormalizedWorkItemInput): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [
    { op: 'add', path: '/fields/System.Title', value: input.title },
  ];
  if (input.description !== undefined && input.description.trim().length > 0) {
    ops.push({ op: 'add', path: '/fields/System.Description', value: input.description });
  }
  if (input.areaPath !== undefined && input.areaPath.trim().length > 0) {
    ops.push({ op: 'add', path: '/fields/System.AreaPath', value: input.areaPath });
  }
  if (input.iterationPath !== undefined && input.iterationPath.trim().length > 0) {
    ops.push({ op: 'add', path: '/fields/System.IterationPath', value: input.iterationPath });
  }
  if (input.tags !== undefined && input.tags.trim().length > 0) {
    ops.push({ op: 'add', path: '/fields/System.Tags', value: input.tags });
  }
  if (input.priority !== undefined) {
    ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: input.priority });
  }
  return ops;
}

export class WorkItemCreateClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async createOne(
    project: string,
    workItemType: string,
    input: NormalizedWorkItemInput,
    auth: AuthContext,
  ): Promise<CreatedWorkItem> {
    // Encode $WorkItemType — ADO WIT create path requires the $ prefix
    const url = `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent('$' + workItemType)}`;

    const response = await this.client.request<AdoWitCreateResponse>({
      method: 'PATCH',
      url,
      auth,
      params: { 'api-version': this.config.adoApiVersion },
      data: buildPatchDocument(input),
      headers: { 'Content-Type': 'application/json-patch+json' },
    });

    this.logger.info({ project, workItemType, workItemId: response.id }, 'Work item created');

    return {
      id: response.id,
      url: response._links?.self?.href,
      webUrl: response._links?.html?.href,
    };
  }
}
