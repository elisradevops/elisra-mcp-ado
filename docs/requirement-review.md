# Requirement Review

`elisra-mcp-ado` implements a 7-attribute requirement quality model derived from IEEE 29148. The review runs entirely from ADO field values and relation links — no external system access is required.

---

## Tools

| Tool | Purpose |
|---|---|
| `ado_review_work_items` | Generic entry point. Accepts any scope source and any work item type. |
| `ado_review_requirements` | Preset wrapper. Sets `preset: "requirement_quality"` in the response envelope. Tip: combine with a `fieldFilters` source scoped to `System.WorkItemType IN ["Requirement", "Feature"]`. |

Both tools share identical parameters (`source`, `responseMode`, `sampleSize`, `maxItems`) and produce the same `ReviewFinding[]` shape.

---

## Response Modes

| Mode | What is returned |
|---|---|
| `overview` (default) | Risk distribution summary (`byRisk`, `byAttribute` counts) + up to 5 `sampleHighRiskIds` for immediate drill-down. No per-item findings in the payload. |
| `samples` | Summary + first `sampleSize` findings (default 10, max 50). Use after `overview` to inspect representative items. |
| `full` | Summary + all findings. Guarded by `ADO_FULL_RESPONSE_MAX_ITEMS` (default 50). Returns an error if resolved item count exceeds the cap — narrow the scope or raise the cap. |

The `overview` `sampleHighRiskIds` array contains IDs of items whose `overallRisk` is `"high"`. Pass them directly into `ado_build_requirement_context_packet` for deep-dive context analysis.

---

## Overall Risk Derivation

`overallRisk` is derived from the worst high-confidence finding across all 7 attributes:

- `high` — any attribute has `status: warn | missing` **and** `confidence: high`
- `medium` — any attribute has `status: warn | missing` **and** `confidence: medium`
- `low` — only `confidence: low` problems found
- `none` — all attributes are `ok` or `unknown`

---

## The 7 Attributes

### 1. Clear

Checks title and description are free of vague, ambiguous language.

- Missing title → `status: missing`, `confidence: high` (deterministic field-absence)
- Vague-term lexicon match in title or description → `status: warn`, `confidence: medium`
- No vague terms found → `status: ok`, `confidence: medium` (lexicon is not exhaustive)

**Vague-term lexicon** (from `src/domain/lexicon.ts`):
`appropriate`, `as needed`, `as appropriate`, `TBD`, `and/or`, `support`, `efficient`, `optimal`, `user-friendly`, `robust`, `etc.`, `etc`, `e.g.`, `i.e.`, `should be able to`, `if possible`, `where applicable`, `reasonable`, `flexible`, `easy to use`, `state of the art`, `intuitive`

---

### 2. Complete

Checks description is present and non-trivial; Acceptance Criteria field is populated.

- `System.Description` absent → `status: missing`, `confidence: high`
- Description shorter than 30 chars → `status: warn`, `confidence: medium`
- `Microsoft.VSTS.Common.AcceptanceCriteria` absent → `status: warn`, `confidence: medium`
- Both description (≥30 chars) and AcceptanceCriteria present → `status: ok`, `confidence: medium`

HTML is stripped before the length check. `<p><b>Hi.</b></p>` = 3 chars of actual content.

**Limitation:** Full completeness — detecting missing preconditions or scope gaps relative to parent requirements — requires `ado_build_requirement_context_packet`.

---

### 3. Consistent

Always returns `status: unknown`, `confidence: low` for single-item review. Consistency is inherently a cross-item property. Use `ado_find_requirement_consistency_candidates` for cross-item analysis.

---

### 4. Singular

Checks the work item expresses exactly one requirement.

- "shall" count > 3 across title + description → `status: warn`, `confidence: medium`
- Two or more "shall" clauses within 200 chars of each other → `status: warn`, `confidence: medium`
- No pattern matched → `status: ok`, `confidence: medium`

Implemented via `countShall()` in `src/domain/lexicon.ts`. Word-boundary match on `\bshall\b`.

---

### 5. Verifiable

Checks whether the requirement has a defined verification method or measurable acceptance criteria.

- `Microsoft.VSTS.Common.VerificationMethod` field is set → `status: ok`, `confidence: high`
- Field absent but description contains a numeric + unit pattern → `status: ok`, `confidence: medium` (with recommendation to set the field)
- Neither condition met → `status: warn`, `confidence: medium`

Numeric + unit regex matches patterns like: `500ms`, `99%`, `10 seconds`, `1 GB`, `120 Hz`, `200 rpm`.

---

### 6. Feasible

Checks for absolute or infeasible constraint language.

- Risk-term lexicon match in title or description → `status: warn`, `confidence: low`
- No risk terms found → `status: unknown`, `confidence: low`

Always low confidence — feasibility depends on constraints not available in ADO. Risk-term warnings prompt human expert review, not definitive findings.

**Risk-term lexicon** (from `src/domain/lexicon.ts`):
`always`, `never`, `100%`, `zero false positives`, `zero false negatives`, `instant`, `real-time`, `unlimited`, `guaranteed`, `fail-safe`, `no downtime`, `perfect`, `error-free`

---

### 7. Traceable

Checks whether the work item has at least one traceability link.

- Relations not fetched (undefined) → `status: unknown`, `confidence: low`
- At least one relation whose `rel` contains `Affects`, `CoveredBy`, or `TestedBy` → `status: ok`, `confidence: high`
- No matching relation → `status: warn`, `confidence: high`

Relations are always fetched (`expand: relations`) during review, so the result is almost always high confidence.

| Token | Canonical relation types matched |
|---|---|
| `Affects` | `System.LinkTypes.Affects-Forward`, `Affects-Reverse` |
| `CoveredBy` | `Elisra.CoveredBy-Forward`, `Elisra.CoveredBy-Reverse` |
| `TestedBy` | `Microsoft.VSTS.Common.TestedBy-Forward`, `TestedBy-Reverse` |

---

## Fields Fetched for Review

```
System.Id, System.Title, System.WorkItemType, System.State,
System.AreaPath, System.IterationPath, System.Description,
System.AssignedTo, System.ChangedDate,
Microsoft.VSTS.Common.VerificationMethod,
Microsoft.VSTS.Common.AcceptanceCriteria
```

Plus `relations` (always expanded so traceable yields a deterministic result).

---

## Confidence Level Reference

| Level | Meaning |
|---|---|
| `high` | Deterministic — field presence/absence or exact link match. No false positives from heuristics. |
| `medium` | Text heuristic — lexicon scan, length threshold, or regex pattern. May miss cases or produce false positives. |
| `low` | Requires external context — domain expertise, sibling comparison, or constraints not in ADO. |
