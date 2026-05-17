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
  adoMaxReviewItems: number;
  adoReviewExtraFields: string[];
  adoTraceabilityLinkTokens: string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logFile?: string;
  mcpoApiKey?: string;
  adoPat?: string;
}
