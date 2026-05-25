import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';

export interface AdoWorkItemTypeRef {
  name: string;
  referenceName: string;
}

interface AdoWorkItemTypesResponse {
  value: AdoWorkItemTypeRef[];
}

export class WorkItemTypesClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async listTypes(auth: AuthContext, project: string): Promise<AdoWorkItemTypeRef[]> {
    const url = `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitemtypes`;
    const response = await this.client.request<AdoWorkItemTypesResponse>({
      method: 'GET',
      url,
      auth,
      params: { 'api-version': this.config.adoApiVersion },
      apiVersionFallback: true,
    });
    return response.value ?? [];
  }
}
