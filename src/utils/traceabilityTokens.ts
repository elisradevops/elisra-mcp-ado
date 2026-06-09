import type { LinkTypeDiscoveryService } from '../services/linkTypeDiscoveryService.js';
import type { AuthContext } from '../auth/authContext.js';

/**
 * Extracts a short substring token from a full ADO relation type reference name.
 * Used so the LLM can match tokens against relation.rel values via substring match.
 * Examples:
 *   "Elisra.CoveredBy-Forward"              → "CoveredBy"
 *   "Microsoft.VSTS.Common.Affects-Forward" → "Affects"
 *   "System.LinkTypes.Related"              → "Related"
 */
export function extractTokenFromRefName(referenceName: string): string {
  const lastSegment = referenceName.split('.').at(-1) ?? referenceName;
  return lastSegment.replace(/-(Forward|Reverse)$/i, '');
}

/**
 * Discovers all work-item-to-work-item link types from the live ADO server
 * and derives substring tokens for traceability analysis.
 * Returns [] on discovery failure (silent — caller falls back to empty list).
 */
export async function resolveTraceabilityTokens(
  linkTypeDiscoveryService: LinkTypeDiscoveryService,
  auth: AuthContext,
): Promise<string[]> {
  try {
    const result = await linkTypeDiscoveryService.discover({ auth, includeAll: false });
    const tokens = new Set<string>();
    for (const lt of result.linkTypes) {
      tokens.add(extractTokenFromRefName(lt.referenceName));
    }
    return [...tokens];
  } catch {
    return [];
  }
}
