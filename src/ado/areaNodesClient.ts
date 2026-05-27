import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoClassificationNode } from '../types/ado.js';

export class AreaNodesClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async getAreaTree(auth: AuthContext, project: string, depth = 10): Promise<AdoClassificationNode> {
    const url = this.client.buildUrl(project, '_apis/wit/classificationnodes/areas');
    return this.client.request<AdoClassificationNode>({
      method: 'GET',
      url,
      auth,
      params: { '$depth': depth, 'api-version': this.config.adoApiVersion },
      apiVersionFallback: true,
    });
  }
}
