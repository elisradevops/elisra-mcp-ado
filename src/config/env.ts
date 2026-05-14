import { z } from 'zod';
import type { AppConfig } from './config.js';

const envSchema = z.object({
  ADO_ORG_URL: z
    .string({ required_error: 'ADO_ORG_URL is required' })
    .url('ADO_ORG_URL must be a valid URL')
    .refine((v) => v.startsWith('https://'), 'ADO_ORG_URL must use HTTPS (on-prem TFS requires a valid CA cert; see NODE_EXTRA_CA_CERTS)'),
  // ADO Server 2022 → 7.0 (default). TFS 2018 → set to 4.1 explicitly. See docs/onprem-ado.md.
  ADO_API_VERSION: z.string().default('7.0'),
  ADO_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(200),
  ADO_AUTH_MODE: z
    .enum(['per_request_pat', 'server_pat', 'trusted_header_future'])
    .default('per_request_pat'),
  ADO_READ_ONLY: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false'),
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
  ADO_FULL_RESPONSE_MAX_ITEMS: z.coerce.number().int().min(1).default(50),
  ADO_MAX_REVIEW_ITEMS: z.coerce.number().int().min(1).max(2000).default(500),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_FILE: z.string().optional(),
  MCPO_API_KEY: z.string().optional(),
  ADO_PAT: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

function mapToConfig(env: ParsedEnv): AppConfig {
  return {
    adoOrgUrl: env.ADO_ORG_URL.replace(/\/$/, ''), // strip trailing slash
    adoApiVersion: env.ADO_API_VERSION,
    adoBatchSize: env.ADO_BATCH_SIZE,
    adoAuthMode: env.ADO_AUTH_MODE,
    adoReadOnly: env.ADO_READ_ONLY,
    adoEnableDebugOutput: env.ADO_ENABLE_DEBUG_OUTPUT,
    adoRequestTimeoutMs: env.ADO_REQUEST_TIMEOUT_MS,
    adoAllowUnknownFields: env.ADO_ALLOW_UNKNOWN_FIELDS,
    adoFullResponseMaxItems: env.ADO_FULL_RESPONSE_MAX_ITEMS,
    adoMaxReviewItems: env.ADO_MAX_REVIEW_ITEMS,
    logLevel: env.LOG_LEVEL,
    logFile: env.LOG_FILE,
    mcpoApiKey: env.MCPO_API_KEY,
    adoPat: env.ADO_PAT,
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

  // Mode-specific validation — done here rather than in zod to produce clear messages
  if (env.ADO_AUTH_MODE === 'server_pat' && !env.ADO_PAT) {
    throw new Error(
      'Configuration error: ADO_AUTH_MODE=server_pat requires ADO_PAT to be set.'
    );
  }
  if (env.ADO_AUTH_MODE === 'per_request_pat' && env.ADO_PAT) {
    process.stderr.write(
      '[elisra-mcp-ado] WARN: ADO_PAT is set but ADO_AUTH_MODE=per_request_pat. ' +
      'The server PAT will be ignored; each request must supply its own PAT.\n'
    );
  }

  return mapToConfig(env);
}
