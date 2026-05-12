import { describe, it, expect } from 'vitest';
import { CompletenessGapService } from '../../src/services/completenessGapService.js';
import type { AdoWorkItem } from '../../src/types/ado.js';

const svc = new CompletenessGapService();

function makeItem(
  id: number,
  fields: Record<string, unknown>,
  relations?: AdoWorkItem['relations']
): AdoWorkItem {
  return {
    id,
    fields: { 'System.Id': id, 'System.WorkItemType': 'Requirement', 'System.Title': `Item ${id}`, ...fields },
    relations,
  };
}

// ─── L1 analysis ─────────────────────────────────────────────────────────────

describe('CompletenessGapService — L1', () => {
  it('flags missing description', () => {
    const item = makeItem(1, {});
    const report = svc.analyze([item], 'L1');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'missing_description');
    expect(gap).toBeDefined();
    expect(gap?.level).toBe('L1');
    expect(gap?.confidence).toBe('high');
  });

  it('flags short description', () => {
    const item = makeItem(1, { 'System.Description': 'Short.' });
    const report = svc.analyze([item], 'L1');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'short_description');
    expect(gap).toBeDefined();
    expect(gap?.level).toBe('L1');
    expect(gap?.confidence).toBe('medium');
  });

  it('flags missing acceptance criteria', () => {
    const item = makeItem(1, { 'System.Description': 'A long enough description to avoid the short-description gap.' });
    const report = svc.analyze([item], 'L1');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'missing_acceptance_criteria');
    expect(gap).toBeDefined();
  });

  it('flags missing verification method', () => {
    const item = makeItem(1, { 'System.Description': 'A long enough description to avoid the short-description gap.' });
    const report = svc.analyze([item], 'L1');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'missing_verification_method');
    expect(gap).toBeDefined();
  });

  it('no gaps when all fields are present', () => {
    const item = makeItem(1, {
      'System.Description': 'The system shall authenticate users with username and password credentials.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'Given valid credentials, user is authenticated.',
      'Microsoft.VSTS.Common.VerificationMethod': 'Test',
    });
    const report = svc.analyze([item], 'L1');
    expect(report.totalWithGaps).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('strips HTML from description before length check', () => {
    // HTML with lots of tags but short text
    const item = makeItem(1, { 'System.Description': '<p><b>Hi.</b></p>' });
    const report = svc.analyze([item], 'L1');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'short_description');
    expect(gap).toBeDefined(); // "Hi." is short after HTML stripping
  });

  it('aggregates gapCountByLevel and gapCountByKind', () => {
    const item = makeItem(1, {});
    const report = svc.analyze([item], 'L1');
    expect(report.gapCountByLevel.L1).toBeGreaterThan(0);
    expect(report.gapCountByKind['missing_description']).toBe(1);
  });
});

// ─── L2 analysis ─────────────────────────────────────────────────────────────

describe('CompletenessGapService — L2', () => {
  it('flags no traceability links when relations are empty', () => {
    const item = makeItem(1, {}, []);
    const report = svc.analyze([item], 'L2');
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'no_traceability_links');
    expect(gap).toBeDefined();
    expect(gap?.level).toBe('L2');
    expect(gap?.confidence).toBe('high');
  });

  it('no L2 gap when Elisra.CoveredBy-Forward link exists', () => {
    const item = makeItem(1, {
      'System.Description': 'A sufficiently long description text here.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'Criteria.',
      'Microsoft.VSTS.Common.VerificationMethod': 'Test',
    }, [
      { rel: 'Elisra.CoveredBy-Forward', url: 'https://tfs/wi/2', attributes: {} },
    ]);
    const report = svc.analyze([item], 'L2');
    const l2Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L2');
    expect(l2Gaps).toHaveLength(0);
  });

  it('no L2 gap when TestedBy-Forward link exists', () => {
    const item = makeItem(1, {
      'System.Description': 'A sufficiently long description text here.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'Criteria.',
      'Microsoft.VSTS.Common.VerificationMethod': 'Test',
    }, [
      { rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: 'https://tfs/wi/3', attributes: {} },
    ]);
    const report = svc.analyze([item], 'L2');
    const l2Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L2');
    expect(l2Gaps).toHaveLength(0);
  });

  it('skips L2 analysis when relations not fetched (undefined)', () => {
    const item = makeItem(1, {}); // relations=undefined
    const report = svc.analyze([item], 'L2');
    const l2Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L2');
    // Relations not fetched — should not produce false-positive L2 gap
    expect(l2Gaps).toHaveLength(0);
  });

  it('L1 mode does not produce L2 gaps', () => {
    const item = makeItem(1, {}, []);
    const report = svc.analyze([item], 'L1');
    const l2Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L2');
    expect(l2Gaps).toHaveLength(0);
  });
});

