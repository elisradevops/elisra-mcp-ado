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
