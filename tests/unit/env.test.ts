import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const BASE_ENV = {
  ADO_ORG_URL: 'https://tfs.example.local/tfs/DefaultCollection',
  ADO_AUTH_MODE: 'per_request_pat',
  // Required when using per_request_pat in tests — see ADO_ALLOW_PAT_IN_TOOL_ARGS validation
  ADO_ALLOW_PAT_IN_TOOL_ARGS: 'true',
};

describe('env — ADO_REVIEW_EXTRA_FIELDS', () => {
  it('empty string → []', () => {
    withEnv({ ...BASE_ENV, ADO_REVIEW_EXTRA_FIELDS: '' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoReviewExtraFields).toEqual([]);
    });
  });

  it('unset (undefined) → []', () => {
    withEnv({ ...BASE_ENV, ADO_REVIEW_EXTRA_FIELDS: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.adoReviewExtraFields).toEqual([]);
    });
  });

  it('single value → [value]', () => {
    withEnv({ ...BASE_ENV, ADO_REVIEW_EXTRA_FIELDS: 'Custom.SPAWBS' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoReviewExtraFields).toEqual(['Custom.SPAWBS']);
    });
  });

  it('comma-separated values → trimmed array', () => {
    withEnv({ ...BASE_ENV, ADO_REVIEW_EXTRA_FIELDS: 'Custom.SPAWBS, Custom.SubModule ,Custom.CustomerID' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoReviewExtraFields).toEqual(['Custom.SPAWBS', 'Custom.SubModule', 'Custom.CustomerID']);
    });
  });
});

describe('env — ADO_TRACEABILITY_LINK_TOKENS', () => {
  it('unset → []', () => {
    withEnv({ ...BASE_ENV, ADO_TRACEABILITY_LINK_TOKENS: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.adoTraceabilityLinkTokens).toEqual([]);
    });
  });

  it('single token → [token]', () => {
    withEnv({ ...BASE_ENV, ADO_TRACEABILITY_LINK_TOKENS: 'Implements' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoTraceabilityLinkTokens).toEqual(['Implements']);
    });
  });

  it('comma-separated tokens → trimmed array', () => {
    withEnv({ ...BASE_ENV, ADO_TRACEABILITY_LINK_TOKENS: 'Affects,CoveredBy, Implements' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoTraceabilityLinkTokens).toEqual(['Affects', 'CoveredBy', 'Implements']);
    });
  });
});

const HTTP_BASE_ENV = {
  ADO_ORG_URL: 'https://tfs.example.local/tfs/DefaultCollection',
  ADO_AUTH_MODE: 'server_pat',
  ADO_PAT: 'secret-pat',
  MCP_TRANSPORT: 'http',
  MCP_HTTP_BEARER_TOKEN: 'test-bearer',
};

describe('env — pagination + cache config', () => {
  it('defaults: pageSize=50, pageMax=200, cacheTtl=600000, cacheMax=50', () => {
    withEnv({ ...BASE_ENV }, () => {
      const cfg = loadConfig();
      expect(cfg.adoPageSizeDefault).toBe(50);
      expect(cfg.adoPageSizeMax).toBe(200);
      expect(cfg.adoScopeCacheTtlMs).toBe(600000);
      expect(cfg.adoScopeCacheMaxEntries).toBe(50);
    });
  });

  it('ADO_PAGE_SIZE_DEFAULT overridden', () => {
    withEnv({ ...BASE_ENV, ADO_PAGE_SIZE_DEFAULT: '25' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoPageSizeDefault).toBe(25);
    });
  });

  it('ADO_SCOPE_CACHE_TTL_MS overridden', () => {
    withEnv({ ...BASE_ENV, ADO_SCOPE_CACHE_TTL_MS: '300000' }, () => {
      const cfg = loadConfig();
      expect(cfg.adoScopeCacheTtlMs).toBe(300000);
    });
  });
});

