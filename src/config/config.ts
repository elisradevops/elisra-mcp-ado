export interface AppConfig {
  adoOrgUrl: string;
  adoApiVersion: string;
  adoBatchSize: number;
  adoAuthMode: 'per_request_pat' | 'server_pat' | 'trusted_user_header';
  /**
   * Must be explicitly set to true to allow ADO_AUTH_MODE=per_request_pat.
   * per_request_pat is NOT production-safe: PATs travel through tool-call JSON,
   * LLM context windows, proxy logs, and conversation history.
   * Only enable for local dev/testing. Never enable in production deployments.
   */
  adoAllowPatInToolArgs: boolean;
  adoReadOnly: boolean;
  adoEnableDebugOutput: boolean;
  adoRequestTimeoutMs: number;
  adoAllowUnknownFields: boolean;
  adoPageSizeDefault: number;
  adoPageSizeMax: number;
  adoScopeCacheTtlMs: number;
  adoScopeCacheMaxEntries: number;
  adoReviewExtraFields: string[];
  adoTraceabilityLinkTokens: string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logFile?: string;
  mcpoApiKey?: string;
  adoPat?: string;
  // HTTP transport
  mcpTransport: 'stdio' | 'http';
  mcpHttpHost: string;
  mcpHttpPort: number;
  mcpHttpPath: string;
  mcpAllowedHosts: string[];
  mcpAllowedOrigins: string[];
  mcpHttpBearerToken?: string;
  // P1: MongoDB credential store
  mongoUri?: string;
  mongoDbName: string;
  adoCredentialsCollection: string;
  // P1: PAT encryption
  patEncryptionKeyB64?: string;
  patEncryptionKeyId: string;
  // P1: Trusted user identity
  /** HTTP header name carrying the authenticated app user ID (e.g. X-Forwarded-User). */
  trustedUserHeader: string;
  /** Optional: header carrying user display name (metadata only, not used as identity key). */
  trustedUserNameHeader?: string;
  // P2: Write approval flow
  adoWriteMaxItemsPerApproval: number;
  adoWriteApprovalTtlSeconds: number;
  adoWriteApprovalsCollection: string;
  adoAllowedWorkItemTypes: string[];
  adoAllowedProjects: string[];
  adoAllowedAreaPathPrefixes: string[];
  adoAllowedIterationPathPrefixes: string[];
  /** Seconds before a stuck `executing` approval is considered stale. Default 900. */
  adoWriteExecutionStaleSeconds: number;
}
