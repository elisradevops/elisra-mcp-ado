wh# Performance & Guardrails

## Big-O Summary

| Service / Operation              | Time                                      | ADO API Calls       | Memory         | Guardrail                                                                                     |
| -------------------------------- | ----------------------------------------- | ------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| WIQL execution                   | O(N) ids returned                         | 1                   | O(N)           | `$top` cap (ADO-side)                                                                         |
| Field-filter compilation         | O(F)                                      | 0                   | O(F)           | unknown-field rejection                                                                       |
| Field discovery                  | O(M + D)                                  | 1–2 (cached)        | O(M + D)       | 1-hour TTL; `refresh:true` invalidates                                                        |
| `WorkItemService.fetchMany`      | O(N)                                      | O(⌈N/200⌉)          | O(N) compact   | batch cap 200; `BATCH_CONCURRENCY=3`                                                          |
| Linked traversal BFS             | O(L + R) where R = relations              | O(⌈L/200⌉)          | O(L)           | `depth ≤ 3`, breadth `≤ 100` per level                                                        |
| Context packet build             | O(L + S) bounded                          | O(⌈(L+S)/200⌉)      | O(L+S) compact | `parentDepth=3`, `childrenDepth=2`, `childrenBreadth=100`, `siblingMax=50`, `sameFieldMax=50` |
| Requirement review (single-item) | O(N)                                      | 0 (already fetched) | O(N)           | N capped by `maxItems` (default 50)                                                           |
| Completeness gap analysis        | O(N · F) where F = 3 fixed fields         | 0                   | O(N)           | F is constant; N capped by `maxItems`                                                         |
| Consistency candidate grouping   | O(N) group build + O(Σ Gᵢ²) within groups | 0                   | O(N)           | groups > `maxGroupSize` (default 25) are **skipped entirely**; no O(N²) fallback              |
| Overview response                | O(G + S)                                  | 0                   | O(G + S)       | sampleIds capped at 5 per group                                                               |
| Full response                    | O(N)                                      | 0                   | O(N)           | rejected if N > `ADO_FULL_RESPONSE_MAX_ITEMS` (default 50)                                    |

## Enforced Guardrails

### N+1 Prevention

All multi-item fetches go through `WorkItemService.fetchMany(ids[])` which batches at `min(ADO_BATCH_SIZE, 200)`.
No code path calls `_apis/wit/workitems/{id}` in a loop.

### O(N²) Prevention

`ConsistencyCandidateService` enforces `maxGroupSize` (default 25). Groups larger than this are **skipped** (emitted in `truncatedGroups`) — never compared. There is no all-pairs fallback mode in v1.

### BFS Depth/Breadth Caps

`ReviewScopeResolver.resolveLinkedItems` hard-caps at `MAX_DEPTH=3` and `MAX_BREADTH_PER_LEVEL=100`.
`ContextPacketService.traverseChildren` applies the same cap per BFS level; truncation is reported in `packet.truncated`.

### Full-Mode Guard

`checkFullModeGuard(count, cap)` in `domain/responseModes.ts` is called before any full-mode fetch.
Default cap: `ADO_FULL_RESPONSE_MAX_ITEMS=50`. Increase via env var for specific use cases.

### Batch Concurrency

`WorkItemService.fetchMany` runs up to `BATCH_CONCURRENCY=3` ADO batch requests in parallel.
3 concurrent requests is safe for on-prem TFS; ADO Online can typically handle more.

### Description Truncation

Context packet trims item descriptions to `descriptionMaxChars` (default 2000) after HTML stripping.
Prevents large HTML descriptions from bloating context packets.

### TCM Field Guard

`Microsoft.VSTS.TCM.Steps` and `Microsoft.VSTS.TCM.ReproSteps` are excluded from all default field sets.
These can exceed 500KB per item. Include explicitly via `fields:[]` only when needed.

## Configuration Tuning

| Env Var                       | Default | Purpose                                                    |
| ----------------------------- | ------- | ---------------------------------------------------------- |
| `ADO_BATCH_SIZE`              | 200     | Items per `workitemsbatch` call. Lower if ADO returns 413. |
| `ADO_FULL_RESPONSE_MAX_ITEMS` | 50      | Hard cap for full-mode responses.                          |
| `ADO_REQUEST_TIMEOUT_MS`      | 30000   | Per-request HTTP timeout. Increase for slow on-prem TFS.   |

## Known Limitations

- **Traceability overview** (not yet implemented in v1) would be O(N · R). When added, it must hydrate all items in a single `fetchMany` call — no per-item API calls allowed.
- **Consistency grouping** only avoids O(N²) per group via `maxGroupSize`. Cross-group pairs are never compared by design.
- **Completeness L3 peer groups** are built on the tool layer from items already in memory — no extra ADO calls. If the group field has high cardinality, many singleton groups form, each with no peers (correct but wasteful to fetch — narrow the scope first).
