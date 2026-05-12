import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoFieldDefinition, AdoFieldsResponse, AdoWitFieldEntry, AdoWitFieldsResponse } from '../types/ado.js';

export class FieldsClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async listFields(auth: AuthContext): Promise<AdoFieldDefinition[]> {
    const url = `${this.config.adoOrgUrl}/_apis/wit/fields`;
    const response = await this.client.get<AdoFieldsResponse>(url, auth, {
      'api-version': this.config.adoApiVersion,
    });
    return response.value ?? [];
  }

  async listWorkItemTypeFields(
    auth: AuthContext,
    project: string,
    workItemType: string
  ): Promise<AdoWitFieldEntry[]> {
    const encodedWit = encodeURIComponent(workItemType);
    const url = `${this.config.adoOrgUrl}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodedWit}/fields`;
    const response = await this.client.get<AdoWitFieldsResponse>(url, auth, {
      'api-version': this.config.adoApiVersion,
    });
    return response.value ?? [];
  }
}
