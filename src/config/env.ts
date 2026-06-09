import { z } from 'zod';
import type { AppConfig } from './config.js';

const envSchema = z.object({
  ADO_ORG_URL: z
    .string({ required_error: 'ADO_ORG_URL is required' })
    .url('ADO_ORG_URL must be a valid URL')
    .refine((v) => v.startsWith('https://'), 'ADO_ORG_URL must use HTTPS (on-prem TFS requires a valid CA cert; see NODE_EXTRA_CA_CERTS)'),
  // ADO Server 2022 → 7.0 (default). TFS 2018 → set to 4.1 explicitly.
  ADO_API_VERSION: z.string().default('7.0'),
  ADO_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(200),
  ADO_AUTH_MODE: z
    .enum(['per_request_pat', 'server_pat', 'trusted_user_header'])
    .default('server_pat'),
  ADO_READ_ONLY: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false'),
  /**
   * Must be explicitly set to 'true' to use ADO_AUTH_MODE=per_request_pat.
   * This mode is NOT production-safe: PATs travel through tool-call arguments,
   * LLM context windows, proxy logs, and conversation history.
   * Leave unset (false) for all production and staging deployments.
   */
  ADO_ALLOW_PAT_IN_TOOL_ARGS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  ADO_ENABLE_DEBUG_OUTPUT: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  ADO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  ADO_ALLOW_UNKNOWN_FIELDS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  ADO_PAGE_SIZE_DEFAULT: z.coerce.number().int().min(1).max(200).default(50),
  ADO_PAGE_SIZE_MAX: z.coerce.number().int().min(1).max(200).default(200),
  ADO_SCOPE_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(600000),
  ADO_SCOPE_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).default(50),
  ADO_REVIEW_EXTRA_FIELDS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADO_TRACEABILITY_LINK_TOKENS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_FILE: z.string().optional(),
  /**
   * API key used by the legacy mcpo bridge sidecar. If set, must be a securely generated
   * token of at least 16 characters. Never use placeholder values like 'changeme'.
   */
  MCPO_API_KEY: z.string().optional(),
  ADO_PAT: z.string().optional(),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_HOST: z.string().default('127.0.0.1'),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_HTTP_PATH: z.string().default('/mcp'),
  MCP_ALLOWED_HOSTS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  MCP_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  MCP_HTTP_BEARER_TOKEN: z.string().optional(),

  // ── P1: MongoDB credential store ──────────────────────────────────────────
  /**
   * Full MongoDB connection URI. Required for trusted_user_header mode.
   * Must come from a Kubernetes Secret or equivalent secure secret manager.
   * Never hardcode. Example pattern: mongodb://user:pass@host:27017/db?authSource=admin
   */
  MONGODB_URI: z.string().optional(),
  /**
   * MongoDB database name for the MCP ADO credential store.
   * Separate from the docgen database — defaults to 'ado_mcp'.
   * Matches MONGODB_URI naming convention from dg-api-gate.
   */
  MONGO_DB_NAME: z.string().default('ado_mcp'),
  /**
   * MongoDB collection name for user ADO credentials. Defaults to 'ado_user_credentials'.
   */
  ADO_CREDENTIALS_COLLECTION: z.string().default('ado_user_credentials'),

  // ── P1: PAT encryption ────────────────────────────────────────────────────
  /**
   * Base64-encoded 32-byte AES-256-GCM master key for encrypting per-user ADO PATs.
   * Required for trusted_user_header mode. Must come from a Kubernetes Secret.
   * Generate: openssl rand -base64 32
   */
  PAT_ENCRYPTION_KEY_B64: z.string().optional(),
  /**
   * Key version/ID label stored alongside ciphertext to allow key rotation.
   * Increment (e.g. 'v2') when rotating — old records retain old keyId for decryption.
   */
  PAT_ENCRYPTION_KEY_ID: z.string().default('v1'),

  // ── P1: Trusted user identity ─────────────────────────────────────────────
  /**
   * HTTP header name carrying the authenticated app user ID.
   * Must be set and injected ONLY by a trusted backend layer (Open WebUI, reverse proxy).
   * Arbitrary browser-supplied headers must NEVER be trusted for identity.
   * Required for trusted_user_header auth mode.
   */
  TRUSTED_USER_HEADER: z.string().default('x-forwarded-user'),
  /**
   * Optional: header carrying the user's display name (metadata only, not used as identity key).
   */
  TRUSTED_USER_NAME_HEADER: z.string().optional(),

  // ── P2: Write approval flow ───────────────────────────────────────────────
  ADO_WRITE_MAX_ITEMS_PER_APPROVAL: z.coerce.number().int().min(1).max(20).default(5),
  ADO_WRITE_APPROVAL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  ADO_WRITE_APPROVALS_COLLECTION: z.string().default('ado_write_approvals'),
  ADO_ALLOWED_WORK_ITEM_TYPES: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADO_ALLOWED_PROJECTS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADO_ALLOWED_AREA_PATH_PREFIXES: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADO_ALLOWED_ITERATION_PATH_PREFIXES: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADO_WRITE_EXECUTION_STALE_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
});

