export interface AppConfig {
  adoOrgUrl: string;
  adoApiVersion: string;
  adoBatchSize: number;
  adoAuthMode: 'per_request_pat' | 'server_pat' | 'trusted_header_future';
  adoReadOnly: boolean;
  adoEnableDebugOutput: boolean;
  adoRequestTimeoutMs: number;
  adoAllowUnknownFields: boolean;
  adoFullResponseMaxItems: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  mcpoApiKey?: string;
  adoPat?: string;
}
