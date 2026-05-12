import type { IWiqlClient } from '../ado/wiqlClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { AdoWorkItem, AdoWorkItemRelation } from '../types/ado.js';
import type { WorkItemService } from './workItemService.js';
import { toCompactRecord, extractDisplayName, COMPACT_FIELDS } from './workItemService.js';
import { ADO_LINK_TYPES } from '../domain/adoLinkTypes.js';
import { htmlToText } from '../utils/htmlToText.js';
import { createDefaultCompiler } from '../domain/genericWiqlCompiler.js';

// Fields fetched for every item in a context packet
const CONTEXT_FIELDS: readonly string[] = [
  ...COMPACT_FIELDS,
  'System.Description',
  'System.TeamProject',
];

const DEFAULTS = {
  parentDepth: 3,
  childrenDepth: 2,
  childrenBreadth: 100,
  siblingMax: 50,
  sameFieldMax: 50,
  descriptionMaxChars: 2_000,
  relatedMax: 20,
};

export interface ContextOptions {
  project?: string;
  includeSiblings?: boolean;
  contextField?: string;
  parentDepth?: number;
  childrenDepth?: number;
  childrenBreadth?: number;
  siblingMax?: number;
  sameFieldMax?: number;
  descriptionMaxChars?: number;
}

export interface TruncationNote {
  kind: string;
  total: number;
  included: number;
}

export interface ContextPacket {
  workItem: Record<string, unknown>;
  parents: Record<string, unknown>[];
  children: Record<string, unknown>[];
  covers: Record<string, unknown>[];
  coveredBy: Record<string, unknown>[];
  tests: Record<string, unknown>[];
  related: Record<string, unknown>[];
  siblings: Record<string, unknown>[];
  sameField: Record<string, unknown>[];
  truncated: TruncationNote[];
}

function toContextRecord(item: AdoWorkItem, descMaxChars: number): Record<string, unknown> {
  const compact = toCompactRecord(item);
  const rawDesc = item.fields['System.Description'];
  if (rawDesc) {
    const plain = htmlToText(String(rawDesc));
    compact['description'] = plain.length > descMaxChars
      ? plain.slice(0, descMaxChars) + '… [truncated]'
      : plain;
  }
  return compact;
}

interface RelationClassification {
  parentIds: number[];
  childIds: number[];
  coversIds: number[];
  coveredByIds: number[];
  testsIds: number[];
  relatedIds: number[];
}

