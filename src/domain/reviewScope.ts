import type { FieldFilter, OrderBy } from './fieldFilter.js';
import type { AuthContext } from '../auth/authContext.js';

// ─── Source types ─────────────────────────────────────────────────────────────

export interface WiqlSource {
  type: 'wiql';
  wiql: string;
}

export interface IdsSource {
  type: 'ids';
  ids: number[];
}

export interface FieldFiltersSource {
  type: 'fieldFilters';
  filters: FieldFilter[];
  orderBy?: OrderBy[];
}

export interface LinkedItemsSource {
  type: 'linkedItems';
  rootId: number;
  relationTypes?: string[];
  depth?: number;
}

export interface SavedQuerySource {
  type: 'savedQuery';
  queryPathOrId: string;
}

export type ReviewSource =
  | WiqlSource
  | IdsSource
  | FieldFiltersSource
  | LinkedItemsSource
  | SavedQuerySource;

export type ReviewSourceType = ReviewSource['type'];

// ─── Presets ──────────────────────────────────────────────────────────────────

export type ReviewPreset =
  | 'requirement_quality'
  | 'requirement_traceability'
  | 'requirement_completeness'
  | 'requirement_consistency'
  | 'bug_triage'
  | 'test_coverage'
  | 'custom';

// ─── Scope ────────────────────────────────────────────────────────────────────

export interface ReviewScope {
  project?: string;
  auth?: AuthContext;
  source: ReviewSource;
  preset?: ReviewPreset;
}

// ─── Resolution result ────────────────────────────────────────────────────────

export type ResponseMode = 'overview' | 'ids' | 'samples' | 'full' | 'export';

export interface ScopeResolution {
  project?: string;
  sourceType: ReviewSourceType;
  ids: number[];
  totalMatched: number;
  warnings: string[];
  debugWiql?: string; // populated only when ADO_ENABLE_DEBUG_OUTPUT=true
}
