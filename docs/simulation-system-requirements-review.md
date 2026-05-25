# System Requirements Review — Knowledge Source & Simulation Walkthrough

> **SIMULATION / KNOWLEDGE-SOURCE ONLY — not MCP server behavior.**
>
> This document is a knowledge source intended to be placed in an Open WebUI agent's system prompt
> or knowledge base. It defines what a system requirement is (per ISO/IEC/IEEE 29148:2018), maps
> each checkable characteristic to fields returned by the MCP server, specifies the cross-scope
> traceability rule for the Elisra environment, and narrates the exact CHAT ↔ MCP ↔ ADO call
> sequence the agent must execute. It does NOT describe MCP server behavior; it describes what the
> **LLM agent** must do with the data the server returns.

---

## 1. What Is a System Requirement?

Per **ISO/IEC/IEEE 29148:2018** (Systems and Software Engineering — Life Cycle Processes —
Requirements Engineering), a requirement is a statement that identifies a product or process
characteristic necessary for a stakeholder to accept it.

A **system requirement** specifies a function or constraint of the system as a whole, bridging
stakeholder (customer) needs down to the system-level design.

### 1.1 Nine Individual Characteristics

Every individual system requirement shall be:

| # | Characteristic | Definition |
|---|---|---|
| 1 | **Necessary** | Its removal would leave a deficiency that cannot be filled by another requirement. |
| 2 | **Appropriate** | Consistent with the complexity, intent, and applicable standards of the system. |
| 3 | **Unambiguous** | Has one and only one interpretation. Free of vague terms (e.g., "fast", "efficient", "robust", "sufficient", "appropriate"). |
| 4 | **Complete** | Contains all information needed to understand the required behavior; no TBDs or placeholders. |
| 5 | **Singular** | Expresses one and only one requirement. Multiple "shall" statements in a single item usually indicate this is violated. |
| 6 | **Feasible** | Can be realized within cost, schedule, and technical constraints. Absolute constraints ("zero latency", "100% uptime") are red flags. |
| 7 | **Verifiable** | Can be shown to be met through inspection, analysis, test, or demonstration. Must have measurable acceptance criteria. |
| 8 | **Correct** | Accurately and precisely represents a stakeholder need or system characteristic. |
| 9 | **Conforming** | Complies with applicable templates, styles, and standards (e.g., uses "shall" for binding requirements). |

### 1.2 Five Set-Level Characteristics

The full set of system requirements shall also be:

| # | Characteristic | Definition |
|---|---|---|
| 1 | **Complete** (set) | Every stakeholder need is addressed; no gaps. |
| 2 | **Consistent** | No two requirements contradict each other. |
| 3 | **Feasible** (set) | The entire set can be implemented within project constraints. |
| 4 | **Comprehensible** | The set can be understood by all stakeholders. |
| 5 | **Able to be validated** | The set can be confirmed to reflect true stakeholder needs. |

---

## 2. Mapping Characteristics to MCP-Returned Fields

The MCP server returns work item data via `ado_review_requirements` and `ado_resolve_review_scope`.
The following table maps each characteristic to the specific fields available in the server response.

> Rule: **Only assert a characteristic status if the relevant field is present in the server
> response. Never infer a field value that was not returned. Mark "unknown" when data is absent.**

