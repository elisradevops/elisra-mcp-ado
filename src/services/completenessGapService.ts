import type { AdoWorkItem } from '../types/ado.js';
import { htmlToText } from '../utils/htmlToText.js';
import { ADO_LINK_TYPES } from '../domain/adoLinkTypes.js';

export type GapLevel = 'L1' | 'L2' | 'L3';
export type ContextMode = 'L1' | 'L2' | 'L3';

export interface GapFinding {
  level: GapLevel;
  kind: string;
  message: string;
  confidence: 'high' | 'medium' | 'low';
  evidence?: string;
}

export interface WorkItemGaps {
  workItemId: number;
  workItemType: string;
  title: string;
  gaps: GapFinding[];
}

export interface CompletenessReport {
  totalAnalyzed: number;
  totalWithGaps: number;
  gapCountByLevel: Record<GapLevel, number>;
  gapCountByKind: Record<string, number>;
  findings: WorkItemGaps[];
}

const TRACEABILITY_RELS = new Set([
  ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD,
  ADO_LINK_TYPES.ELISRA_COVERED_BY_REVERSE,
  ADO_LINK_TYPES.AFFECTS_FORWARD,
  ADO_LINK_TYPES.AFFECTS_REVERSE,
  ADO_LINK_TYPES.TESTED_BY_FORWARD,
]);

function fieldText(item: AdoWorkItem, field: string): string {
  const raw = item.fields[field];
  if (!raw) return '';
  return htmlToText(String(raw));
}

function analyzeL1(item: AdoWorkItem): GapFinding[] {
  const gaps: GapFinding[] = [];
  const desc = fieldText(item, 'System.Description');

  if (!desc) {
    gaps.push({ level: 'L1', kind: 'missing_description', confidence: 'high', message: 'Description is absent.' });
  } else if (desc.length < 30) {
    gaps.push({
      level: 'L1',
      kind: 'short_description',
      confidence: 'medium',
      message: `Description is very short (${desc.length} chars).`,
      evidence: `${desc.length} chars`,
    });
  }

  const acceptanceCriteria = fieldText(item, 'Microsoft.VSTS.Common.AcceptanceCriteria');
  if (!acceptanceCriteria) {
    gaps.push({ level: 'L1', kind: 'missing_acceptance_criteria', confidence: 'medium', message: 'Acceptance Criteria field is empty.' });
  }

  const verificationMethod = item.fields['Microsoft.VSTS.Common.VerificationMethod'];
  if (!verificationMethod) {
    gaps.push({ level: 'L1', kind: 'missing_verification_method', confidence: 'medium', message: 'Verification Method field is not set.' });
  }

  return gaps;
}

function analyzeL2(item: AdoWorkItem): GapFinding[] {
  if (!item.relations) return []; // relations not fetched — skip rather than false-positive

  const gaps: GapFinding[] = [];
  const hasTraceability = item.relations.some((r) => TRACEABILITY_RELS.has(r.rel as never));

  if (!hasTraceability) {
    gaps.push({
      level: 'L2',
      kind: 'no_traceability_links',
      confidence: 'high',
      message: 'No traceability links (Covers, CoveredBy, TestedBy, Affects).',
    });
  }

  return gaps;
}

function analyzeL3(item: AdoWorkItem, peers: AdoWorkItem[]): GapFinding[] {
  if (peers.length === 0) return [];

  const gaps: GapFinding[] = [];
  const FIELD_CHECKS = [
    'System.Description',
    'Microsoft.VSTS.Common.AcceptanceCriteria',
    'Microsoft.VSTS.Common.VerificationMethod',
  ];

  for (const field of FIELD_CHECKS) {
    const peerCount = peers.filter((p) => {
      const v = p.fields[field];
      return v !== undefined && v !== null && v !== '';
    }).length;

    if (peerCount === 0) continue; // no peer has it either — skip

    const thisHas = (() => {
      const v = item.fields[field];
      return v !== undefined && v !== null && v !== '';
    })();

    if (!thisHas) {
      const shortName = field.split('.').pop() ?? field;
      gaps.push({
        level: 'L3',
        kind: `missing_${shortName.toLowerCase()}`,
        confidence: 'medium',
        message: `Field "${field}" is present in ${peerCount}/${peers.length} peer(s) but absent here.`,
        evidence: `${peerCount}/${peers.length} peers have this field`,
      });
    }
  }

  return gaps;
}

export class CompletenessGapService {
  /**
   * Analyze work items for completeness gaps.
   * peerGroups: map from item ID → sibling/sameField items (for L3 analysis).
   */
  analyze(
    items: AdoWorkItem[],
    contextMode: ContextMode,
    peerGroups?: Map<number, AdoWorkItem[]>
  ): CompletenessReport {
    const findings: WorkItemGaps[] = [];
    const gapCountByLevel: Record<GapLevel, number> = { L1: 0, L2: 0, L3: 0 };
    const gapCountByKind: Record<string, number> = {};

    for (const item of items) {
      const gaps: GapFinding[] = [];

      gaps.push(...analyzeL1(item));

      if (contextMode === 'L2' || contextMode === 'L3') {
        gaps.push(...analyzeL2(item));
      }

      if (contextMode === 'L3' && peerGroups) {
        const peers = peerGroups.get(item.id) ?? [];
        gaps.push(...analyzeL3(item, peers));
      }

      for (const gap of gaps) {
        gapCountByLevel[gap.level]++;
        gapCountByKind[gap.kind] = (gapCountByKind[gap.kind] ?? 0) + 1;
      }

      if (gaps.length > 0) {
        findings.push({
          workItemId: item.id,
          workItemType: String(item.fields['System.WorkItemType'] ?? 'Unknown'),
          title: String(item.fields['System.Title'] ?? ''),
          gaps,
        });
      }
    }

    return {
      totalAnalyzed: items.length,
      totalWithGaps: findings.length,
      gapCountByLevel,
      gapCountByKind,
      findings,
    };
  }
}