function extractIdFromUrl(url: string): number | null {
  const m = /\/workItems\/(\d+)(?:[/?]|$)/i.exec(url);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

function classifyRelations(
  relations: AdoWorkItemRelation[],
  rootId: number
): RelationClassification {
  const result: RelationClassification = {
    parentIds: [],
    childIds: [],
    coversIds: [],
    coveredByIds: [],
    testsIds: [],
    relatedIds: [],
  };

  for (const rel of relations) {
    const neighborId = extractIdFromUrl(rel.url);
    if (neighborId === null || neighborId === rootId) continue;

    switch (rel.rel) {
      case ADO_LINK_TYPES.HIERARCHY_REVERSE:
        result.parentIds.push(neighborId);
        break;
      case ADO_LINK_TYPES.HIERARCHY_FORWARD:
        result.childIds.push(neighborId);
        break;
      case ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD:
      case ADO_LINK_TYPES.AFFECTS_FORWARD:
        result.coversIds.push(neighborId);
        break;
      case ADO_LINK_TYPES.ELISRA_COVERED_BY_REVERSE:
      case ADO_LINK_TYPES.AFFECTS_REVERSE:
        result.coveredByIds.push(neighborId);
        break;
      case ADO_LINK_TYPES.TESTED_BY_FORWARD:
        result.testsIds.push(neighborId);
        break;
      case ADO_LINK_TYPES.RELATED:
        result.relatedIds.push(neighborId);
        break;
    }
  }

  return result;
}

export class ContextPacketService {
  constructor(
    private readonly workItemService: WorkItemService,
    private readonly wiqlClient: IWiqlClient,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async build(rootId: number, options: ContextOptions, auth: AuthContext): Promise<ContextPacket> {
    const opts = {
      parentDepth: options.parentDepth ?? DEFAULTS.parentDepth,
      childrenDepth: options.childrenDepth ?? DEFAULTS.childrenDepth,
      childrenBreadth: options.childrenBreadth ?? DEFAULTS.childrenBreadth,
      siblingMax: options.siblingMax ?? DEFAULTS.siblingMax,
      sameFieldMax: options.sameFieldMax ?? DEFAULTS.sameFieldMax,
      descriptionMaxChars: options.descriptionMaxChars ?? DEFAULTS.descriptionMaxChars,
    };

    const truncated: TruncationNote[] = [];

    // 1. Fetch root with relations
    const rootItems = await this.workItemService.fetchMany([rootId], auth, {
      fields: [...CONTEXT_FIELDS],
      expand: 'relations',
    });
    const root = rootItems[0];
    if (!root) throw new Error(`Work item ${rootId} not found.`);

    const classified = classifyRelations(root.relations ?? [], rootId);

    // 2. Parents — traverse up to parentDepth levels
    const parentItems = await this.traverseParents(
      classified.parentIds,
      opts.parentDepth,
      auth,
      opts.descriptionMaxChars
    );

    // 3. Children — BFS up to childrenDepth
    const childItems = await this.traverseChildren(
      classified.childIds,
      opts.childrenDepth,
      opts.childrenBreadth,
      rootId,
      auth,
      opts.descriptionMaxChars,
      truncated
    );

    // 4. Direct relation groups — single batch fetch
    const directIds = [
      ...classified.coversIds,
      ...classified.coveredByIds,
      ...classified.testsIds,
      ...classified.relatedIds.slice(0, DEFAULTS.relatedMax),
    ];
    const directItems = directIds.length > 0
      ? await this.workItemService.fetchMany(directIds, auth, {
          fields: [...CONTEXT_FIELDS],
        })
      : [];

    const directById = new Map(directItems.map((i) => [i.id, i]));

    if (classified.relatedIds.length > DEFAULTS.relatedMax) {
      truncated.push({ kind: 'related', total: classified.relatedIds.length, included: DEFAULTS.relatedMax });
    }

    // 5. Siblings — items sharing same parent
    let siblingItems: AdoWorkItem[] = [];
    if (options.includeSiblings && classified.parentIds.length > 0) {
      siblingItems = await this.fetchSiblings(
        classified.parentIds[0],
        rootId,
        opts.siblingMax,
        auth,
        opts.descriptionMaxChars,
        truncated
      );
    }

    // 6. SameField — WIQL query
    let sameFieldItems: AdoWorkItem[] = [];
    if (options.contextField) {
      const project = options.project ?? String(root.fields['System.TeamProject'] ?? '');
      if (project) {
        sameFieldItems = await this.fetchSameField(
          rootId,
          options.contextField,
          root.fields[options.contextField],
          project,
          opts.sameFieldMax,
          auth,
          truncated
        );
      }
    }

    const project = options.project ?? String(root.fields['System.TeamProject'] ?? '');
    this.logger.debug({
      rootId,
      parents: parentItems.length,
      children: childItems.length,
      covers: classified.coversIds.length,
      project,
    }, 'ContextPacketService.build complete');

    return {
      workItem: toContextRecord(root, opts.descriptionMaxChars),
      parents: parentItems.map((i) => toContextRecord(i, opts.descriptionMaxChars)),
      children: childItems.map((i) => toContextRecord(i, opts.descriptionMaxChars)),
      covers: classified.coversIds.map((id) => directById.get(id)).filter(Boolean).map((i) => toContextRecord(i!, opts.descriptionMaxChars)),
      coveredBy: classified.coveredByIds.map((id) => directById.get(id)).filter(Boolean).map((i) => toContextRecord(i!, opts.descriptionMaxChars)),
      tests: classified.testsIds.map((id) => directById.get(id)).filter(Boolean).map((i) => toContextRecord(i!, opts.descriptionMaxChars)),
      related: classified.relatedIds.slice(0, DEFAULTS.relatedMax).map((id) => directById.get(id)).filter(Boolean).map((i) => toContextRecord(i!, opts.descriptionMaxChars)),
      siblings: siblingItems.map((i) => toContextRecord(i, opts.descriptionMaxChars)),
      sameField: sameFieldItems.map((i) => toContextRecord(i, opts.descriptionMaxChars)),
      truncated,
    };
  }

  // ─── Parent traversal ──────────────────────────────────────────────────────

  private async traverseParents(
    initialParentIds: number[],
    maxDepth: number,
    auth: AuthContext,
    _descMaxChars: number
  ): Promise<AdoWorkItem[]> {
    const allParents: AdoWorkItem[] = [];
    const visited = new Set<number>();

    let frontier = initialParentIds.filter((id) => !visited.has(id));
    frontier.forEach((id) => visited.add(id));

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const items = await this.workItemService.fetchMany(frontier, auth, {
        fields: [...CONTEXT_FIELDS],
        expand: 'relations',
      });
      allParents.push(...items);

      const nextFrontier: number[] = [];
      for (const item of items) {
        for (const rel of item.relations ?? []) {
          if (rel.rel !== ADO_LINK_TYPES.HIERARCHY_REVERSE) continue;
          const id = extractIdFromUrl(rel.url);
          if (id !== null && !visited.has(id)) {
            visited.add(id);
            nextFrontier.push(id);
          }
        }
      }
      frontier = nextFrontier;
    }

    return allParents;
  }

  // ─── Children BFS ──────────────────────────────────────────────────────────

  private async traverseChildren(
    initialChildIds: number[],
    maxDepth: number,
    breadthCap: number,
    rootId: number,
    auth: AuthContext,
    descMaxChars: number,
    truncated: TruncationNote[]
  ): Promise<AdoWorkItem[]> {
    const allChildren: AdoWorkItem[] = [];
    const visited = new Set<number>([rootId]);

    const cappedInitial = initialChildIds.slice(0, breadthCap);
    if (initialChildIds.length > breadthCap) {
      truncated.push({ kind: 'children-level-0', total: initialChildIds.length, included: breadthCap });
    }
    cappedInitial.forEach((id) => visited.add(id));
    let frontier = cappedInitial;

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const items = await this.workItemService.fetchMany(frontier, auth, {
        fields: [...CONTEXT_FIELDS],
        expand: d < maxDepth - 1 ? 'relations' : undefined,
      });
      allChildren.push(...items);

      if (d >= maxDepth - 1) break;

      const nextFrontier: number[] = [];
      const nextSeen = new Set<number>();
      for (const item of items) {
        for (const rel of item.relations ?? []) {
          if (rel.rel !== ADO_LINK_TYPES.HIERARCHY_FORWARD) continue;
          const id = extractIdFromUrl(rel.url);
          if (id !== null && !visited.has(id) && !nextSeen.has(id)) {
            nextSeen.add(id);
            nextFrontier.push(id);
          }
        }
      }

      const capped = nextFrontier.slice(0, breadthCap);
      if (nextFrontier.length > breadthCap) {
        truncated.push({ kind: `children-level-${d + 1}`, total: nextFrontier.length, included: breadthCap });
      }
      capped.forEach((id) => visited.add(id));
      frontier = capped;
    }

    return allChildren;
  }

  // ─── Siblings ──────────────────────────────────────────────────────────────

  private async fetchSiblings(
    parentId: number,
    rootId: number,
    maxSiblings: number,
    auth: AuthContext,
    descMaxChars: number,
    truncated: TruncationNote[]
  ): Promise<AdoWorkItem[]> {
    const parentItems = await this.workItemService.fetchMany([parentId], auth, {
      fields: ['System.Id'],
      expand: 'relations',
    });
    const parent = parentItems[0];
    if (!parent) return [];

    const siblingIds = (parent.relations ?? [])
      .filter((r) => r.rel === ADO_LINK_TYPES.HIERARCHY_FORWARD)
      .map((r) => extractIdFromUrl(r.url))
      .filter((id): id is number => id !== null && id !== rootId)
      .sort((a, b) => a - b);

    if (siblingIds.length > maxSiblings) {
      truncated.push({ kind: 'siblings', total: siblingIds.length, included: maxSiblings });
    }

    const capped = siblingIds.slice(0, maxSiblings);
    if (capped.length === 0) return [];

    return this.workItemService.fetchMany(capped, auth, { fields: [...CONTEXT_FIELDS] });
  }

  // ─── SameField ─────────────────────────────────────────────────────────────

  private async fetchSameField(
    rootId: number,
    fieldRef: string,
    fieldValue: unknown,
    project: string,
    maxItems: number,
    auth: AuthContext,
    truncated: TruncationNote[]
  ): Promise<AdoWorkItem[]> {
    if (fieldValue === undefined || fieldValue === null || fieldValue === '') return [];

    // Normalize identity objects to display name
    const normalizedValue = extractDisplayName(fieldValue) ?? String(fieldValue);

    try {
      const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields);
      const { wiql } = compiler.compile({
        project,
        filters: [{ field: fieldRef, operator: '=', value: normalizedValue }],
      });

      const result = await this.wiqlClient.execute({ project, wiql, auth });
      const otherIds = result.ids.filter((id) => id !== rootId);

      if (otherIds.length > maxItems) {
        truncated.push({ kind: 'sameField', total: otherIds.length, included: maxItems });
      }

      const capped = otherIds.slice(0, maxItems).sort((a, b) => a - b);
      if (capped.length === 0) return [];

      return this.workItemService.fetchMany(capped, auth, { fields: [...CONTEXT_FIELDS] });
    } catch (err) {
      this.logger.warn({ err, rootId, fieldRef }, 'fetchSameField failed — returning empty');
      return [];
    }
  }
}