type ParsedEnv = z.infer<typeof envSchema>;

function mapToConfig(env: ParsedEnv): AppConfig {
  return {
    adoOrgUrl: env.ADO_ORG_URL.replace(/\/$/, ''),
    adoApiVersion: env.ADO_API_VERSION,
    adoBatchSize: env.ADO_BATCH_SIZE,
    adoAuthMode: env.ADO_AUTH_MODE,
    adoAllowPatInToolArgs: env.ADO_ALLOW_PAT_IN_TOOL_ARGS,
    adoReadOnly: env.ADO_READ_ONLY,
    adoEnableDebugOutput: env.ADO_ENABLE_DEBUG_OUTPUT,
    adoRequestTimeoutMs: env.ADO_REQUEST_TIMEOUT_MS,
    adoAllowUnknownFields: env.ADO_ALLOW_UNKNOWN_FIELDS,
    adoPageSizeDefault: env.ADO_PAGE_SIZE_DEFAULT,
    adoPageSizeMax: env.ADO_PAGE_SIZE_MAX,
    adoScopeCacheTtlMs: env.ADO_SCOPE_CACHE_TTL_MS,
    adoScopeCacheMaxEntries: env.ADO_SCOPE_CACHE_MAX_ENTRIES,
    adoReviewExtraFields: env.ADO_REVIEW_EXTRA_FIELDS,
    adoTraceabilityLinkTokens: env.ADO_TRACEABILITY_LINK_TOKENS,
    logLevel: env.LOG_LEVEL,
    logFile: env.LOG_FILE,
    mcpoApiKey: env.MCPO_API_KEY,
    adoPat: env.ADO_PAT,
    mcpTransport: env.MCP_TRANSPORT,
    mcpHttpHost: env.MCP_HTTP_HOST,
    mcpHttpPort: env.MCP_HTTP_PORT,
    mcpHttpPath: env.MCP_HTTP_PATH,
    mcpAllowedHosts: env.MCP_ALLOWED_HOSTS,
    mcpAllowedOrigins: env.MCP_ALLOWED_ORIGINS,
    mcpHttpBearerToken: env.MCP_HTTP_BEARER_TOKEN,
    mongoUri: env.MONGODB_URI,
    mongoDbName: env.MONGO_DB_NAME,
    adoCredentialsCollection: env.ADO_CREDENTIALS_COLLECTION,
    patEncryptionKeyB64: env.PAT_ENCRYPTION_KEY_B64,
    patEncryptionKeyId: env.PAT_ENCRYPTION_KEY_ID,
    trustedUserHeader: env.TRUSTED_USER_HEADER.toLowerCase(),
    trustedUserNameHeader: env.TRUSTED_USER_NAME_HEADER?.toLowerCase(),
    adoWriteMaxItemsPerApproval: env.ADO_WRITE_MAX_ITEMS_PER_APPROVAL,
    adoWriteApprovalTtlSeconds: env.ADO_WRITE_APPROVAL_TTL_SECONDS,
    adoWriteApprovalsCollection: env.ADO_WRITE_APPROVALS_COLLECTION,
    adoAllowedWorkItemTypes: env.ADO_ALLOWED_WORK_ITEM_TYPES,
    adoAllowedProjects: env.ADO_ALLOWED_PROJECTS,
    adoAllowedAreaPathPrefixes: env.ADO_ALLOWED_AREA_PATH_PREFIXES,
    adoAllowedIterationPathPrefixes: env.ADO_ALLOWED_ITERATION_PATH_PREFIXES,
    adoWriteExecutionStaleSeconds: env.ADO_WRITE_EXECUTION_STALE_SECONDS,
  };
}

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  const env = result.data;

  // ── Mode-specific validation ──────────────────────────────────────────────

  if (env.ADO_AUTH_MODE === 'server_pat' && !env.ADO_PAT) {
    throw new Error(
      'Configuration error: ADO_AUTH_MODE=server_pat requires ADO_PAT to be set.'
    );
  }

  // per_request_pat requires an explicit opt-in flag — NOT production-safe.
  if (env.ADO_AUTH_MODE === 'per_request_pat' && !env.ADO_ALLOW_PAT_IN_TOOL_ARGS) {
    throw new Error(
      'Configuration error: ADO_AUTH_MODE=per_request_pat requires ADO_ALLOW_PAT_IN_TOOL_ARGS=true.\n' +
      'per_request_pat is NOT production-safe: PATs travel through tool-call JSON, LLM context,\n' +
      'proxy logs, and conversation history. Set ADO_ALLOW_PAT_IN_TOOL_ARGS=true only for local\n' +
      'development and testing. Use ADO_AUTH_MODE=server_pat for all other deployments.'
    );
  }
  if (env.ADO_AUTH_MODE === 'per_request_pat' && env.ADO_PAT) {
    process.stderr.write(
      '[elisra-mcp-ado] WARN: ADO_PAT is set but ADO_AUTH_MODE=per_request_pat. ' +
      'The server PAT will be ignored; each request must supply its own PAT.\n'
    );
  }

  // trusted_user_header requires MongoDB URI and encryption key.
  if (env.ADO_AUTH_MODE === 'trusted_user_header') {
    if (!env.MONGODB_URI) {
      throw new Error(
        'Configuration error: ADO_AUTH_MODE=trusted_user_header requires MONGODB_URI to be set. ' +
        'The credential store needs a MongoDB connection to resolve per-user PATs.'
      );
    }
    if (!env.PAT_ENCRYPTION_KEY_B64) {
      throw new Error(
        'Configuration error: ADO_AUTH_MODE=trusted_user_header requires PAT_ENCRYPTION_KEY_B64 to be set. ' +
        'This key encrypts per-user ADO PATs at rest. Supply via Kubernetes Secret.'
      );
    }
  }

  // Validate PAT encryption key length whenever provided — not just in trusted_user_header mode.
  // A 32-byte (256-bit) key is required for AES-256-GCM. Validate at startup so misconfigured keys
  // fail fast rather than silently on the first PAT operation.
  // Never log the key value.
  if (env.PAT_ENCRYPTION_KEY_B64) {
    const keyBuf = Buffer.from(env.PAT_ENCRYPTION_KEY_B64, 'base64');
    if (keyBuf.length !== 32) {
      throw new Error(
        `Configuration error: PAT_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes (256 bits). ` +
        `Got ${keyBuf.length} bytes. Generate a valid key with: openssl rand -base64 32`
      );
    }
  }

  // MCPO API key safety.
  if (env.MCPO_API_KEY !== undefined) {
    const KNOWN_BAD_KEYS = new Set(['changeme', 'change_me', 'secret', 'password', 'default', 'test', '']);
    if (KNOWN_BAD_KEYS.has(env.MCPO_API_KEY.toLowerCase()) || env.MCPO_API_KEY.length < 16) {
      throw new Error(
        'Configuration error: MCPO_API_KEY is set to an insecure value. ' +
        'Use a securely generated token of at least 16 characters. ' +
        'Never use placeholder values like "changeme".'
      );
    }
  }

  if (env.MCP_TRANSPORT === 'http') {
    if (!env.MCP_HTTP_BEARER_TOKEN) {
      throw new Error(
        'Configuration error: MCP_TRANSPORT=http requires MCP_HTTP_BEARER_TOKEN to be set.'
      );
    }
    const writesAllowed = env.ADO_AUTH_MODE === 'server_pat' || env.ADO_AUTH_MODE === 'trusted_user_header';
    if (!writesAllowed) {
      throw new Error(
        'Configuration error: MCP_TRANSPORT=http requires ADO_AUTH_MODE=server_pat or trusted_user_header. ' +
        'per_request_pat is not supported over native MCP HTTP transport.'
      );
    }
  }

  return mapToConfig(env);
}