| Characteristic | Checkable from MCP data? | MCP fields / signals | Notes |
|---|---|---|---|
| Necessary (#1) | Partial | `items[].relations[].targetId` (with `includeRelations=true`) | If no link to Customer Req exists, the requirement may be unnecessary or orphaned. Requires cross-scope join (§4). |
| Appropriate (#2) | No | — | Requires domain-expert judgment; mark "unknown". |
| Unambiguous (#3) | Heuristic | `items[].title`, `items[].description` | Scan for vague terms (fast, efficient, robust, sufficient, adequate, appropriate, etc.). Medium-confidence heuristic only. |
| Complete (#4) | Heuristic | `items[].description`, `items[].acceptanceCriteria` | Missing or very short description, missing acceptance criteria → incomplete signal. |
| Singular (#5) | Heuristic | `items[].description`, `items[].title` | Count "shall" occurrences. >3 or multiple "shall…shall" patterns → possible merged requirements. |
| Feasible (#6) | Heuristic | `items[].title`, `items[].description` | Look for absolute terms (zero, 100%, never, always, infinite, perfect). Low-confidence heuristic. |
| Verifiable (#7) | Heuristic | `items[].verificationMethod`, `items[].description` | `verificationMethod` set = high-confidence ok. Measurable numeric criteria in description = medium-confidence ok. Neither = warn. |
| Correct (#8) | Partial | `items[].relations[].targetId` (with `includeRelations=true`) | Correctness against stakeholder intent requires cross-scope traceability. Without Customer Req link, mark "unknown". |
| Conforming (#9) | Heuristic | `items[].title`, `items[].description` | "Shall" language present = signal of conformance. Absence of "shall" in a requirement = warn. |
| **Set: Complete** | Requires full scope | All 100% of IDs fetched and reviewed | Only assert after `pageInfo.isComplete=true` for both scopes. |
| **Set: Consistent** | No (single-item) | — | Requires sibling comparison; cannot determine from individual items. Mark "unknown". |
| **Set: Feasible** | No | — | Requires domain + project context. Mark "unknown". |
| **Set: Comprehensible** | No | — | Requires human judgment. Mark "unknown". |
| **Set: Able to validate** | Partial | Coverage completeness from cross-scope join | All System Reqs linked to Customer Reqs → necessary condition for validation. |

**Fields the MCP server exposes per item (`items[]` in `ado_review_requirements` page response):**

```
id, title, workItemType, state, areaPath, iterationPath, assignedTo, changedDate
description              (plain text, up to 2000 chars)
acceptanceCriteria       (plain text, up to 500 chars)
verificationMethod       (value of Microsoft.VSTS.Common.VerificationMethod if set)
relations[]              (only when includeRelations=true)
  .rel                   (relation type name, e.g. "Elisra.CoveredBy-Forward")
  .targetId              (numeric work item ID of the linked item)
```

---

## 3. Cross-Scope Traceability Rule (Elisra Environment)

> **Rule:** Every System Requirement under `SomeProject\System Requirement` must be linked via a
> relation whose `rel` contains the substring `"CoveredBy"` to **at least one** work item whose
> ID exists in the Customer Requirements scope (`SomeProject\Customer Requirement`).

**Custom link type in this ADO collection:**

- Forward: `Elisra.CoveredBy-Forward` (a System Req is covered by a Customer Req)
- Reverse: `Elisra.CoveredBy-Reverse`

The default `traceabilityLinkTokens` in the MCP server are `["Affects", "CoveredBy", "TestedBy"]`.
The `"CoveredBy"` token matches both directions.

**Classification of a System Requirement:**

| Condition | Classification |
|---|---|
| `relations[]` contains entry with `rel.includes("CoveredBy")` AND `targetId ∈ customerReqIdSet` | **Covered** — traceability satisfied |
| `relations[]` contains `CoveredBy` entry BUT `targetId ∉ customerReqIdSet` | **Uncovered (wrong scope)** — link exists but target is not a Customer Requirement |
| `relations[]` is empty or contains no `CoveredBy` entries | **Uncovered (no link)** — no traceability |
| `relations` field absent from item | **Unknown** — `includeRelations` was not set; re-run with `includeRelations=true` |

---

## 4. Anti-Hallucination Protocol (8 Rules)

The agent reviewing requirements MUST follow these rules to avoid fabricating information:

1. **Only assert IDs the server returned.** Do not claim a work item exists unless its `id` field
   appears in a page response you received.

2. **Paginate to completion before concluding.** If `pageInfo.isComplete=false`, call the tool
   again with `cursor=pageInfo.nextCursor` and accumulate results before drawing conclusions
   about the full scope.

3. **Never fabricate link targets.** A `relations[].targetId` claim must come directly from a
   server response field. Do not infer that an item is linked to another unless `targetId` is
   explicitly present.

4. **Mark "unknown" instead of guessing.** If a field is absent (e.g., `acceptanceCriteria`
   is not set, `verificationMethod` is absent), state the field is missing — do not infer its
   value.

5. **Cite source field for every finding.** Each finding statement must reference the specific
   field it was derived from (e.g., "Title contains vague term 'efficient' — source:
   `items[2001].title`").

6. **Scope completeness before set-level assertions.** Never assert a set-level characteristic
   (e.g., "no gaps in requirements") until all pages for that scope have been fetched.

7. **Cross-scope join must use real ID sets.** The `customerReqIdSet` used in the traceability
   join must be built from actual `ids[]` values returned by `ado_resolve_review_scope`, not from
   IDs assumed or recalled from memory.

8. **Do not re-use IDs across calls.** Each call returns data for the scope and page requested.
   Do not carry over IDs from a prior session unless the cursor pagination for that session is
   still active.

---

## 5. Narrated CHAT ↔ MCP ↔ ADO Walkthrough

**Scenario:** Review 300 System Requirements in `SomeProject\System Requirement` for traceability
against 300 Customer Requirements in `SomeProject\Customer Requirement`. The rule is: every System
Requirement must have a `CoveredBy` link to at least one Customer Requirement.

### Step 1 — Resolve Customer Requirements scope to an ID set

**Agent calls:**
```
ado_resolve_review_scope({
  project: "SomeProject",
  source: {
    type: "fieldFilters",
    filters: [
      { field: "System.AreaPath", operator: "UNDER", value: "SomeProject\\Customer Requirement" },
      { field: "System.WorkItemType", operator: "IN", value: ["Epic","Feature","Requirement"] }
    ]
  },
  responseMode: "ids",
  pageSize: 200
})
```

**MCP server:**
1. Builds WIQL from filters.
2. Executes WIQL against ADO — returns 300 IDs.
3. Stores snapshot in `ScopeSnapshotCache` (TTL 10 min). Returns page 1: IDs 1–200 + `nextCursor`.

**Agent:**
- Reads `ids[]` from response → accumulates into `customerReqIdSet`.
- Sees `pageInfo.isComplete=false` → calls again with `cursor=pageInfo.nextCursor`.
- Page 2: IDs 201–300 + `isComplete=true`.
- Final `customerReqIdSet = Set(300 IDs)`.
- WIQL was executed ONCE; page 2 was served from snapshot cache.

### Step 2 — Page through System Requirements with relations

**Agent calls (repeated):**
```
ado_review_requirements({
  project: "SomeProject",
  source: {
    type: "fieldFilters",
    filters: [
      { field: "System.AreaPath", operator: "UNDER", value: "SomeProject\\System Requirement" },
      { field: "System.WorkItemType", operator: "IN", value: ["Requirement","Feature","Epic"] }
    ]
  },
  responseMode: "page",
  includeRelations: true,
  pageSize: 50
})
```

**MCP server (per page):**
1. Resolves System Requirement scope → 300 IDs (snapshot cached after first call).
2. Fetches page of 50 work items from ADO with `$expand=relations`.
3. Calls `toContextItem` on each: strips HTML, truncates description/AC, maps relations to
   `{ rel, targetId }` (parsing `targetId` from relation URL).
4. Returns response with `items[50]`, `pageInfo.nextCursor`, `pageInfo.isComplete`.

**Agent:**
- 6 pages × 50 items = 300 items total.
- Accumulates all 300 items before final analysis.
- Checks `pageInfo.isComplete=true` after page 6 before proceeding.

### Step 3 — Apply traceability rule (set join in LLM context)

For each System Requirement `S` in accumulated items:

```
coveredBy = S.relations
  .filter(r => r.rel.includes("CoveredBy"))
  .map(r => r.targetId)

intersection = coveredBy.filter(id => customerReqIdSet.has(id))

if intersection.length > 0:
  → COVERED by Customer Reqs: intersection
else if coveredBy.length > 0:
  → UNCOVERED (wrong scope) — link exists but target not a Customer Req
else:
  → UNCOVERED (no link)
```

This is a set-membership test in the LLM's working context — **no additional tool calls needed**.

### Step 4 — Produce report

Agent outputs structured report:
- Total reviewed: 300
- Covered: N (cite Customer Req IDs for each)
- Uncovered (wrong scope): M (cite the non-customer target IDs)
- Uncovered (no link): K
- Items with missing `description` or `acceptanceCriteria`: list
- Items with vague terms in title/description: list

Each finding cites the item `id` and the specific field/evidence it was derived from.

### Edge Cases

| Scenario | Correct agent behavior |
|---|---|
| Link target is deleted / inaccessible | `targetId ∉ customerReqIdSet` → UNCOVERED. The rule requires the target to be a reachable Customer Req. |
| Link target is in a third area path | `targetId ∉ customerReqIdSet` → UNCOVERED (wrong scope). |
| `includeRelations` omitted by mistake | Each item has no `relations[]` field → mark ALL as "unknown" for traceability; advise re-running with `includeRelations=true`. |
| Cursor expires between Step 1 and Step 2 | Each scope has its own snapshot. Step 1 completed before Step 2 started, so all 300 Customer IDs are already in `customerReqIdSet`. No replay needed. |
| Over 20,000 IDs in scope | `pageInfo.warnings` will contain a WIQL truncation warning → report the warning to the user; do not assert completeness. |

---

## 6. Relation Between Repo's 7-Attribute Model and 29148

The `RequirementReviewService` in this repo implements a 7-attribute model:
`clear`, `complete`, `consistent`, `singular`, `verifiable`, `feasible`, `traceable`.

Mapping to 29148 individual characteristics:

| Repo attribute | 29148 characteristic(s) |
|---|---|
| clear | Unambiguous (#3) |
| complete | Complete (#4) |
| consistent | Consistent (set-level) |
| singular | Singular (#5) |
| verifiable | Verifiable (#7) |
| feasible | Feasible (#6) |
| traceable | Necessary (#1) + Correct (#8) (partial) |

**Missing from repo model:** Appropriate (#2), Correct (#8) fully, Conforming (#9). These require
domain-expert review or a standards compliance check beyond automated text analysis.

> Note: `RequirementReviewService.review()` is **NOT called by any MCP tool handler**. The server
> is a data-context provider only. The LLM applies its own review rules to the `items[]` data.
> The service exists for off-line use and unit testing of the domain logic.
