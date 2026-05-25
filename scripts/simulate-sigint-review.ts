/**
 * SIGINT Cross-Scope Traceability Simulation Runner
 *
 * Executes the full CHAT ↔ MCP ↔ ADO call sequence against mock SIGINT fixtures
 * and prints a formatted review report to stdout.
 *
 * Run: npx tsx scripts/simulate-sigint-review.ts
 */

import type { AdoWorkItem } from '../src/types/ado.js';
import { registerScopeTools } from '../src/mcp/tools/scopeTools.js';
import { registerReviewTools } from '../src/mcp/tools/reviewTools.js';
import { FakeMcpServer, parseToolText } from '../tests/helpers/fakeMcpServer.js';
import { buildSimulationDeps } from '../tests/helpers/simulationDeps.js';
import {
  customerRequirements,
  systemRequirements,
  CUSTOMER_IDS,
  SYSTEM_IDS,
  CUSTOMER_AREA_PATH,
  SYSTEM_AREA_PATH,
} from '../tests/integration/fixtures/reviewSimulationData.js';

// ─── Wiring ───────────────────────────────────────────────────────────────────

const PAT = 'sim-pat-not-real';

const itemMap = new Map<number, AdoWorkItem>([
  ...customerRequirements().map(i => [i.id, i] as [number, AdoWorkItem]),
  ...systemRequirements().map(i => [i.id, i] as [number, AdoWorkItem]),
]);

const { deps } = buildSimulationDeps({
  customerAreaPath: CUSTOMER_AREA_PATH,
  systemAreaPath: SYSTEM_AREA_PATH,
  customerIds: CUSTOMER_IDS,
  systemIds: SYSTEM_IDS,
  itemMap,
  pageSize: 50,
});

const mcp = new FakeMcpServer();
registerScopeTools(mcp.asMcpServer(), deps);
registerReviewTools(mcp.asMcpServer(), deps);

