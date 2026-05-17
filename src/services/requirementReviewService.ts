import type { AdoWorkItem } from '../types/ado.js';
import type { AttributeFinding, ReviewFinding } from '../domain/requirementQuality.js';
import { computeOverallRisk } from '../domain/requirementQuality.js';
import { findVagueTerms, findRiskTerms, countShall } from '../domain/lexicon.js';
import { htmlToText } from '../utils/htmlToText.js';

// Fields that must be fetched for a complete review
export const REVIEW_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AreaPath',
  'System.IterationPath',
  'System.Description',
  'System.AssignedTo',
  'System.ChangedDate',
  // These fields are filtered against the live ADO field catalog in reviewTools.ts
  // before the workitemsbatch call, so collection-missing fields are dropped at runtime.
  'Microsoft.VSTS.Common.VerificationMethod',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
] as const;

function hasTraceabilityLink(item: AdoWorkItem, tokens: readonly string[]): boolean | null {
  if (!item.relations) return null; // relations not fetched
  return item.relations.some((r) => tokens.some((token) => r.rel.includes(token)));
}

function fieldText(item: AdoWorkItem, field: string): string {
  const raw = item.fields[field];
  if (!raw) return '';
  const str = String(raw);
  // Strip HTML for html-type fields
  return htmlToText(str);
}

// ─── Attribute reviewers ──────────────────────────────────────────────────────

function reviewClear(item: AdoWorkItem): AttributeFinding {
  const title = fieldText(item, 'System.Title');
  const description = fieldText(item, 'System.Description');

  if (!title) {
    return {
      attribute: 'clear',
      status: 'missing',
      confidence: 'high',
      confidenceReason: 'System.Title is absent — deterministic.',
      evidence: [],
      recommendation: 'Add a concise, unambiguous title.',
    };
  }

  const vagueInTitle = findVagueTerms(title);
  const vagueInDesc = findVagueTerms(description);
  const allVague = [...new Set([...vagueInTitle, ...vagueInDesc])];

  if (allVague.length > 0) {
    return {
      attribute: 'clear',
      status: 'warn',
      confidence: 'medium',
      confidenceReason: 'Vague terms detected via lexicon match — text heuristic.',
      evidence: allVague.map((t) => `Vague term: "${t}"`),
      recommendation: `Replace vague terms with specific, measurable language: ${allVague.slice(0, 3).join(', ')}.`,
    };
  }

  return {
    attribute: 'clear',
    status: 'ok',
    confidence: 'medium',
    confidenceReason: 'No vague terms detected — lexicon scan is heuristic, not exhaustive.',
    evidence: [],
  };
}

function reviewSingular(item: AdoWorkItem): AttributeFinding {
  const description = fieldText(item, 'System.Description');
  const title = fieldText(item, 'System.Title');

  const shallCount = countShall(description) + countShall(title);

  if (shallCount > 3) {
    return {
      attribute: 'singular',
      status: 'warn',
      confidence: 'medium',
      confidenceReason: `Found ${shallCount} "shall" occurrences — possible multiple requirements merged.`,
      evidence: [`"shall" count: ${shallCount}`],
      recommendation: 'Split into separate work items, one requirement per item.',
    };
  }

  // Check for "and shall" pattern — strong signal of merged requirements
  const combined = `${title} ${description}`.toLowerCase();
  if (/\bshall\b.{1,200}\bshall\b/s.test(combined) && shallCount >= 2) {
    return {
      attribute: 'singular',
      status: 'warn',
      confidence: 'medium',
      confidenceReason: 'Multiple "shall" clauses detected — may contain more than one requirement.',
      evidence: [`"shall" count: ${shallCount}`],
      recommendation: 'Consider splitting into separate requirements.',
    };
  }

  return {
    attribute: 'singular',
    status: 'ok',
    confidence: 'medium',
    confidenceReason: 'No obvious multi-requirement pattern detected — heuristic only.',
    evidence: [],
    limitation: 'Cannot fully determine singularity from text alone.',
  };
}

function reviewVerifiable(item: AdoWorkItem): AttributeFinding {
  const verificationMethod = item.fields['Microsoft.VSTS.Common.VerificationMethod'];

  if (verificationMethod) {
    return {
      attribute: 'verifiable',
      status: 'ok',
      confidence: 'high',
      confidenceReason: 'Verification method field is set — deterministic.',
      evidence: [`VerificationMethod: ${String(verificationMethod)}`],
    };
  }

  // Fall back to heuristic: does the description contain measurable criteria?
  const description = fieldText(item, 'System.Description');
  const hasNumeric = /\d+\s*(%|ms|s\b|sec|seconds?|minutes?|hours?|days?|KB|MB|GB|rpm|fps|Hz|dB)/i.test(description);

  if (hasNumeric) {
    return {
      attribute: 'verifiable',
      status: 'ok',
      confidence: 'medium',
      confidenceReason: 'Description contains measurable criteria (numbers + units) — text heuristic.',
      evidence: ['Description contains numeric threshold or unit of measure.'],
      limitation: 'VerificationMethod field is not set. Confirm with test team.',
      recommendation: 'Set the Verification Method field for traceability.',
    };
  }

  return {
    attribute: 'verifiable',
    status: 'warn',
    confidence: 'medium',
    confidenceReason: 'No Verification Method field and no measurable criteria detected in description.',
    evidence: [],
    recommendation: 'Set the Verification Method field and add specific acceptance thresholds.',
  };
}