describe('env — MCP_TRANSPORT=http validation', () => {
  it('http without bearer token → throws', () => {
    withEnv({ ...HTTP_BASE_ENV, MCP_HTTP_BEARER_TOKEN: undefined }, () => {
      expect(() => loadConfig()).toThrow('MCP_HTTP_BEARER_TOKEN');
    });
  });

  it('http with per_request_pat → throws (per_request_pat guard fires first)', () => {
    withEnv({ ...HTTP_BASE_ENV, ADO_AUTH_MODE: 'per_request_pat', ADO_PAT: undefined }, () => {
      // per_request_pat guard fires before HTTP transport check (ADO_ALLOW_PAT_IN_TOOL_ARGS missing)
      expect(() => loadConfig()).toThrow('ADO_ALLOW_PAT_IN_TOOL_ARGS');
    });
  });

  it('http with per_request_pat + flag → still throws (http transport requires server_pat or trusted_user_header)', () => {
    withEnv({ ...HTTP_BASE_ENV, ADO_AUTH_MODE: 'per_request_pat', ADO_PAT: undefined, ADO_ALLOW_PAT_IN_TOOL_ARGS: 'true' }, () => {
      expect(() => loadConfig()).toThrow('server_pat or trusted_user_header');
    });
  });

  it('http with server_pat + bearer → succeeds', () => {
    withEnv({ ...HTTP_BASE_ENV }, () => {
      const cfg = loadConfig();
      expect(cfg.mcpTransport).toBe('http');
      expect(cfg.mcpHttpBearerToken).toBe('test-bearer');
      expect(cfg.adoAuthMode).toBe('server_pat');
    });
  });

  it('http defaults: host 127.0.0.1, port 3000, path /mcp', () => {
    withEnv({ ...HTTP_BASE_ENV, MCP_HTTP_HOST: undefined, MCP_HTTP_PORT: undefined, MCP_HTTP_PATH: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.mcpHttpHost).toBe('127.0.0.1');
      expect(cfg.mcpHttpPort).toBe(3000);
      expect(cfg.mcpHttpPath).toBe('/mcp');
    });
  });

  it('MCP_ALLOWED_HOSTS comma-separated → trimmed array', () => {
    withEnv({ ...HTTP_BASE_ENV, MCP_ALLOWED_HOSTS: 'mcp.local, 10.0.0.1' }, () => {
      const cfg = loadConfig();
      expect(cfg.mcpAllowedHosts).toEqual(['mcp.local', '10.0.0.1']);
    });
  });

  it('MCP_ALLOWED_HOSTS unset → empty array', () => {
    withEnv({ ...HTTP_BASE_ENV, MCP_ALLOWED_HOSTS: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.mcpAllowedHosts).toEqual([]);
    });
  });

  it('stdio transport ignores MCP_HTTP_BEARER_TOKEN requirement', () => {
    withEnv({ ...BASE_ENV, MCP_TRANSPORT: 'stdio', MCP_HTTP_BEARER_TOKEN: undefined }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0: per_request_pat gating
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_PAT_ENV = {
  ADO_ORG_URL: 'https://tfs.example.local/tfs/DefaultCollection',
  ADO_AUTH_MODE: 'server_pat',
  ADO_PAT: 'a-valid-server-pat-value',
};

describe('env — per_request_pat requires ADO_ALLOW_PAT_IN_TOOL_ARGS', () => {
  it('per_request_pat without flag → throws with security message', () => {
    withEnv({ ...BASE_ENV, ADO_ALLOW_PAT_IN_TOOL_ARGS: undefined }, () => {
      expect(() => loadConfig()).toThrow('ADO_ALLOW_PAT_IN_TOOL_ARGS=true');
    });
  });

  it('per_request_pat without flag → error mentions production-unsafe risk', () => {
    withEnv({ ...BASE_ENV, ADO_ALLOW_PAT_IN_TOOL_ARGS: undefined }, () => {
      expect(() => loadConfig()).toThrow('production-safe');
    });
  });

  it('per_request_pat with ADO_ALLOW_PAT_IN_TOOL_ARGS=true → succeeds', () => {
    withEnv({ ...BASE_ENV, ADO_ALLOW_PAT_IN_TOOL_ARGS: 'true' }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('per_request_pat with ADO_ALLOW_PAT_IN_TOOL_ARGS=false → throws', () => {
    withEnv({ ...BASE_ENV, ADO_ALLOW_PAT_IN_TOOL_ARGS: 'false' }, () => {
      expect(() => loadConfig()).toThrow('ADO_ALLOW_PAT_IN_TOOL_ARGS=true');
    });
  });

  it('server_pat does not require ADO_ALLOW_PAT_IN_TOOL_ARGS', () => {
    withEnv({ ...SERVER_PAT_ENV, ADO_ALLOW_PAT_IN_TOOL_ARGS: undefined }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('adoAllowPatInToolArgs is false by default', () => {
    withEnv({ ...SERVER_PAT_ENV }, () => {
      const cfg = loadConfig();
      expect(cfg.adoAllowPatInToolArgs).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0: MCPO_API_KEY safety validation
// ─────────────────────────────────────────────────────────────────────────────

describe('env — MCPO_API_KEY safety', () => {
  it('MCPO_API_KEY unset → allowed (mcpo is optional)', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: undefined }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('MCPO_API_KEY=changeme → throws with insecure message', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'changeme' }, () => {
      expect(() => loadConfig()).toThrow('insecure');
    });
  });

  it('MCPO_API_KEY too short (< 16 chars) → throws', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'short' }, () => {
      expect(() => loadConfig()).toThrow('insecure');
    });
  });

  it('MCPO_API_KEY=password → throws (known-bad value)', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'password' }, () => {
      expect(() => loadConfig()).toThrow('insecure');
    });
  });

  it('MCPO_API_KEY with valid 32-char token → succeeds', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'abcdef1234567890abcdef1234567890' }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('MCPO_API_KEY with exactly 16 chars → succeeds', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'a'.repeat(16) }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('MCPO_API_KEY with 15 chars → throws', () => {
    withEnv({ ...BASE_ENV, MCPO_API_KEY: 'a'.repeat(15) }, () => {
      expect(() => loadConfig()).toThrow('insecure');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1: trusted_user_header requires MONGODB_URI + PAT_ENCRYPTION_KEY_B64
// ─────────────────────────────────────────────────────────────────────────────

const TRUSTED_USER_ENV = {
  ADO_ORG_URL: 'https://tfs.example.local/tfs/DefaultCollection',
  ADO_AUTH_MODE: 'trusted_user_header',
  MONGODB_URI: 'mongodb://localhost:27017/ado_mcp',
  PAT_ENCRYPTION_KEY_B64: Buffer.from('a'.repeat(32)).toString('base64'),
  // HTTP transport also required for trusted_user_header
  MCP_TRANSPORT: 'http',
  MCP_HTTP_BEARER_TOKEN: 'test-bearer-32charslongtoken!!!!',
};

describe('env — trusted_user_header mode validation', () => {
  it('trusted_user_header without MONGODB_URI → throws', () => {
    withEnv({ ...TRUSTED_USER_ENV, MONGODB_URI: undefined }, () => {
      expect(() => loadConfig()).toThrow('MONGODB_URI');
    });
  });

  it('trusted_user_header without PAT_ENCRYPTION_KEY_B64 → throws', () => {
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: undefined }, () => {
      expect(() => loadConfig()).toThrow('PAT_ENCRYPTION_KEY_B64');
    });
  });

  it('trusted_user_header with all required vars → succeeds', () => {
    withEnv({ ...TRUSTED_USER_ENV }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('trusted_user_header resolves trustedUserHeader to lowercase', () => {
    withEnv({ ...TRUSTED_USER_ENV, TRUSTED_USER_HEADER: 'X-Forwarded-User' }, () => {
      const cfg = loadConfig();
      expect(cfg.trustedUserHeader).toBe('x-forwarded-user');
    });
  });

  it('default trustedUserHeader is x-forwarded-user', () => {
    withEnv({ ...TRUSTED_USER_ENV, TRUSTED_USER_HEADER: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.trustedUserHeader).toBe('x-forwarded-user');
    });
  });

  it('MONGO_DB_NAME defaults to ado_mcp', () => {
    withEnv({ ...TRUSTED_USER_ENV, MONGO_DB_NAME: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.mongoDbName).toBe('ado_mcp');
    });
  });

  it('PAT_ENCRYPTION_KEY_ID defaults to v1', () => {
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_ID: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.patEncryptionKeyId).toBe('v1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1.5 F2: PAT encryption key length validation
// ─────────────────────────────────────────────────────────────────────────────

describe('env — PAT_ENCRYPTION_KEY_B64 length validation', () => {
  it('32-byte key → succeeds', () => {
    const validKey = Buffer.alloc(32, 0xff).toString('base64');
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: validKey }, () => {
      expect(() => loadConfig()).not.toThrow();
    });
  });

  it('16-byte key (too short) → throws with byte count', () => {
    const shortKey = Buffer.alloc(16, 0x01).toString('base64');
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: shortKey }, () => {
      expect(() => loadConfig()).toThrow('16 bytes');
    });
  });

  it('48-byte key (too long) → throws with byte count', () => {
    const longKey = Buffer.alloc(48, 0x02).toString('base64');
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: longKey }, () => {
      expect(() => loadConfig()).toThrow('48 bytes');
    });
  });

  it('error message mentions openssl rand -base64 32', () => {
    const shortKey = Buffer.alloc(16).toString('base64');
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: shortKey }, () => {
      expect(() => loadConfig()).toThrow('openssl rand -base64 32');
    });
  });

  it('error message does not contain the key value', () => {
    const shortKey = Buffer.from('secretsecretXXXX', 'utf8').toString('base64');
    withEnv({ ...TRUSTED_USER_ENV, PAT_ENCRYPTION_KEY_B64: shortKey }, () => {
      try {
        loadConfig();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Must not expose the key itself in the error message
        expect(msg).not.toContain(shortKey);
        expect(msg).not.toContain('secretsecretXXXX');
      }
    });
  });

  it('key length check applies even outside trusted_user_header mode', () => {
    // A bad key supplied in server_pat mode should still fail startup
    const shortKey = Buffer.alloc(16).toString('base64');
    withEnv({
      ADO_ORG_URL: 'https://tfs.example.local/tfs/DefaultCollection',
      ADO_AUTH_MODE: 'server_pat',
      ADO_PAT: 'a-valid-server-pat-value',
      PAT_ENCRYPTION_KEY_B64: shortKey,
    }, () => {
      expect(() => loadConfig()).toThrow('32 bytes');
    });
  });
});
