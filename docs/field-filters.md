# Field Filters

`source.type="fieldFilters"` lets any scope-accepting tool query work items by field values without writing raw WIQL. Filters are compiled by `GenericWiqlCompiler` in `src/domain/genericWiqlCompiler.ts`.

---

## Input Shape

```typescript
source: {
  type: "fieldFilters",
  filters: FieldFilter[],   // ANDed together; at least one required
  orderBy?: OrderBy[]
}

interface FieldFilter {
  field:    string;                                                      // case-insensitive
  operator: Operator;
  value:    string | number | boolean | string[] | number[];
}

interface OrderBy {
  field:     string;
  direction: "ASC" | "DESC";
}
```

All filters combine with `AND`. For complex boolean logic use `source.type="wiql"`.

---

## Operators by Field Type

The compiler enforces operator validity per field type.

### TreePath (`System.AreaPath`, `System.IterationPath`)

| Operator | Notes |
|---|---|
| `=` | Exact path match |
| `<>` | Not equal |
| `UNDER` | All items at or under this node |
| `NOT UNDER` | Items not under this node |

**`CONTAINS` is explicitly unsupported for TreePath fields.** ADO silently returns wrong results when `CONTAINS` is used on tree-path fields. The compiler throws rather than silently producing broken queries:

> `CONTAINS is not supported for TreePath field "System.AreaPath". Use UNDER, NOT UNDER, =, or <> instead.`

### String (`System.WorkItemType`, `System.State`, `Custom.*`, etc.)

`=`, `<>`, `IN`, `NOT IN`, `CONTAINS`

Use array values only with `IN` / `NOT IN`.

### Numeric and Date (`System.Id`, `Microsoft.VSTS.Common.Priority`, `System.ChangedDate`, etc.)

`=`, `<>`, `IN`, `NOT IN`, `<`, `<=`, `>`, `>=`

Date values must be ISO 8601 strings (e.g. `"2025-01-01T00:00:00Z"`).

### Identity (`System.AssignedTo`, `System.CreatedBy`, `System.ChangedBy`)

`=`, `<>`, `IN`, `NOT IN`, `CONTAINS`

Use display name as value (e.g. `"Jane Smith"`). Identity objects from ADO are normalized to display name before comparison.

### LongText / HTML (`System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`)

`CONTAINS` only. All other operators are rejected.

---

## Case-Insensitive Field Resolution

Field names are resolved case-insensitively against the seed catalog:

```
"Custom.CustomerId"   →  "Custom.CustomerID"
"system.state"        →  "System.State"
"SYSTEM.WORKITEMTYPE" →  "System.WorkItemType"
```

The canonical name from the catalog is used in the generated WIQL.

---

## Custom Fields and `ADO_ALLOW_UNKNOWN_FIELDS`

Custom fields confirmed in the Elisra collection (from `src/domain/adoFields.ts`):

| Field reference | Type | Safe for grouping |
|---|---|---|
| `Custom.CustomerID` | string | yes |
| `Custom.CustomerRequirementId` | string | yes |
| `Custom.SubSystem` | string | yes |
| `Custom.SAPWBS` | string | yes |
| `Custom.TestPhase` | string | yes |
| `Custom.Phase` | string | yes |
| `Elisra.TestPhase` | string | yes |
| `Elisra.CustomerRequirementId` | string | yes |

If a field is absent from the seed catalog the compiler throws:

> `Unknown field "Custom.Foo". Use ado_discover_fields to see available fields, or set ADO_ALLOW_UNKNOWN_FIELDS=true to bypass validation.`

With `ADO_ALLOW_UNKNOWN_FIELDS=true`, unknown fields are treated as strings and a warning is added to the response `warnings` array.

---

## Examples

### Work item type

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "System.WorkItemType", "operator": "IN", "value": ["Requirement", "Feature"] }
  ]
}
```

### AreaPath subtree

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "System.AreaPath", "operator": "UNDER", "value": "MyProject\\SubSystem-A" }
  ]
}
```

### State exclusion

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "System.State", "operator": "NOT IN", "value": ["Closed", "Resolved"] }
  ]
}
```

### Custom CustomerID

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "Custom.CustomerID", "operator": "=", "value": "CUST-042" }
  ]
}
```

### SubSystem with ordered output

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "Custom.SubSystem", "operator": "=", "value": "Navigation" },
    { "field": "System.State", "operator": "<>", "value": "Closed" }
  ],
  "orderBy": [
    { "field": "Microsoft.VSTS.Common.Priority", "direction": "ASC" }
  ]
}
```

### Changed-date range

```json
{
  "type": "fieldFilters",
  "filters": [
    { "field": "System.ChangedDate", "operator": ">=", "value": "2025-01-01T00:00:00Z" },
    { "field": "System.WorkItemType", "operator": "=", "value": "Requirement" }
  ]
}
```

---

## Generated WIQL Structure

```sql
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = @project
  AND [<field1>] <op1> <value1>
  AND [<field2>] <op2> <value2>
ORDER BY [<field>] <DIR>
```

`[System.TeamProject] = @project` is injected automatically. ADO resolves `@project` at query time.

String values are escaped via `wiqlEscape.ts`: `'` → `''`, control characters rejected, length capped at 4000.

---

## Previewing WIQL with `ado_debug_compile_wiql`

When `ADO_ENABLE_DEBUG_OUTPUT=true`, the tool `ado_debug_compile_wiql` compiles filters to WIQL without executing:

```json
// Input
{
  "project": "MyProject",
  "filters": [
    { "field": "Custom.SubSystem", "operator": "=", "value": "Navigation" },
    { "field": "System.State", "operator": "IN", "value": ["Active", "In Review"] }
  ]
}

// Output
{
  "wiql": "SELECT [System.Id] FROM WorkItems\nWHERE [System.TeamProject] = @project\n  AND [Custom.SubSystem] = 'Navigation'\n  AND [System.State] IN ('Active', 'In Review')",
  "warnings": []
}
```

Use to verify generated WIQL, debug unexpected result counts, or confirm custom field name resolution.