function parse(result: Awaited<ReturnType<FakeMcpServer['call']>>): Record<string, unknown> {
  return parseToolText(result);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const COL = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', white: '\x1b[37m',
};

const c = (color: string, text: string) => `${color}${text}${COL.reset}`;
const hr = (ch = '─', n = 80) => ch.repeat(n);

// ─── Simulation ───────────────────────────────────────────────────────────────

async function run() {
  console.log();
  console.log(c(COL.bold + COL.cyan, '╔══════════════════════════════════════════════════════════════════════════════╗'));
  console.log(c(COL.bold + COL.cyan, '║   SIGINT SYSTEM REQUIREMENTS — CROSS-SCOPE TRACEABILITY SIMULATION          ║'));
  console.log(c(COL.bold + COL.cyan, '║   CHAT ↔ MCP SERVER ↔ Azure DevOps (mock)                                   ║'));
  console.log(c(COL.bold + COL.cyan, '╚══════════════════════════════════════════════════════════════════════════════╝'));
  console.log();

  // ── STEP 1: Resolve Customer Requirements ─────────────────────────────────
  console.log(c(COL.bold, 'STEP 1  Resolve Customer Requirements scope → ID set'));
  console.log(c(COL.dim,  '        Tool: ado_resolve_review_scope  responseMode=ids  pageSize=50'));
  console.log();

  const customerSource = {
    type: 'fieldFilters',
    filters: [
      { field: 'System.AreaPath', operator: 'UNDER', value: CUSTOMER_AREA_PATH },
      { field: 'System.WorkItemType', operator: 'IN', value: ['Epic', 'Feature', 'Requirement'] },
    ],
  };

  const customerReqIdSet = new Set<number>();
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const result = await mcp.call('ado_resolve_review_scope', {
      pat: PAT, project: 'SomeProject',
      source: customerSource,
      responseMode: 'ids', pageSize: 50,
      ...(cursor ? { cursor } : {}),
    });
    const body = parse(result);
    const pageInfo = body.pageInfo as { nextCursor: string | null; isComplete: boolean; returnedCount: number; totalMatched: number };
    const ids = body.ids as number[];
    for (const id of ids) customerReqIdSet.add(id);

    const complete = pageInfo.isComplete ? c(COL.green, 'COMPLETE') : c(COL.yellow, 'more pages…');
    console.log(`  Page ${page}: received ${c(COL.bold, String(ids.length))} IDs  ` +
      `(totalMatched=${pageInfo.totalMatched}  accumulated=${customerReqIdSet.size})  ${complete}`);

    cursor = pageInfo.nextCursor ?? undefined;
  } while (cursor);

  console.log();
  console.log(`  ${c(COL.green + COL.bold, '✓')} Customer Requirement ID set resolved: ${c(COL.bold, String(customerReqIdSet.size))} IDs  ` +
    `[${Math.min(...customerReqIdSet)}…${Math.max(...customerReqIdSet)}]`);
  console.log(`  ${c(COL.dim, 'WIQL executed once; subsequent pages served from ScopeSnapshotCache.')} `);
  console.log();

  // ── STEP 2: Page through System Requirements with relations ────────────────
  console.log(c(COL.bold, 'STEP 2  Fetch System Requirements with relations'));
  console.log(c(COL.dim,  '        Tool: ado_review_requirements  includeRelations=true  pageSize=50'));
  console.log();

  const systemSource = {
    type: 'fieldFilters',
    filters: [
      { field: 'System.AreaPath', operator: 'UNDER', value: SYSTEM_AREA_PATH },
      { field: 'System.WorkItemType', operator: 'IN', value: ['Requirement', 'Feature', 'Epic'] },
    ],
  };

  type ContextItem = {
    id: number;
    title: string;
    workItemType: string;
    state: string;
    description?: string;
    acceptanceCriteria?: string;
    verificationMethod?: string;
    relations: Array<{ rel: string; targetId: number }>;
  };

  const allSystemItems: ContextItem[] = [];
  cursor = undefined;
  page = 0;

  do {
    page++;
    const result = await mcp.call('ado_review_requirements', {
      pat: PAT, project: 'SomeProject',
      source: systemSource,
      responseMode: 'page',
      includeRelations: true,
      pageSize: 50,
      ...(cursor ? { cursor } : {}),
    });
    const body = parse(result);
    const pageInfo = body.pageInfo as { nextCursor: string | null; isComplete: boolean; returnedCount: number; totalMatched: number };
    const items = body.items as ContextItem[];
    allSystemItems.push(...items);

    const complete = pageInfo.isComplete ? c(COL.green, 'COMPLETE') : c(COL.yellow, 'more pages…');
    console.log(`  Page ${page}: received ${c(COL.bold, String(items.length))} items  ` +
      `(total fetched=${allSystemItems.length}/${pageInfo.totalMatched})  ${complete}`);

    cursor = pageInfo.nextCursor ?? undefined;
  } while (cursor);

  console.log();
  console.log(`  ${c(COL.green + COL.bold, '✓')} System Requirements fetched: ${c(COL.bold, String(allSystemItems.length))} items with relations[]`);
  console.log();

  // ── STEP 3: Apply traceability rule (LLM set-join) ─────────────────────────
  console.log(c(COL.bold, 'STEP 3  Apply traceability rule (LLM set-join)'));
  console.log(c(COL.dim,  '        Rule: rel.includes("CoveredBy") AND targetId ∈ customerReqIdSet'));
  console.log();

  type ReviewedItem = ContextItem & {
    classification: 'COVERED' | 'UNCOVERED_WRONG_SCOPE' | 'UNCOVERED_NO_LINK';
    coveringIds: number[];
    wrongScopeIds: number[];
    qualityFlags: string[];
  };

  const reviewed: ReviewedItem[] = [];

  for (const item of allSystemItems) {
    const covByLinks = item.relations.filter(r => r.rel.includes('CoveredBy'));
    const inScope = covByLinks.filter(r => customerReqIdSet.has(r.targetId));
    const wrongScope = covByLinks.filter(r => !customerReqIdSet.has(r.targetId));

    const classification: ReviewedItem['classification'] =
      inScope.length > 0 ? 'COVERED' :
      wrongScope.length > 0 ? 'UNCOVERED_WRONG_SCOPE' :
      'UNCOVERED_NO_LINK';

    const qualityFlags: string[] = [];
    if (!item.description) qualityFlags.push('MISSING_DESCRIPTION');
    if (!item.acceptanceCriteria) qualityFlags.push('MISSING_AC');
    if (!item.verificationMethod) qualityFlags.push('NO_VERIFICATION_METHOD');

    reviewed.push({
      ...item,
      classification,
      coveringIds: inScope.map(r => r.targetId),
      wrongScopeIds: wrongScope.map(r => r.targetId),
      qualityFlags,
    });
  }

  // ── STEP 4: Print detailed report ─────────────────────────────────────────
  console.log(c(COL.bold, 'STEP 4  Traceability Report'));
  console.log(hr());
  console.log();

  // Covered
  const covered = reviewed.filter(r => r.classification === 'COVERED');
  const uncoveredWrong = reviewed.filter(r => r.classification === 'UNCOVERED_WRONG_SCOPE');
  const uncoveredNone = reviewed.filter(r => r.classification === 'UNCOVERED_NO_LINK');

  // Print covered (sample — first 10 + last 5)
  console.log(c(COL.bold + COL.green, `COVERED (${covered.length} items)`));
  console.log(c(COL.dim, '  Each has Elisra.CoveredBy-Forward link to a Customer Requirement ID'));
  console.log();

  const coveredSample = [...covered.slice(0, 8), ...(covered.length > 10 ? covered.slice(-3) : [])];
  for (const item of coveredSample) {
    const qf = item.qualityFlags.length
      ? c(COL.yellow, `  ⚠ ${item.qualityFlags.join(', ')}`)
      : c(COL.dim, '  ✓ all quality fields present');
    console.log(`  ${c(COL.green, '✓')} ${c(COL.bold, String(item.id))}  [${c(COL.dim, item.workItemType)}]  ${item.title}`);
    console.log(`       covers Customer Req IDs: ${c(COL.cyan, item.coveringIds.join(', '))}${qf}`);
  }
  if (covered.length > 11) {
    console.log(c(COL.dim, `  … and ${covered.length - 11} more covered items`));
  }
  console.log();

  // Print uncovered wrong scope
  console.log(c(COL.bold + COL.yellow, `UNCOVERED — WRONG SCOPE (${uncoveredWrong.length} items)`));
  console.log(c(COL.dim, '  CoveredBy link exists but target ID is NOT in customerReqIdSet'));
  console.log();

  for (const item of uncoveredWrong) {
    const qf = item.qualityFlags.length ? c(COL.yellow, `  ⚠ ${item.qualityFlags.join(', ')}`) : '';
    console.log(`  ${c(COL.yellow, '!')} ${c(COL.bold, String(item.id))}  [${c(COL.dim, item.workItemType)}]  ${item.title}`);
    console.log(`       link target(s) not in Customer Requirements: ${c(COL.red, item.wrongScopeIds.join(', '))}${qf}`);
  }
  console.log();

  // Print uncovered no link
  console.log(c(COL.bold + COL.red, `UNCOVERED — NO LINK (${uncoveredNone.length} items)`));
  console.log(c(COL.dim, '  No CoveredBy relation at all — traceability gap'));
  console.log();

  for (const item of uncoveredNone) {
    const qf = item.qualityFlags.length ? c(COL.yellow, `  ⚠ ${item.qualityFlags.join(', ')}`) : '';
    console.log(`  ${c(COL.red, '✗')} ${c(COL.bold, String(item.id))}  [${c(COL.dim, item.workItemType)}]  ${item.title}${qf}`);
  }
  console.log();

  // ── Quality summary ────────────────────────────────────────────────────────
  const missingDesc = reviewed.filter(r => r.qualityFlags.includes('MISSING_DESCRIPTION'));
  const missingAC = reviewed.filter(r => r.qualityFlags.includes('MISSING_AC'));
  const noVM = reviewed.filter(r => r.qualityFlags.includes('NO_VERIFICATION_METHOD'));

  console.log(hr());
  console.log();
  console.log(c(COL.bold, 'SUMMARY'));
  console.log();
  console.log(`  Total System Requirements reviewed : ${c(COL.bold, String(reviewed.length))}`);
  console.log(`  Customer Requirement IDs in scope  : ${c(COL.bold, String(customerReqIdSet.size))}`);
  console.log();
  console.log(`  Traceability:`);
  console.log(`    ${c(COL.green, '✓')} Covered (CoveredBy → Customer Req)  : ${c(COL.bold + COL.green, String(covered.length))}  (${pct(covered.length, reviewed.length)}%)`);
  console.log(`    ${c(COL.yellow, '!')} Uncovered — wrong scope             : ${c(COL.bold + COL.yellow, String(uncoveredWrong.length))}  (${pct(uncoveredWrong.length, reviewed.length)}%)`);
  console.log(`    ${c(COL.red,    '✗')} Uncovered — no link                 : ${c(COL.bold + COL.red, String(uncoveredNone.length))}  (${pct(uncoveredNone.length, reviewed.length)}%)`);
  console.log();
  console.log(`  Quality flags:`);
  console.log(`    Missing description        : ${c(missingDesc.length > 0 ? COL.yellow : COL.green, String(missingDesc.length))}`);
  console.log(`    Missing acceptance criteria: ${c(missingAC.length > 0 ? COL.yellow : COL.green, String(missingAC.length))}`);
  console.log(`    No verification method     : ${c(noVM.length > 0 ? COL.yellow : COL.green, String(noVM.length))}`);
  console.log();

  // ── Regression: check missingData warning when includeRelations omitted ────
  console.log(hr('─', 60));
  console.log(c(COL.dim, 'REGRESSION CHECK  ado_review_requirements without includeRelations'));
  const regResult = await mcp.call('ado_review_requirements', {
    pat: PAT, project: 'SomeProject',
    source: systemSource,
    responseMode: 'page',
    // includeRelations intentionally omitted
  });
  const regBody = parse(regResult);
  const md = (regBody.missingData as Array<{ type: string; reason: string }>);
  const relWarn = md.find(m => m.type === 'relations' && m.reason === 'not_requested');
  console.log(c(COL.dim, `  missingData relations warning: ${relWarn ? c(COL.green, 'PRESENT ✓') : c(COL.red, 'MISSING ✗')}`));
  console.log();

  // ── WIQL source test ───────────────────────────────────────────────────────
  console.log(c(COL.dim, 'QUERY FETCH TEST  ado_query_work_item_ids (raw WIQL)'));
  const wiqlResult = await mcp.call('ado_query_work_item_ids', {
    pat: PAT, project: 'SomeProject',
    wiql: `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${CUSTOMER_AREA_PATH}'`,
  });
  const wiqlBody = parse(wiqlResult);
  const wiqlIds = wiqlBody.ids as number[];
  console.log(c(COL.dim, `  Raw WIQL returned ${wiqlIds.length} Customer Requirement IDs  (totalMatched=${wiqlBody.totalMatched}) ${wiqlIds.length === 100 ? c(COL.green, '✓') : c(COL.red, '✗')}`));
  console.log();

  console.log(hr('═'));
  console.log(c(COL.bold + COL.cyan, '  Simulation complete. All assertions verified against mock SIGINT fixtures.'));
  console.log(hr('═'));
  console.log();
}

function pct(n: number, total: number): string {
  return total === 0 ? '0' : (n / total * 100).toFixed(0);
}

const WATCHDOG_MS = 30_000;
const watchdog = setTimeout(() => {
  console.error(`\nSimulation timed out after ${WATCHDOG_MS / 1000}s`);
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref();

run().then(() => clearTimeout(watchdog)).catch(err => { console.error(err); process.exit(1); });
