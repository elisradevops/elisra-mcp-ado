import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type {
  AdoProject,
  AdoProjectsResponse,
  AdoConnectionData,
} from '../types/ado.js';

export class ProjectsClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async listProjects(auth: AuthContext, top = 10): Promise<AdoProject[]> {
    const url = `${this.config.adoOrgUrl}/_apis/projects`;
    const response = await this.client.get<AdoProjectsResponse>(url, auth, {
      $top: top,
      stateFilter: 'wellFormed',
      'api-version': this.config.adoApiVersion,
    });
    return response.value ?? [];
  }

  async getConnectionData(auth: AuthContext): Promise<AdoConnectionData> {
    const url = `${this.config.adoOrgUrl}/_apis/connectionData`;
    return this.client.get<AdoConnectionData>(url, auth);
  }
}
