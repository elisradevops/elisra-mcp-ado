import type { Operator } from './fieldFilter.js';
import { CaseInsensitiveMap } from '../utils/caseInsensitiveMap.js';
import {
  TREEPATH_OPERATORS,
  STRING_OPERATORS,
  NUMERIC_OPERATORS,
  LONGTEXT_OPERATORS,
  IDENTITY_OPERATORS,
} from './fieldFilter.js';

export type FieldType =
  | 'string'
  | 'integer'
  | 'double'
  | 'dateTime'
  | 'boolean'
  | 'plainText'
  | 'html'
  | 'treePath'
  | 'identity'
  | 'guid';

export interface FieldInfo {
  referenceName: string;          // canonical, e.g. "Custom.CustomerID"
  displayName: string;
  type: FieldType;
  isCustom: boolean;              // starts with Custom. or Elisra.
  isIdentity: boolean;
  isLongText: boolean;            // html or plainText — only CONTAINS is valid
  isTreePath: boolean;
  historyTracked: boolean;        // true for fields that support WAS operator (System.State, etc.)
  allowedOperators: readonly Operator[];
  knownInDocGen: boolean;         // seen in docgen-data-provider-package or docgen-content-control
  safeForFiltering: boolean;      // false for very-long fields (TCM.Steps etc.)
  safeForGrouping: boolean;       // true for low-cardinality fields
  source: 'seed' | 'discovered';  // 'discovered' once field-discovery overwrites this
}

type FieldDef = Omit<FieldInfo, 'isCustom' | 'isIdentity' | 'isLongText' | 'isTreePath' | 'historyTracked' | 'allowedOperators' | 'source'>;

function field(def: FieldDef & { historyTracked?: boolean }): FieldInfo {
  const ref = def.referenceName;
  const isCustom = ref.startsWith('Custom.') || ref.startsWith('Elisra.');
  const isIdentity = def.type === 'identity';
  const isLongText = def.type === 'html' || def.type === 'plainText';
  const isTreePath = def.type === 'treePath';
  const historyTracked = def.historyTracked ?? false;

  let allowedOperators: readonly Operator[];
  if (isTreePath) allowedOperators = TREEPATH_OPERATORS;
  else if (isLongText) allowedOperators = LONGTEXT_OPERATORS;
  else if (def.type === 'integer' || def.type === 'double' || def.type === 'dateTime')
    allowedOperators = NUMERIC_OPERATORS;
  else if (def.type === 'boolean') allowedOperators = ['=', '<>'] as const;
  else if (def.type === 'identity') allowedOperators = IDENTITY_OPERATORS;
  else allowedOperators = STRING_OPERATORS; // string, guid

  if (historyTracked) allowedOperators = [...allowedOperators, 'WAS'] as const;

  return { ...def, isCustom, isIdentity, isLongText, isTreePath, historyTracked, allowedOperators, source: 'seed' };
}

// ─── Seed catalog ─────────────────────────────────────────────────────────────
// Based on DocGen data-provider inventory. Override with Phase-5 discovered metadata at runtime.

