/**
 * Canonical Azure DevOps link-type reference names.
 *
 * DocGen note: the data-provider uses substring matching ('Affects', 'CoveredBy')
 * on relation.rel and relation.attributes.name. These constants are the ground truth
 * for the MCP server — use them for exact matching where possible and fall back to
 * substring matching only for legacy compatibility.
 */
export const ADO_LINK_TYPES = {
  // Built-in hierarchy
  HIERARCHY_FORWARD: 'System.LinkTypes.Hierarchy-Forward',  // Parent → Children
  HIERARCHY_REVERSE: 'System.LinkTypes.Hierarchy-Reverse',  // Child → Parent

  // Generic
  RELATED: 'System.LinkTypes.Related',

  // Affects (built-in CMMI)
  AFFECTS_FORWARD: 'System.LinkTypes.Affects-Forward',
  AFFECTS_REVERSE: 'System.LinkTypes.Affects-Reverse',

  // Test coverage
  TESTED_BY_FORWARD: 'Microsoft.VSTS.Common.TestedBy-Forward',
  TESTED_BY_REVERSE: 'Microsoft.VSTS.Common.TestedBy-Reverse',

  // Non-work-item links
  ARTIFACT_LINK: 'ArtifactLink',
  HYPERLINK: 'Hyperlink',
  ATTACHED_FILE: 'AttachedFile',

  // Elisra project-custom link types
  ELISRA_COVERED_BY_FORWARD: 'Elisra.CoveredBy-Forward',  // "Covered by" — system covers customer req
  ELISRA_COVERED_BY_REVERSE: 'Elisra.CoveredBy-Reverse',  // "Covers" — customer req covered by system
} as const;

export type AdoLinkType = (typeof ADO_LINK_TYPES)[keyof typeof ADO_LINK_TYPES];

// Substring tokens DocGen uses to classify traceability relations
export const TRACEABILITY_TOKENS = ['Affects', 'CoveredBy'] as const;

// Relation types that do NOT link to other work items — skip these when collecting WI IDs
export const NON_WI_RELATION_TYPES: ReadonlySet<string> = new Set([
  ADO_LINK_TYPES.ARTIFACT_LINK,
  ADO_LINK_TYPES.HYPERLINK,
  ADO_LINK_TYPES.ATTACHED_FILE,
]);

/**
 * Returns true if the relation rel-name is a traceability link (Affects or CoveredBy).
 * Mirrors DocGen's isTraceabilityRel() in utils/tablePresentation.ts.
 */
export function isTraceabilityRel(rel: string): boolean {
  return TRACEABILITY_TOKENS.some((token) => rel.includes(token));
}

/**
 * Returns true if the relation links to another work item (not an artifact/hyperlink/attachment).
 */
export function isWorkItemRel(rel: string): boolean {
  return !NON_WI_RELATION_TYPES.has(rel);
}
