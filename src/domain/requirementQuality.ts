import type { ConfidenceLevel } from './confidence.js';

export type QualityAttribute =
  | 'clear'
  | 'complete'
  | 'consistent'
  | 'singular'
  | 'verifiable'
  | 'feasible'
  | 'traceable';

export type FindingStatus = 'ok' | 'warn' | 'missing' | 'unknown';

export type OverallRisk = 'none' | 'low' | 'medium' | 'high';

export interface TraceabilityLink {
  rel: string;
  targetId: number;
}

export interface AttributeFinding {
  attribute: QualityAttribute;
  status: FindingStatus;
  confidence: ConfidenceLevel;
  confidenceReason: string;
  evidence: string[];
  links?: TraceabilityLink[];
  limitation?: string;
  recommendation?: string;
}

export interface ReviewFinding {
  workItemId: number;
  workItemType: string;
  title: string;
  findings: AttributeFinding[];
  overallRisk: OverallRisk;
}

export interface ReviewSummary {
  totalReviewed: number;
  byRisk: Record<OverallRisk, number>;
  byAttribute: Record<QualityAttribute, Record<FindingStatus, number>>;
}

/**
 * Derives overall risk from the worst high-confidence finding.
 * - `high`:   any high-confidence warn/missing
 * - `medium`: any medium-confidence warn/missing
 * - `low`:    only low-confidence warn/missing
 * - `none`:   all ok or unknown
 */
export function computeOverallRisk(findings: AttributeFinding[]): OverallRisk {
  const problems = findings.filter((f) => f.status === 'warn' || f.status === 'missing');
  if (problems.some((f) => f.confidence === 'high')) return 'high';
  if (problems.some((f) => f.confidence === 'medium')) return 'medium';
  if (problems.some((f) => f.confidence === 'low')) return 'low';
  return 'none';
}

export function summarizeFindings(findings: ReviewFinding[]): ReviewSummary {
  const ATTRIBUTES: QualityAttribute[] = [
    'clear', 'complete', 'consistent', 'singular', 'verifiable', 'feasible', 'traceable',
  ];
  const RISKS: OverallRisk[] = ['none', 'low', 'medium', 'high'];
  const STATUSES: FindingStatus[] = ['ok', 'warn', 'missing', 'unknown'];

  const byRisk = Object.fromEntries(RISKS.map((r) => [r, 0])) as Record<OverallRisk, number>;
  const byAttribute = Object.fromEntries(
    ATTRIBUTES.map((a) => [a, Object.fromEntries(STATUSES.map((s) => [s, 0]))])
  ) as Record<QualityAttribute, Record<FindingStatus, number>>;

  for (const rf of findings) {
    byRisk[rf.overallRisk]++;
    for (const af of rf.findings) {
      byAttribute[af.attribute][af.status]++;
    }
  }

  return { totalReviewed: findings.length, byRisk, byAttribute };
}
