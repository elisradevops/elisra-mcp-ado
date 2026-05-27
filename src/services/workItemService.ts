import type { IWorkItemsClient, WorkItemExpand } from '../ado/workItemsClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { AdoWorkItem } from '../types/ado.js';
import { processBatchesFlat } from '../utils/batching.js';

// 3 concurrent batch requests is safe for on-prem TFS rate limits. See docs/performance.md.
const BATCH_CONCURRENCY = 3;

export const COMPACT_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AreaPath',
  'System.IterationPath',
  'System.AssignedTo',
  'System.ChangedDate',
] as const;

export const NEVER_INCLUDE_BY_DEFAULT = new Set([
  'Microsoft.VSTS.TCM.Steps',
  'Microsoft.VSTS.TCM.ReproSteps',
]);

export interface FetchOptions {
  fields?: string[];
  expand?: WorkItemExpand;
  /** Pass true when the caller intentionally uses errorPolicy:omit and can receive 0 items legitimately (e.g. deleted IDs). Default: false — throws if ADO returns 0 items for non-empty input. */
  allowEmptyResult?: boolean;
}

export class WorkItemService {
  constructor(
    private readonly workItemsClient: IWorkItemsClient,
    private readonly config: AppConfig
  ) {}

  async fetchMany(ids: number[], auth: AuthContext, options: FetchOptions = {}, project?: string): Promise<AdoWorkItem[]> {
    if (ids.length === 0) return [];

    const batchSize = Math.min(this.config.adoBatchSize, 200);
    return processBatchesFlat(
      ids,
      batchSize,
      BATCH_CONCURRENCY,
      (batch) => this.workItemsClient.fetchBatch(batch, auth, options.fields, options.expand, project, options.allowEmptyResult)
    );
  }

  async fetchCompact(ids: number[], auth: AuthContext, project?: string): Promise<AdoWorkItem[]> {
    return this.fetchMany(ids, auth, { fields: [...COMPACT_FIELDS] }, project);
  }

  async fetchWithRelations(ids: number[], auth: AuthContext, project?: string): Promise<AdoWorkItem[]> {
    return this.fetchMany(ids, auth, { expand: 'relations' }, project);
  }
}

// ─── Work item projection helpers ─────────────────────────────────────────────

export function toCompactRecord(item: AdoWorkItem): Record<string, unknown> {
  const f = item.fields;
  return {
    id: item.id,
    title: f['System.Title'],
    workItemType: f['System.WorkItemType'],
    state: f['System.State'],
    areaPath: f['System.AreaPath'],
    iterationPath: f['System.IterationPath'],
    assignedTo: extractDisplayName(f['System.AssignedTo']),
    changedDate: f['System.ChangedDate'],
  };
}

export function extractDisplayName(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'displayName' in value) {
    return (value as { displayName: string }).displayName;
  }
  return String(value);
}

// ─── Grouping helper for overview tool ────────────────────────────────────────

export interface GroupBucket {
  value: string;
  count: number;
  sampleIds: number[];
}

export interface GroupResult {
  field: string;
  buckets: GroupBucket[];
}

const SAMPLE_SIZE = 5;

export function groupByFields(items: AdoWorkItem[], groupByFields: string[]): GroupResult[] {
  return groupByFields.map((fieldRef) => {
    const buckets = new Map<string, { count: number; sampleIds: number[] }>();

    for (const item of items) {
      const raw = item.fields[fieldRef];
      const key = raw === undefined || raw === null ? '(none)' : String(extractDisplayName(raw) ?? raw);
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
        if (existing.sampleIds.length < SAMPLE_SIZE) {
          existing.sampleIds.push(item.id);
        }
      } else {
        buckets.set(key, { count: 1, sampleIds: [item.id] });
      }
    }

    const sorted = Array.from(buckets.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([value, { count, sampleIds }]) => ({ value, count, sampleIds }));

    return { field: fieldRef, buckets: sorted };
  });
}
