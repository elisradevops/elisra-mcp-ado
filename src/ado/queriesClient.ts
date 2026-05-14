import type { AdoClient } from './adoClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';

interface AdoQueryResponse {
  id: string;
  name: string;
  queryType: 'flat' | 'oneHop' | 'tree';
  wiql: string;
}

export type QueryType = 'flat' | 'oneHop' | 'tree';

export interface QueryDefinition {
  id: string;
  name: string;
  queryType: QueryType;
  wiql: string;
}

export interface IQueriesClient {
  getQueryById(auth: AuthContext, project: string, idOrPath: string): Promise<QueryDefinition>;
}

export class QueriesClient implements IQueriesClient {
  constructor(
    private readonly client: AdoClient,
    private readonly config: AppConfig
  ) {}

  async getQueryById(
    auth: AuthContext,
    project: string,
    idOrPath: string
  ): Promise<QueryDefinition> {
    const encodedProject = encodeURIComponent(project);
    // Normalize backslash path separators (ADO GUI uses \, REST API uses /)
    const normalizedPath = idOrPath.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.some((s) => s === '..' || s === '.')) {
      throw new Error(
        `Invalid savedQuery path "${idOrPath}": path traversal segments are not allowed.`
      );
    }
    const encodedQuery = segments.map((s) => encodeURIComponent(s)).join('/');

    const url = `${this.config.adoOrgUrl}/${encodedProject}/_apis/wit/queries/${encodedQuery}`;
    const response = await this.client.request<AdoQueryResponse>({
      method: 'GET',
      url,
      auth,
      params: { 'api-version': this.config.adoApiVersion, '$expand': 'wiql' },
      apiVersionFallback: true,
    });

    return {
      id: response.id,
      name: response.name,
      queryType: response.queryType,
      wiql: response.wiql,
    };
  }
}
