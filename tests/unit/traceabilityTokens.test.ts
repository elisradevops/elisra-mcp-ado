import { describe, it, expect } from 'vitest';
import { extractTokenFromRefName } from '../../src/utils/traceabilityTokens.js';

describe('extractTokenFromRefName', () => {
  it('strips Elisra namespace prefix and -Forward suffix', () => {
    expect(extractTokenFromRefName('Elisra.CoveredBy-Forward')).toBe('CoveredBy');
  });

  it('strips Elisra namespace prefix and -Reverse suffix', () => {
    expect(extractTokenFromRefName('Elisra.CoveredBy-Reverse')).toBe('CoveredBy');
  });

  it('strips Microsoft.VSTS multi-segment namespace and -Forward suffix', () => {
    expect(extractTokenFromRefName('Microsoft.VSTS.Common.Affects-Forward')).toBe('Affects');
  });

  it('strips Microsoft.VSTS multi-segment namespace and -Reverse suffix', () => {
    expect(extractTokenFromRefName('Microsoft.VSTS.Common.TestedBy-Reverse')).toBe('TestedBy');
  });

  it('handles reference name with no -Forward/-Reverse suffix', () => {
    expect(extractTokenFromRefName('System.LinkTypes.Related')).toBe('Related');
  });

  it('handles reference name with no dot (bare name)', () => {
    expect(extractTokenFromRefName('Related')).toBe('Related');
  });
});
