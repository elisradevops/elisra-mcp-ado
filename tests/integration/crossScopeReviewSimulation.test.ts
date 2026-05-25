/**
 * Integration test: CHAT ↔ MCP ↔ ADO cross-scope traceability simulation.
 *
 * Wires the REAL MCP tool handlers (ado_resolve_review_scope + ado_review_requirements)
 * against a mocked ADO back-end serving 100 Customer Requirements (IDs 1000–1099) and
 * 100 System Requirements (IDs 2000–2099) from fixture data.
 *
 * Drives the exact call sequence an Open WebUI agent would issue, then asserts
 * the cross-scope traceability join produces the correct covered/uncovered classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IWiqlClient } from '../../src/ado/wiqlClient.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import { registerScopeTools } from '../../src/mcp/tools/scopeTools.js';
import { registerReviewTools } from '../../src/mcp/tools/reviewTools.js';
import { FakeMcpServer, parseToolText } from '../helpers/fakeMcpServer.js';
import { buildSimulationDeps } from '../helpers/simulationDeps.js';
import {
  customerRequirements,
  systemRequirements,
  CUSTOMER_IDS,
  SYSTEM_IDS,
  CUSTOMER_AREA_PATH,
  SYSTEM_AREA_PATH,
  COVERED_COUNT,
  UNCOVERED_WRONG_SCOPE_COUNT,
  UNCOVERED_NO_LINK_COUNT,
} from './fixtures/reviewSimulationData.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_PAT = 'fakepatfakepatfakepatfakepatfakepatfakepatfakepatfakepat';

// ─── Test setup ───────────────────────────────────────────────────────────────

describe('Cross-scope traceability simulation — CHAT ↔ MCP ↔ ADO', () => {
  let fakeMcp: FakeMcpServer;
  let fakeWiql: IWiqlClient;

  beforeEach(() => {
    fakeMcp = new FakeMcpServer();

    const itemMap = new Map<number, AdoWorkItem>([
      ...customerRequirements().map((i) => [i.id, i] as [number, AdoWorkItem]),
      ...systemRequirements().map((i) => [i.id, i] as [number, AdoWorkItem]),
    ]);

    const { deps, wiqlClient } = buildSimulationDeps({
      customerAreaPath: CUSTOMER_AREA_PATH,
      systemAreaPath: SYSTEM_AREA_PATH,
      customerIds: CUSTOMER_IDS,
      systemIds: SYSTEM_IDS,
      itemMap,
      pageSize: 25,
    });

    fakeWiql = wiqlClient;

    registerScopeTools(fakeMcp.asMcpServer(), deps);
    registerReviewTools(fakeMcp.asMcpServer(), deps);
  });

  // ── Step 1: Tools are registered ────────────────────────────────────────────

  it('registers ado_resolve_review_scope and ado_review_requirements', () => {
    expect(fakeMcp.has('ado_resolve_review_scope')).toBe(true);
    expect(fakeMcp.has('ado_review_requirements')).toBe(true);
  });

  // ── Step 2: Resolve Customer Requirements scope with pagination ──────────────

  it('step 1 — paginates customer requirement IDs to completion', async () => {
    const customerSource = {
      type: 'fieldFilters',
      filters: [
        { field: 'System.AreaPath', operator: 'UNDER', value: CUSTOMER_AREA_PATH },
        { field: 'System.WorkItemType', operator: 'IN', value: ['Epic', 'Feature', 'Requirement'] },
      ],
    };

    const allIds: number[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const result = await fakeMcp.call('ado_resolve_review_scope', {
        pat: TEST_PAT,
        project: 'SomeProject',
        source: customerSource,
        responseMode: 'ids',
        pageSize: 25,
        ...(cursor ? { cursor } : {}),
      });
      const body = parseToolText(result);
      const pageInfo = body.pageInfo as { nextCursor: string | null; isComplete: boolean };
      const ids = body.ids as number[];

      allIds.push(...ids);
      cursor = pageInfo.nextCursor ?? undefined;
      pageCount++;
    } while (cursor);

    expect(allIds).toHaveLength(100);
    expect(allIds).toEqual(expect.arrayContaining(CUSTOMER_IDS));
    // WIQL executed exactly once — subsequent pages served from snapshot cache
    expect((fakeWiql.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(pageCount).toBeGreaterThan(1); // confirms pagination iterated
  });

  // ── Step 3: Fetch System Requirements with relations ─────────────────────────

  it('step 2 — paginates system requirements with relations', async () => {
    const systemSource = {
      type: 'fieldFilters',
      filters: [
        { field: 'System.AreaPath', operator: 'UNDER', value: SYSTEM_AREA_PATH },
        { field: 'System.WorkItemType', operator: 'IN', value: ['Requirement', 'Feature', 'Epic'] },
      ],
    };

    const allItems: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;

    do {
      const result = await fakeMcp.call('ado_review_requirements', {
        pat: TEST_PAT,
        project: 'SomeProject',
        source: systemSource,
        responseMode: 'page',
        includeRelations: true,
        pageSize: 25,
        ...(cursor ? { cursor } : {}),
      });
      const body = parseToolText(result);
      const pageInfo = body.pageInfo as { nextCursor: string | null; isComplete: boolean };
      const items = body.items as Array<Record<string, unknown>>;

      allItems.push(...items);
      cursor = pageInfo.nextCursor ?? undefined;
    } while (cursor);

    expect(allItems).toHaveLength(100);

    // Every item must have a relations[] array (may be empty but must be present)
    for (const item of allItems) {
      expect(Array.isArray(item['relations'])).toBe(true);
    }

    // Items with CoveredBy links must expose targetId
    const withLinks = allItems.filter(
      (item) =>
        (item['relations'] as Array<{ rel: string; targetId: number }>).some((r) =>
          r.rel.includes('CoveredBy')
        )
    );
    expect(withLinks.length).toBeGreaterThan(0);
    for (const item of withLinks) {
      for (const r of item['relations'] as Array<{ rel: string; targetId: number }>) {
        if (r.rel.includes('CoveredBy')) {
          expect(typeof r.targetId).toBe('number');
          expect(Number.isFinite(r.targetId)).toBe(true);
        }
      }
    }
  });

  // ── Step 4: Full cross-scope join ─────────────────────────────────────────────

  it('step 3 — cross-scope join produces correct covered/uncovered counts', async () => {
    // --- Build customerReqIdSet (Step 1 of simulation) ---
    const customerSource = {
      type: 'fieldFilters',
      filters: [
        { field: 'System.AreaPath', operator: 'UNDER', value: CUSTOMER_AREA_PATH },
        { field: 'System.WorkItemType', operator: 'IN', value: ['Epic', 'Feature', 'Requirement'] },
      ],
    };

    const customerReqIdSet = new Set<number>();
    let customerCursor: string | undefined;

    do {
      const result = await fakeMcp.call('ado_resolve_review_scope', {
        pat: TEST_PAT,
        project: 'SomeProject',
        source: customerSource,
        responseMode: 'ids',
        pageSize: 200,
        ...(customerCursor ? { cursor: customerCursor } : {}),
      });
      const body = parseToolText(result);
      for (const id of body.ids as number[]) customerReqIdSet.add(id);
      customerCursor = (body.pageInfo as { nextCursor: string | null }).nextCursor ?? undefined;
    } while (customerCursor);

    expect(customerReqIdSet.size).toBe(100);

    // --- Fetch System Requirements with relations (Step 2 of simulation) ---
    const systemSource = {
      type: 'fieldFilters',
      filters: [
        { field: 'System.AreaPath', operator: 'UNDER', value: SYSTEM_AREA_PATH },
        { field: 'System.WorkItemType', operator: 'IN', value: ['Requirement', 'Feature', 'Epic'] },
      ],
    };

    const allSystemItems: Array<Record<string, unknown>> = [];
    let systemCursor: string | undefined;

    do {
      const result = await fakeMcp.call('ado_review_requirements', {
        pat: TEST_PAT,
        project: 'SomeProject',
        source: systemSource,
        responseMode: 'page',
        includeRelations: true,
        pageSize: 200,
        ...(systemCursor ? { cursor: systemCursor } : {}),
      });
      const body = parseToolText(result);
      allSystemItems.push(...(body.items as Array<Record<string, unknown>>));
      systemCursor = (body.pageInfo as { nextCursor: string | null }).nextCursor ?? undefined;
    } while (systemCursor);

    expect(allSystemItems).toHaveLength(100);

    // --- Apply traceability rule (Step 3 of simulation — LLM set-join) ---
    let covered = 0;
    let uncoveredWrongScope = 0;
    let uncoveredNoLink = 0;

    for (const item of allSystemItems) {
      const relations = item['relations'] as Array<{ rel: string; targetId: number }>;
      const coveredByLinks = relations.filter((r) => r.rel.includes('CoveredBy'));

      if (coveredByLinks.length === 0) {
        uncoveredNoLink++;
      } else {
        const inScope = coveredByLinks.some((r) => customerReqIdSet.has(r.targetId));
        if (inScope) {
          covered++;
        } else {
          uncoveredWrongScope++;
        }
      }
    }

    expect(covered).toBe(COVERED_COUNT);
    expect(uncoveredWrongScope).toBe(UNCOVERED_WRONG_SCOPE_COUNT);
    expect(uncoveredNoLink).toBe(UNCOVERED_NO_LINK_COUNT);
    expect(covered + uncoveredWrongScope + uncoveredNoLink).toBe(100);
  });

  // ── Step 5: Regression — missingData when includeRelations=false ──────────────

  it('step 4 (regression) — omitting includeRelations surfaces missingData warning', async () => {
    const systemSource = {
      type: 'fieldFilters',
      filters: [
        { field: 'System.AreaPath', operator: 'UNDER', value: SYSTEM_AREA_PATH },
      ],
    };

    const result = await fakeMcp.call('ado_review_requirements', {
      pat: TEST_PAT,
      project: 'SomeProject',
      source: systemSource,
      responseMode: 'page',
      // includeRelations intentionally omitted (defaults to false)
    });

    const body = parseToolText(result);
    const missingData = body.missingData as Array<{ type: string; reason: string }>;

    expect(Array.isArray(missingData)).toBe(true);
    expect(
      missingData.some((m) => m.type === 'relations' && m.reason === 'not_requested')
    ).toBe(true);

    // Items must not have a relations[] field when includeRelations=false
    const items = body.items as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item['relations']).toBeUndefined();
    }
  });

  // ── Step 5b: ado_query_work_item_ids — raw WIQL fetching ─────────────────────

  it('ado_query_work_item_ids — raw WIQL returns matching IDs', async () => {
    expect(fakeMcp.has('ado_query_work_item_ids')).toBe(true);

    const wiql =
      `SELECT [System.Id] FROM WorkItems ` +
      `WHERE [System.AreaPath] UNDER 'SomeProject\\Customer Requirement' ` +
      `ORDER BY [System.Id]`;

    const result = await fakeMcp.call('ado_query_work_item_ids', {
      pat: TEST_PAT,
      project: 'SomeProject',
      wiql,
    });

    const body = parseToolText(result);
    const ids = body.ids as number[];

    expect(ids).toHaveLength(100);
    expect(ids).toEqual(expect.arrayContaining(CUSTOMER_IDS));
    expect(body.totalMatched).toBe(100);
    expect(body.queryType).toBe('flat');
  });

  // ── Step 5c: ado_resolve_review_scope source.type="wiql" ─────────────────────

  it('ado_resolve_review_scope with wiql source — paginates system requirement IDs', async () => {
    const wiql =
      `SELECT [System.Id] FROM WorkItems ` +
      `WHERE [System.AreaPath] UNDER 'SomeProject\\System Requirement' ` +
      `ORDER BY [System.Id]`;

    const allIds: number[] = [];
    let cursor: string | undefined;

    do {
      const result = await fakeMcp.call('ado_resolve_review_scope', {
        pat: TEST_PAT,
        project: 'SomeProject',
        source: { type: 'wiql', wiql },
        responseMode: 'ids',
        pageSize: 50,
        ...(cursor ? { cursor } : {}),
      });
      const body = parseToolText(result);
      const pageInfo = body.pageInfo as { nextCursor: string | null; isComplete: boolean };

      allIds.push(...(body.ids as number[]));
      cursor = pageInfo.nextCursor ?? undefined;
    } while (cursor);

    expect(allIds).toHaveLength(100);
    expect(allIds).toEqual(expect.arrayContaining(SYSTEM_IDS));
  });

  // ── Step 6: ANTI_HALLUCINATION_BANNER is present ─────────────────────────────

  it('every page response includes the anti-hallucination banner', async () => {
    const systemSource = {
      type: 'fieldFilters',
      filters: [{ field: 'System.AreaPath', operator: 'UNDER', value: SYSTEM_AREA_PATH }],
    };

    const result = await fakeMcp.call('ado_review_requirements', {
      pat: TEST_PAT,
      project: 'SomeProject',
      source: systemSource,
      responseMode: 'page',
      includeRelations: true,
    });

    const body = parseToolText(result);
    expect(typeof body['_instruction']).toBe('string');
    expect((body['_instruction'] as string).length).toBeGreaterThan(0);
  });
});