const SEED_FIELDS: FieldInfo[] = [
  // ── TreePath ──────────────────────────────────────────────────────────────
  field({ referenceName: 'System.AreaPath', displayName: 'Area Path', type: 'treePath', historyTracked: true, knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.IterationPath', displayName: 'Iteration Path', type: 'treePath', historyTracked: true, knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),

  // ── Core system fields ────────────────────────────────────────────────────
  field({ referenceName: 'System.Id', displayName: 'ID', type: 'integer', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'System.Title', displayName: 'Title', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'System.State', displayName: 'State', type: 'string', historyTracked: true, knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.WorkItemType', displayName: 'Work Item Type', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.TeamProject', displayName: 'Team Project', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.Reason', displayName: 'Reason', type: 'string', historyTracked: true, knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.Tags', displayName: 'Tags', type: 'string', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'System.Rev', displayName: 'Rev', type: 'integer', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),

  // ── Identity / person fields ──────────────────────────────────────────────
  field({ referenceName: 'System.AssignedTo', displayName: 'Assigned To', type: 'identity', historyTracked: true, knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.CreatedBy', displayName: 'Created By', type: 'identity', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.ChangedBy', displayName: 'Changed By', type: 'identity', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),

  // ── Date fields ───────────────────────────────────────────────────────────
  field({ referenceName: 'System.ChangedDate', displayName: 'Changed Date', type: 'dateTime', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'System.CreatedDate', displayName: 'Created Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.ClosedDate', displayName: 'Closed Date', type: 'dateTime', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.ResolvedDate', displayName: 'Resolved Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.StateChangeDate', displayName: 'State Change Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),

  // ── Numeric / classification ──────────────────────────────────────────────
  field({ referenceName: 'Microsoft.VSTS.Common.Priority', displayName: 'Priority', type: 'integer', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.Severity', displayName: 'Severity', type: 'integer', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.StackRank', displayName: 'Stack Rank', type: 'double', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),

  // ── VSTS classification strings ───────────────────────────────────────────
  field({ referenceName: 'Microsoft.VSTS.CMMI.RequirementType', displayName: 'Requirement Type', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.VerificationMethod', displayName: 'Verification Method', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.VerificationSite', displayName: 'Verification Site', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.Risk', displayName: 'Risk', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.ValueArea', displayName: 'Value Area', type: 'string', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Microsoft.VSTS.Common.BusinessValue', displayName: 'Business Value', type: 'integer', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.Activity', displayName: 'Activity', type: 'string', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),

  // ── Scheduling fields ────────────────────────────────────────────────────
  field({ referenceName: 'Microsoft.VSTS.Scheduling.StoryPoints', displayName: 'Story Points', type: 'double', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.RemainingWork', displayName: 'Remaining Work', type: 'double', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.OriginalEstimate', displayName: 'Original Estimate', type: 'double', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.CompletedWork', displayName: 'Completed Work', type: 'double', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.StartDate', displayName: 'Start Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.TargetDate', displayName: 'Target Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Scheduling.DueDate', displayName: 'Due Date', type: 'dateTime', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),

  // ── Board fields ─────────────────────────────────────────────────────────
  field({ referenceName: 'System.BoardColumn', displayName: 'Board Column', type: 'string', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'System.BoardLane', displayName: 'Board Lane', type: 'string', knownInDocGen: false, safeForFiltering: true, safeForGrouping: true }),

  // ── Long text (html) — CONTAINS only, not safe for grouping ──────────────
  field({ referenceName: 'System.Description', displayName: 'Description', type: 'html', knownInDocGen: true, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'System.History', displayName: 'History', type: 'html', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', displayName: 'Acceptance Criteria', type: 'html', knownInDocGen: false, safeForFiltering: true, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.Common.VerificationComment', displayName: 'Verification Comment', type: 'html', knownInDocGen: true, safeForFiltering: false, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.TCM.ReproSteps', displayName: 'Repro Steps', type: 'html', knownInDocGen: true, safeForFiltering: false, safeForGrouping: false }),
  field({ referenceName: 'Microsoft.VSTS.TCM.Steps', displayName: 'Steps', type: 'html', knownInDocGen: true, safeForFiltering: false, safeForGrouping: false }),

  // ── Custom / Elisra fields (DocGen-confirmed) ─────────────────────────────
  field({ referenceName: 'Custom.CustomerID', displayName: 'Customer ID', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Custom.CustomerRequirementId', displayName: 'Customer Requirement ID', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Custom.SAPWBS', displayName: 'SAP WBS', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Custom.SubSystem', displayName: 'Sub System', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Custom.TestPhase', displayName: 'Test Phase', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Custom.Phase', displayName: 'Phase', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Elisra.TestPhase', displayName: 'Test Phase (Elisra)', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
  field({ referenceName: 'Elisra.CustomerRequirementId', displayName: 'Customer Requirement ID (Elisra)', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),

  // System.CustomerId — seen in data-provider GetParentLink
  field({ referenceName: 'System.CustomerId', displayName: 'Customer ID (System)', type: 'string', knownInDocGen: true, safeForFiltering: true, safeForGrouping: true }),
];

// ─── Build case-insensitive catalog ───────────────────────────────────────────

export function buildSeedCatalog(): CaseInsensitiveMap<FieldInfo> {
  return CaseInsensitiveMap.fromEntries(SEED_FIELDS.map((f) => [f.referenceName, f]));
}

/** Shared singleton seed catalog. Phase 5 discovery replaces per-collection. */
export const SEED_FIELD_CATALOG: CaseInsensitiveMap<FieldInfo> = buildSeedCatalog();
