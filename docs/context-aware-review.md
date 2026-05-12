# Context-Aware Review

Single-item heuristics (`ado_review_work_items`) flag field-level problems but cannot detect completeness gaps relative to peers or consistency conflicts across related requirements. The context packet pipeline provides the surrounding ADO graph so an AI reviewer has the full picture before making a judgment.

---

## Tools

| Tool | Purpose |
|---|---|
| `ado_build_work_item_context_packet` | Bounded context packet for any work item. |
| `ado_build_requirement_context_packet` | Same, defaults `includeSiblings: true`, hints at `contextField`. |
| `ado_find_requirement_completeness_gaps` | Structured gap analysis at L1/L2/L3 depth. |
| `ado_find_requirement_consistency_candidates` | Find pairs that may conflict or overlap across a group. |
| `ado_resolve_review_scope` | Confirm scope (IDs and counts) before running expensive review calls. |

---

## Context Packet Structure

```typescript
interface ContextPacket {
  workItem:   Record<string, unknown>;    // root item (compact fields + plain-text description)
  parents:    Record<string, unknown>[];  // ancestor chain up to parentDepth levels
  children:   Record<string, unknown>[];  // descendant BFS up to childrenDepth levels
  covers:     Record<string, unknown>[];  // items this req covers (Elisra.CoveredBy-Forward, Affects-Forward)
  coveredBy:  Record<string, unknown>[];  // items that cover this req (CoveredBy-Reverse, Affects-Reverse)
  tests:      Record<string, unknown>[];  // test cases linked via TestedBy-Forward
  related:    Record<string, unknown>[];  // System.LinkTypes.Related (capped at 20)
  siblings:   Record<string, unknown>[];  // items sharing the same parent (requires includeSiblings)
  sameField:  Record<string, unknown>[];  // items with same contextField value (requires contextField)
  truncated:  TruncationNote[];           // records any collection that was capped
}
```

Each item record contains compact fields (id, title, type, state, areaPath, iterationPath, assignedTo, changedDate) plus `description` (HTML stripped, trimmed to `descriptionMaxChars`).

`truncated` entry shape: `{ kind: string, total: number, included: number }`. Kinds:
- `children-level-0`, `children-level-1` — BFS level exceeded breadth cap (100)
- `siblings` — sibling count exceeded `siblingMax` (50)
- `sameField` — same-field results exceeded `sameFieldMax` (50)
- `related` — related items exceeded the 20-item cap

---

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `includeSiblings` | boolean | `false` (`true` for requirement preset) | Fetch items sharing the same parent. |
| `contextField` | string | — | Field ref for same-field grouping. Triggers a WIQL query for items with the same field value as the root. |
| `parentDepth` | 1–3 | `3` | Ancestor levels to traverse upward. |
| `childrenDepth` | 0–2 | `2` | BFS depth for descendant traversal. |
| `descriptionMaxChars` | integer | `2000` | Max plain-text description length per item. Longer descriptions end with `… [truncated]`. |

**contextField examples:**
- `Custom.SubSystem` → peer requirements in the same sub-system
- `Custom.CustomerID` → peer requirements from the same customer
- `System.AreaPath` → peer requirements under the same area node

The same-field query uses `GenericWiqlCompiler` with a single `=` filter. The root item is excluded from results.

---

## Completeness Gap Analysis

`ado_find_requirement_completeness_gaps` runs structured gap detection at three depth levels.

### L1 — Single-item gaps (always analyzed)

| Gap kind | Field checked | Confidence |
|---|---|---|
| `missing_description` | `System.Description` absent | high |
| `short_description` | Description < 30 chars after HTML strip | medium |
| `missing_acceptance_criteria` | `Microsoft.VSTS.Common.AcceptanceCriteria` absent | medium |
| `missing_verification_method` | `Microsoft.VSTS.Common.VerificationMethod` absent | medium |

### L2 — Linked-context gaps (requires `contextMode: "L2"` or `"L3"`)