// ─── L3 analysis ─────────────────────────────────────────────────────────────

describe('CompletenessGapService — L3', () => {
  it('flags missing field when peers have it', () => {
    const target = makeItem(1, {
      'System.Description': 'A long enough description for this item.',
    });
    const peer = makeItem(2, {
      'System.Description': 'A long enough description.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'Given X, then Y.',
    });

    const peerGroups = new Map([[1, [peer]]]);
    const report = svc.analyze([target], 'L3', peerGroups);
    const gap = report.findings[0]?.gaps.find((g) => g.kind === 'missing_acceptancecriteria');
    expect(gap).toBeDefined();
    expect(gap?.level).toBe('L3');
    expect(gap?.confidence).toBe('medium');
  });

  it('no L3 gap when no peers have the field either', () => {
    const target = makeItem(1, { 'System.Description': 'A long enough description for this item.' });
    const peer = makeItem(2, { 'System.Description': 'A long enough description.' });

    const peerGroups = new Map([[1, [peer]]]);
    const report = svc.analyze([target], 'L3', peerGroups);
    const l3Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L3');
    // Neither has AcceptanceCriteria — not a gap
    expect(l3Gaps.filter((g) => g.kind === 'missing_acceptancecriteria')).toHaveLength(0);
  });

  it('returns empty L3 gaps when no peerGroups provided', () => {
    const item = makeItem(1, {});
    const report = svc.analyze([item], 'L3'); // no peerGroups
    const l3Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L3');
    expect(l3Gaps).toHaveLength(0);
  });

  it('L2 mode does not produce L3 gaps', () => {
    const target = makeItem(1, {}, []);
    const peer = makeItem(2, { 'Microsoft.VSTS.Common.AcceptanceCriteria': 'criteria' });
    const peerGroups = new Map([[1, [peer]]]);
    const report = svc.analyze([target], 'L2', peerGroups);
    const l3Gaps = report.findings.flatMap((f) => f.gaps).filter((g) => g.level === 'L3');
    expect(l3Gaps).toHaveLength(0);
  });
});

// ─── Summary counts ───────────────────────────────────────────────────────────

describe('CompletenessGapService — summary', () => {
  it('totalAnalyzed includes items with no gaps', () => {
    const item1 = makeItem(1, {});
    const item2 = makeItem(2, {
      'System.Description': 'Adequate description with enough text for analysis.',
      'Microsoft.VSTS.Common.AcceptanceCriteria': 'criteria here',
      'Microsoft.VSTS.Common.VerificationMethod': 'Test',
    });
    const report = svc.analyze([item1, item2], 'L1');
    expect(report.totalAnalyzed).toBe(2);
    expect(report.totalWithGaps).toBe(1);
  });

  it('returns empty report for empty input', () => {
    const report = svc.analyze([], 'L1');
    expect(report.totalAnalyzed).toBe(0);
    expect(report.totalWithGaps).toBe(0);
    expect(report.findings).toHaveLength(0);
    expect(report.gapCountByLevel.L1).toBe(0);
  });
});