function reviewTraceable(item: AdoWorkItem, tokens: readonly string[]): AttributeFinding {
  const traceability = hasTraceabilityLink(item, tokens);

  if (traceability === null) {
    return {
      attribute: 'traceable',
      status: 'unknown',
      confidence: 'low',
      confidenceReason: 'Relations were not fetched for this work item.',
      evidence: [],
      limitation: 'Re-run with expand=relations to evaluate traceability.',
    };
  }

  if (traceability) {
    const links = (item.relations ?? [])
      .filter((r) => tokens.some((t) => r.rel.includes(t)))
      .map((r) => r.rel);

    return {
      attribute: 'traceable',
      status: 'ok',
      confidence: 'high',
      confidenceReason: 'At least one traceability link (Affects, CoveredBy, TestedBy) exists — deterministic.',
      evidence: [...new Set(links)].map((r) => `Link: ${r}`),
    };
  }

  return {
    attribute: 'traceable',
    status: 'warn',
    confidence: 'high',
    confidenceReason: 'No traceability links (Affects, CoveredBy, TestedBy) found — deterministic.',
    evidence: [],
    recommendation: 'Add traceability links to parent requirements, covering tests, or affected items.',
  };
}

function reviewComplete(item: AdoWorkItem): AttributeFinding {
  const description = fieldText(item, 'System.Description');

  if (!description) {
    return {
      attribute: 'complete',
      status: 'missing',
      confidence: 'high',
      confidenceReason: 'System.Description is absent — deterministic.',
      evidence: [],
      recommendation: 'Add a description with rationale, scope, and acceptance criteria.',
    };
  }

  if (description.length < 30) {
    return {
      attribute: 'complete',
      status: 'warn',
      confidence: 'medium',
      confidenceReason: `Description is very short (${description.length} chars) — heuristic threshold.`,
      evidence: [`Description length: ${description.length} chars`],
      recommendation: 'Expand the description with rationale, preconditions, and expected behavior.',
    };
  }

  const acceptanceCriteria = fieldText(item, 'Microsoft.VSTS.Common.AcceptanceCriteria');
  if (!acceptanceCriteria) {
    return {
      attribute: 'complete',
      status: 'warn',
      confidence: 'medium',
      confidenceReason: 'Acceptance Criteria field is empty — heuristic.',
      evidence: ['AcceptanceCriteria: (empty)'],
      recommendation: 'Define acceptance criteria so testers and developers have clear done conditions.',
      limitation: 'Full completeness requires context review (Phase 8).',
    };
  }

  return {
    attribute: 'complete',
    status: 'ok',
    confidence: 'medium',
    confidenceReason: 'Description and Acceptance Criteria are present — heuristic.',
    evidence: [`Description: ${description.length} chars`, 'AcceptanceCriteria: present'],
    limitation: 'Full completeness (parent/sibling context) requires Phase 8 context review.',
  };
}

function reviewConsistent(_item: AdoWorkItem): AttributeFinding {
  // Single-item consistency check is always unknown — requires sibling/context analysis (Phase 8)
  return {
    attribute: 'consistent',
    status: 'unknown',
    confidence: 'low',
    confidenceReason: 'Consistency requires comparison with sibling or related requirements.',
    evidence: [],
    limitation: 'Single-item analysis cannot detect conflicts. Use ado_find_requirement_consistency_candidates for cross-item analysis.',
  };
}

function reviewFeasible(item: AdoWorkItem): AttributeFinding {
  const title = fieldText(item, 'System.Title');
  const description = fieldText(item, 'System.Description');
  const combined = `${title} ${description}`;

  const riskTerms = findRiskTerms(combined);

  if (riskTerms.length > 0) {
    return {
      attribute: 'feasible',
      status: 'warn',
      confidence: 'low',
      confidenceReason: 'Absolute/infeasible language detected — low confidence (requires domain expert validation).',
      evidence: riskTerms.map((t) => `Risk term: "${t}"`),
      recommendation: `Review absolute constraints for feasibility: ${riskTerms.slice(0, 3).join(', ')}.`,
      limitation: 'Feasibility depends on technical and budget constraints not available in ADO.',
    };
  }

  return {
    attribute: 'feasible',
    status: 'unknown',
    confidence: 'low',
    confidenceReason: 'Feasibility cannot be assessed without external technical/budget context.',
    evidence: [],
    limitation: 'Feasibility assessment is out of scope for automated review.',
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class RequirementReviewService {
  review(items: AdoWorkItem[], opts: { traceabilityTokens: readonly string[] }): ReviewFinding[] {
    return items.map((item) => this.reviewItem(item, opts.traceabilityTokens));
  }

  private reviewItem(item: AdoWorkItem, tokens: readonly string[]): ReviewFinding {
    const findings: AttributeFinding[] = [
      reviewClear(item),
      reviewSingular(item),
      reviewVerifiable(item),
      reviewTraceable(item, tokens),
      reviewComplete(item),
      reviewConsistent(item),
      reviewFeasible(item),
    ];

    return {
      workItemId: item.id,
      workItemType: String(item.fields['System.WorkItemType'] ?? 'Unknown'),
      title: String(item.fields['System.Title'] ?? ''),
      findings,
      overallRisk: computeOverallRisk(findings),
    };
  }
}