| Gap kind | Check | Confidence |
|---|---|---|
| `no_traceability_links` | No `Elisra.CoveredBy-*`, `Affects-*`, or `TestedBy-Forward` relation | high |

Items whose relations were not fetched are silently skipped (no false-positive L2 gap).

### L3 — Peer-context gaps (requires `contextMode: "L3"` and `groupField`)

For each of `System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`, and `Microsoft.VSTS.Common.VerificationMethod`:
- If at least one peer in the `groupField` group has the field populated and this item does not → gap, `confidence: medium`
- If no peer has the field either → check skipped (not a differentiating signal)

**`groupField`:** Any field reference name. Typical: `Custom.SubSystem`, `System.AreaPath`, `Custom.CustomerID`.

### Report shape

```typescript
interface CompletenessReport {
  totalAnalyzed:   number;
  totalWithGaps:   number;
  gapCountByLevel: { L1: number; L2: number; L3: number };
  gapCountByKind:  Record<string, number>;
  findings: WorkItemGaps[];
}
```

---

## Consistency Candidate Analysis

`ado_find_requirement_consistency_candidates` finds pairs of requirements that may conflict or overlap. Uses grouping-first strategy to keep complexity bounded.

### Grouping modes

| `comparisonMode` | Grouping logic | Notes |
|---|---|---|
| `parent` | Items sharing the same parent (Hierarchy-Reverse link) | Requires relations fetch |
| `field` | Items sharing the same value for `comparisonField` | `comparisonField` required |
| `title-tokens` | Items sharing the top 4 non-stop-word title tokens | Tokens sorted + lowercased |

### Pair heuristics (applied within each group)

| Kind | Signal | Confidence |
|---|---|---|
| `near_duplicate` | Title Jaccard similarity ≥ 0.85 and titles differ | high |
| `conflicting_threshold` | Title Jaccard ≥ 0.5 and different numeric values in title+description | medium |
| `contradictory_shall` | Jaccard ≥ 0.4 and one uses "shall not", other uses "shall" on similar subject | medium |

### `maxGroupSize` guard

Groups exceeding `maxGroupSize` (default 25, max 100) are **skipped entirely** and reported in `truncatedGroups`. No O(N²) fallback — narrow the scope or increase `maxGroupSize` to analyze a large group.

### Result shape

```typescript
interface ConsistencyCandidateResult {
  totalAnalyzed:   number;
  totalGroups:     number;
  candidatePairs:  CandidatePair[];
  truncatedGroups: TruncatedGroup[];
}
```

All findings are "candidates" — human review is required to confirm actual conflicts.

---

## Recommended Workflow

### Step 1 — Confirm scope

```json
{
  "tool": "ado_resolve_review_scope",
  "source": {
    "type": "fieldFilters",
    "filters": [
      { "field": "System.WorkItemType", "operator": "IN", "value": ["Requirement"] },
      { "field": "System.AreaPath", "operator": "UNDER", "value": "MyProject\\SubSystem-A" }
    ]
  },
  "responseMode": "overview"
}
```

Inspect `totalMatched` and `sampleIds`. If unexpectedly large, add more filters.

### Step 2 — Run overview review

```json
{
  "tool": "ado_review_requirements",
  "source": "(same as step 1)",
  "responseMode": "overview"
}
```

Inspect `summary.byRisk`. Collect `sampleHighRiskIds`.

### Step 3 — Build context packets for high-risk items

```json
{
  "tool": "ado_build_requirement_context_packet",
  "id": 12345,
  "contextField": "Custom.SubSystem",
  "includeSiblings": true
}
```

Repeat for each high-risk ID. The packet gives the AI reviewer the full ADO neighborhood.

### Step 4 — AI reviews the context packet

Pass the `ContextPacket` JSON to the AI and ask it to:
- Identify completeness gaps relative to parents and siblings
- Check for consistency conflicts with peer requirements
- Verify traceability links are appropriate

For bulk gap analysis before drilling in, use `ado_find_requirement_completeness_gaps` with `contextMode: "L2"` or `"L3"` on the same scope first.
