import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoWorkItemRelationType, AdoWorkItemRelationTypesResponse } from '../types/ado.js';

export class LinkTypesClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async listRelationTypes(auth: AuthContext): Promise<AdoWorkItemRelationType[]> {
    const url = `${this.config.adoOrgUrl}/_apis/wit/workItemRelationTypes`;
    const response = await this.client.request<AdoWorkItemRelationTypesResponse>({
      method: 'GET',
      url,
      auth,
      params: { 'api-version': this.config.adoApiVersion },
      apiVersionFallback: true,
    });
    return response.value ?? [];
  }
}
