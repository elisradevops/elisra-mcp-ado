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
};

describe('env — ADO_REVIEW_EXTRA_FIELDS', () => {
  it('unset (or empty) → []', () => {
    withEnv({ ...BASE_ENV, ADO_REVIEW_EXTRA_FIELDS: '' }, () => {
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
  it('unset → default ["Affects","CoveredBy","TestedBy"]', () => {
    withEnv({ ...BASE_ENV, ADO_TRACEABILITY_LINK_TOKENS: undefined }, () => {
      const cfg = loadConfig();
      expect(cfg.adoTraceabilityLinkTokens).toEqual(['Affects', 'CoveredBy', 'TestedBy']);
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

describe('env — MCP_TRANSPORT=http validation', () => {
  it('http without bearer token → throws', () => {
    withEnv({ ...HTTP_BASE_ENV, MCP_HTTP_BEARER_TOKEN: undefined }, () => {
      expect(() => loadConfig()).toThrow('MCP_HTTP_BEARER_TOKEN');
    });
  });

  it('http with per_request_pat → throws', () => {
    withEnv({ ...HTTP_BASE_ENV, ADO_AUTH_MODE: 'per_request_pat', ADO_PAT: undefined }, () => {
      expect(() => loadConfig()).toThrow('server_pat');
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
