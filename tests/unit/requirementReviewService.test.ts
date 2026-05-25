import { describe, it, expect } from 'vitest';
import { RequirementReviewService } from '../../src/services/requirementReviewService.js';
import { computeOverallRisk, summarizeFindings } from '../../src/domain/requirementQuality.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import type { AttributeFinding, ReviewFinding } from '../../src/domain/requirementQuality.js';

const svc = new RequirementReviewService();
const DEFAULT_TOKENS = ['Affects', 'CoveredBy', 'TestedBy'];
const defaultOpts = { traceabilityTokens: DEFAULT_TOKENS };

function makeItem(fields: Record<string, unknown>, relations?: AdoWorkItem['relations']): AdoWorkItem {
  return { id: 1, fields: { 'System.Id': 1, 'System.WorkItemType': 'Requirement', ...fields }, relations };
}

function findAttr(findings: ReviewFinding, attr: string): AttributeFinding {
  return findings.findings.find((f) => f.attribute === attr)!;
}

// ─── clear ────────────────────────────────────────────────────────────────────

describe('RequirementReviewService — clear', () => {
  it('missing title → status=missing, confidence=high', () => {
    const item = makeItem({ 'System.Title': '' });
    const result = svc.review([item], defaultOpts)[0];
    const f = findAttr(result, 'clear');
    expect(f.status).toBe('missing');
    expect(f.confidence).toBe('high');
  });

  it('title with vague term → status=warn, confidence=medium', () => {
    const item = makeItem({ 'System.Title': 'The system shall support appropriate data formats' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'clear');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('medium');
    expect(f.evidence.some((e) => e.includes('appropriate'))).toBe(true);
  });

  it('vague term in description → warn', () => {
    const item = makeItem({
      'System.Title': 'The system shall process data',
      'System.Description': 'Process data as needed for optimal performance',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'clear');
    expect(f.status).toBe('warn');
    expect(f.evidence.some((e) => e.toLowerCase().includes('as needed') || e.toLowerCase().includes('optimal'))).toBe(true);
  });

  it('clean title → status=ok', () => {
    const item = makeItem({ 'System.Title': 'The system shall encrypt data at rest using AES-256' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'clear');
    expect(f.status).toBe('ok');
  });

  it('TBD in title → warn', () => {
    const item = makeItem({ 'System.Title': 'TBD - system shall process data' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'clear');
    expect(f.status).toBe('warn');
  });
});

// ─── singular ─────────────────────────────────────────────────────────────────

describe('RequirementReviewService — singular', () => {
  it('description with > 3 shall → warn', () => {
    const item = makeItem({
      'System.Title': 'Multi-req',
      'System.Description': 'The system shall do A. The system shall do B. The system shall do C. The system shall do D.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'singular');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('medium');
  });

  it('single shall → ok', () => {
    const item = makeItem({
      'System.Title': 'Login',
      'System.Description': 'The system shall authenticate users with username and password.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'singular');
    expect(f.status).toBe('ok');
  });

  it('no shall → ok', () => {
    const item = makeItem({ 'System.Title': 'Process data', 'System.Description': 'Processes input data.' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'singular');
    expect(f.status).toBe('ok');
  });
});

// ─── verifiable ───────────────────────────────────────────────────────────────

describe('RequirementReviewService — verifiable', () => {
  it('VerificationMethod field set → ok, high confidence', () => {
    const item = makeItem({
      'System.Title': 'Encrypt data',
      'Microsoft.VSTS.Common.VerificationMethod': 'Test',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'verifiable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
    expect(f.evidence[0]).toContain('Test');
  });

  it('no VerificationMethod but has numeric threshold → ok, medium', () => {
    const item = makeItem({
      'System.Title': 'Fast response',
      'System.Description': 'The system shall respond within 200ms for all requests.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'verifiable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('medium');
  });

  it('no VerificationMethod and no numeric → warn', () => {
    const item = makeItem({
      'System.Title': 'The system shall be fast',
      'System.Description': 'Process data quickly.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'verifiable');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('medium');
  });

  it('recognizes percentage as measurable', () => {
    const item = makeItem({
      'System.Title': 'High availability',
      'System.Description': 'System shall be available 99.9% of the time.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'verifiable');
    expect(f.status).toBe('ok');
  });
});

// ─── traceable ────────────────────────────────────────────────────────────────

describe('RequirementReviewService — traceable', () => {
  it('has CoveredBy link → ok, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Elisra.CoveredBy-Forward', url: 'https://tfs/wi/2', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
  });

  it('has TestedBy link → ok, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: 'https://tfs/wi/3', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
  });

  it('has Affects link → ok, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'System.LinkTypes.Affects-Forward', url: 'https://tfs/wi/4', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
  });

  it('no traceability links (only hierarchy) → warn, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://tfs/wi/5', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('high');
  });

  it('no relations at all → warn, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }, []);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('high');
  });

  it('relations not fetched (undefined) → unknown, low confidence', () => {
    const item = makeItem({ 'System.Title': 'Req' }); // no relations field
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('unknown');
    expect(f.confidence).toBe('low');
  });

  it('custom token "Implements" recognizes Custom.Implements-Forward rel', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Custom.Implements-Forward', url: 'https://tfs/wi/9', attributes: {} },
    ]);
    const customOpts = { traceabilityTokens: ['Affects', 'CoveredBy', 'TestedBy', 'Implements'] };
    const f = findAttr(svc.review([item], customOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
  });

  it('default tokens do NOT recognize Custom.Implements-Forward rel', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Custom.Implements-Forward', url: 'https://tfs/wi/9', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('warn');
  });
});

// ─── complete ─────────────────────────────────────────────────────────────────

describe('RequirementReviewService — complete', () => {
  it('missing description → missing, high confidence', () => {
    const item = makeItem({ 'System.Title': 'Req', 'System.Description': '' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'complete');
    expect(f.status).toBe('missing');
    expect(f.confidence).toBe('high');
  });

  it('very short description → warn, medium', () => {
    const item = makeItem({ 'System.Title': 'Req', 'System.Description': 'Short.' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'complete');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('medium');
  });

  it('adequate description but no acceptance criteria → warn, medium', () => {
    const item = makeItem({
      'System.Title': 'Req',
      'System.Description': 'The system shall authenticate users using username and password credentials stored securely.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': '',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'complete');
    expect(f.status).toBe('warn');
    expect(f.evidence.some((e) => e.includes('AcceptanceCriteria'))).toBe(true);
  });

  it('description + acceptance criteria → ok', () => {
    const item = makeItem({
      'System.Title': 'Req',
      'System.Description': 'The system shall authenticate users using username and password credentials stored securely in a hash.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'Given valid credentials, user logs in successfully.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'complete');
    expect(f.status).toBe('ok');
  });

  it('strips HTML from description before length check', () => {
    const item = makeItem({
      'System.Title': 'Req',
      // HTML with lots of tags but short text content
      'System.Description': '<p><b>Hi.</b></p>',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'complete');
    expect(f.status).toBe('warn'); // "Hi." is < 30 chars after stripping
  });
});

// ─── consistent ───────────────────────────────────────────────────────────────

describe('RequirementReviewService — consistent', () => {
  it('always unknown for single item', () => {
    const item = makeItem({ 'System.Title': 'Req' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'consistent');
    expect(f.status).toBe('unknown');
    expect(f.confidence).toBe('low');
  });
});

// ─── feasible ─────────────────────────────────────────────────────────────────

describe('RequirementReviewService — feasible', () => {
  it('no risk terms → unknown, low confidence', () => {
    const item = makeItem({ 'System.Title': 'Req', 'System.Description': 'Process data efficiently.' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'feasible');
    expect(f.status).toBe('unknown');
    expect(f.confidence).toBe('low');
  });

  it('risk term in title → warn, low confidence', () => {
    const item = makeItem({ 'System.Title': 'System shall guarantee 100% uptime' });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'feasible');
    expect(f.status).toBe('warn');
    expect(f.confidence).toBe('low');
    expect(f.evidence.some((e) => e.includes('guaranteed') || e.includes('100%'))).toBe(true);
  });

  it('real-time in description → warn', () => {
    const item = makeItem({
      'System.Title': 'Live updates',
      'System.Description': 'The system shall provide real-time updates to all connected clients.',
    });
    const f = findAttr(svc.review([item], defaultOpts)[0], 'feasible');
    expect(f.status).toBe('warn');
  });
});

// ─── overallRisk ──────────────────────────────────────────────────────────────

describe('computeOverallRisk', () => {
  it('all ok → none', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'clear', status: 'ok', confidence: 'high', confidenceReason: '', evidence: [] },
      { attribute: 'complete', status: 'ok', confidence: 'medium', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('none');
  });

  it('high-confidence warn → high', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'traceable', status: 'warn', confidence: 'high', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('high');
  });

  it('medium-confidence warn → medium', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'clear', status: 'warn', confidence: 'medium', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('medium');
  });

  it('only low-confidence → low', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'feasible', status: 'warn', confidence: 'low', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('low');
  });

  it('unknown status does not contribute to risk', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'consistent', status: 'unknown', confidence: 'low', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('none');
  });

  it('high-confidence missing → high', () => {
    const findings: AttributeFinding[] = [
      { attribute: 'complete', status: 'missing', confidence: 'high', confidenceReason: '', evidence: [] },
    ];
    expect(computeOverallRisk(findings)).toBe('high');
  });
});

// ─── summarizeFindings ────────────────────────────────────────────────────────

describe('summarizeFindings', () => {
  it('counts by risk and attribute', () => {
    const findings: ReviewFinding[] = svc.review([
      makeItem({ 'System.Title': '', 'System.Description': '' }, []),          // multiple issues → high
      makeItem({ 'System.Title': 'Good req encrypted with AES-256 in 200ms' }, // decent item
        [{ rel: 'Elisra.CoveredBy-Forward', url: 'https://tfs/wi/2', attributes: {} }]),
    ], defaultOpts);
    const summary = summarizeFindings(findings);
    expect(summary.totalReviewed).toBe(2);
    expect(summary.byRisk.high).toBeGreaterThanOrEqual(1);
    expect(summary.byAttribute.clear).toBeDefined();
    expect(typeof summary.byAttribute.clear.ok).toBe('number');
  });

  it('returns zero counts for empty input', () => {
    const summary = summarizeFindings([]);
    expect(summary.totalReviewed).toBe(0);
    expect(summary.byRisk.none).toBe(0);
  });
});

// ─── traceable links[] (cross-scope join data) ────────────────────────────────

const ADO_URL = (id: number) =>
  `https://tfs.example.com/tfs/DefaultCollection/_apis/wit/workItems/${id}`;

describe('RequirementReviewService — traceable.links', () => {
  it('CoveredBy link populates links[].targetId', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Elisra.CoveredBy-Forward', url: ADO_URL(42), attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.links).toEqual([{ rel: 'Elisra.CoveredBy-Forward', targetId: 42 }]);
  });

  it('evidence string includes → #targetId', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Elisra.CoveredBy-Forward', url: ADO_URL(42), attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.evidence[0]).toBe('Link: Elisra.CoveredBy-Forward → #42');
  });

  it('multiple matching links → all targetIds in links[]', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Elisra.CoveredBy-Forward', url: ADO_URL(10), attributes: {} },
      { rel: 'Elisra.CoveredBy-Reverse', url: ADO_URL(20), attributes: {} },
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: ADO_URL(99), attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.links).toHaveLength(2);
    expect(f.links?.map((l) => l.targetId)).toEqual(expect.arrayContaining([10, 20]));
  });

  it('non-matching relations only → links === []', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: ADO_URL(5), attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('warn');
    expect(f.links).toEqual([]);
  });

  it('empty relations array → links === []', () => {
    const item = makeItem({ 'System.Title': 'Req' }, []);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.links).toEqual([]);
  });

  it('relations not fetched → links is undefined', () => {
    const item = makeItem({ 'System.Title': 'Req' }); // no relations property
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('unknown');
    expect(f.links).toBeUndefined();
  });

  it('url does not contain workItems path → targetId excluded from links', () => {
    const item = makeItem({ 'System.Title': 'Req' }, [
      { rel: 'Elisra.CoveredBy-Forward', url: 'https://tfs/wi/7', attributes: {} },
    ]);
    const f = findAttr(svc.review([item], defaultOpts)[0], 'traceable');
    expect(f.status).toBe('ok');
    expect(f.links).toEqual([]);
  });
});
