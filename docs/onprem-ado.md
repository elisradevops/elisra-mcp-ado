# On-Premises Azure DevOps Server / TFS

This document covers everything specific to connecting `elisra-mcp-ado` to an on-premises Azure DevOps Server or Team Foundation Server (TFS) installation: URL format, API version compatibility, corporate CA certificates, custom link types, and custom fields.

---

## URL Format

On-premises TFS uses a collection-based URL structure. The format is:

```
https://<host>[:<port>]/tfs/<CollectionName>
```

Common examples:

```
https://tfs.company.local/tfs/DefaultCollection
https://ado.internal.corp:8080/tfs/EngineeringCollection
https://tfsserver/tfs/DefaultCollection
```

Set this as `ADO_ORG_URL` in `.env`. The server strips any trailing slash automatically.

> The URL must start with `https://`. The configuration validator rejects `http://` at startup. If your on-prem TFS is currently serving plain HTTP, you must either enable TLS on the server or place a TLS-terminating reverse proxy in front of it.

**Collection-level vs project-level API paths**

The ADO REST API has two path families:

- **Collection-level**: `{adoOrgUrl}/_apis/...` — used for operations that span all projects, such as listing projects, discovering fields, or querying across the collection.
- **Project-level**: `{adoOrgUrl}/{project}/_apis/...` — used for operations scoped to a specific project, such as listing work item types for a project or querying WIQL within a project context.

`elisra-mcp-ado` builds both path families. The `FieldsClient.listFields()` call hits the collection-level endpoint (`/_apis/wit/fields`) to get all fields across the collection. The `FieldsClient.listWorkItemTypeFields()` call hits the project-level endpoint (`/{project}/_apis/wit/workitemtypes/{type}/fields`) to get fields scoped to a specific work item type.

---

## API Version Compatibility

Azure DevOps Server and TFS versions vary widely in on-premises deployments. Newer API versions are rejected by older TFS instances with `400 Bad Request`, `404 Not Found`, `405 Method Not Allowed`, or `410 Gone`.

`ADO_API_VERSION` sets the preferred version (default: `7.0`). When a request is rejected with one of the step-down status codes (`400`, `404`, `405`, `406`, `410`), the server automatically retries with the next version in the ladder:

```
configured version  →  5.1  →  4.1  →  (no api-version parameter)
```

This ladder is defined in `src/ado/apiVersionLadder.ts`. The fallback is opt-in per request — all ADO clients in this server (`wiqlClient`, `workItemsClient`, `fieldsClient`, `linkTypesClient`, `queriesClient`, `projectsClient`) use it. The step-down happens only when the configured version is rejected; if `7.0` is accepted, no fallback fires.

Recommended setting by TFS/ADO Server version:

| Server version | Recommended `ADO_API_VERSION` |
|---|---|
| Azure DevOps Server 2022 | `7.0` (default) |
| Azure DevOps Server 2020 | `6.0` or `7.0` (ladder handles downgrade) |
| Azure DevOps Server 2019 | `5.1` |
| **TFS 2018** | **`4.1`** — set this explicitly; POST `workitemsbatch` is not available on TFS 2018 and the work-item batch path automatically switches to `GET /_apis/wit/workitems?ids=...` when `ADO_API_VERSION` is below `5.0`. |
| TFS 2017 and older | `3.0` (set explicitly) |

**TFS 2018 notes:**

- Set `ADO_API_VERSION=4.1` in `.env`. With this setting the batch work-item read path uses `GET /_apis/wit/workitems?ids=...` automatically — no code change required.
- The `@StartOfDay`, `@StartOfWeek`, `@StartOfMonth`, and `@StartOfYear` WIQL macros were added in ADO Server 2019. When these macros appear in a scope query and `ADO_API_VERSION` is below `5.0`, the tools emit a warning in the response `warnings[]` array explaining the potential incompatibility. The macro is still sent to the server as-is; TFS 2018 returns a WIQL parse error if it cannot evaluate it.
- If you experience consistent failures with a specific TFS version, set `ADO_API_VERSION` explicitly to a version that version is known to support.

---

## WIQL size limit

ADO Server enforces a hard limit of **32 768 characters** on WIQL query strings. When a generated query exceeds **32 000 characters** (a conservative client-side threshold), the tools emit a warning in the `warnings[]` array:

```
Generated WIQL is NNNNN chars; server limit is 32 768. Tighten filters or split the query.
```

The query is still sent to the server — the warning is informational. If the server returns a 400 error for a very large query, reducing the number of filter values or splitting the scope into two smaller queries will resolve it.

---

## Corporate CA Certificate

On-premises TFS installations typically use a TLS certificate signed by an internal corporate Certificate Authority (CA). Node.js does not trust corporate CAs by default, so connections will fail with a TLS error unless the CA cert is provided.

**Do not use `rejectUnauthorized: false`.** The server explicitly prohibits this and will fail loudly with a descriptive error if TLS validation fails.

### Step 1: Export the CA certificate from the Windows certificate store

On a Windows machine that trusts the corporate CA:

1. Open **Certificate Manager** (`certmgr.msc`).
2. Navigate to **Trusted Root Certification Authorities** → **Certificates**.
3. Find the certificate that issued your TFS server's certificate.
4. Right-click → **All Tasks** → **Export**.
5. Choose **Base-64 encoded X.509 (.CER)** format.
6. Save as `elisra-ca.pem` (the `.cer` extension is the same format; just rename it to `.pem`).

Alternatively, export from the command line:

```powershell
# Export the corporate root CA to PEM
certutil -export -f "Corporate Root CA" C:\certs\elisra-ca.pem
```

Or on Linux/macOS if the cert is already in a browser's trust store, use the browser to export to PEM format.

### Step 2: Mount the cert into the container

Place the exported `elisra-ca.pem` in a local `certs/` directory and set the env variables:

```bash
mkdir -p ./certs
cp /path/to/elisra-ca.pem ./certs/elisra-ca.pem
```

In `.env`:

```
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
HOST_CA_CERT_PATH=./certs/elisra-ca.pem
```

`docker-compose.yml` maps `HOST_CA_CERT_PATH` on the host to the `NODE_EXTRA_CA_CERTS` path inside the container as a read-only bind mount:

```yaml
volumes:
  - ${HOST_CA_CERT_PATH:-/dev/null}:${NODE_EXTRA_CA_CERTS:-/etc/ssl/certs/elisra-ca.pem}:ro
```

Node reads `NODE_EXTRA_CA_CERTS` automatically at startup and appends the file to its trusted CA store. No code changes are needed.

### Step 3: Verify connectivity

```bash
docker compose run --rm elisra-mcp-ado node dist/index.js
```

A successful TLS connection produces no TLS errors in the log. A failure produces the diagnostic message pointing back to `NODE_EXTRA_CA_CERTS`.

---

## Custom Link Types

The Elisra project uses two link-type families that affect traceability queries.

### Built-in CMMI: Affects

`System.LinkTypes.Affects-Forward` / `System.LinkTypes.Affects-Reverse` are standard CMMI link types built into every TFS instance that includes the CMMI process template. They do not require any custom extension.

- `Affects-Forward` — the linked item is affected by the source item (source affects target).
- `Affects-Reverse` — the source item is affected by the linked item.

The domain layer identifies these by substring matching on `'Affects'` in the relation's `rel` name (`src/domain/adoLinkTypes.ts`):

```ts
export const TRACEABILITY_TOKENS = ['Affects', 'CoveredBy'] as const;
```

### Custom: Elisra.CoveredBy

`Elisra.CoveredBy-Forward` and `Elisra.CoveredBy-Reverse` are custom link types defined specifically in the Elisra Azure DevOps Server collection. They are not present in stock ADO installations and must be installed as part of the Elisra process template or extension.

- `Elisra.CoveredBy-Forward` — "Covered by": the source system item covers the linked customer requirement.
- `Elisra.CoveredBy-Reverse` — "Covers": the linked customer requirement is covered by the source system item.

The domain layer classifies these as traceability links via the `'CoveredBy'` substring token — the same mechanism used by DocGen's `docgen-data-provider-package`. Both forward and reverse directions are matched by a single token check.

Full reference names are defined as constants in `src/domain/adoLinkTypes.ts`:

```ts
ELISRA_COVERED_BY_FORWARD: 'Elisra.CoveredBy-Forward',
ELISRA_COVERED_BY_REVERSE: 'Elisra.CoveredBy-Reverse',
```

To query work items and include their traceability links, request `expand: "relations"` in any work item fetch tool and check the `relations[].rel` field of the response against these reference names.

---

## Custom Fields

The Elisra collection defines several custom fields beyond the standard ADO schema. These fields have the `Custom.` or `Elisra.` namespace prefix.

### Confirmed custom fields

| Reference Name | Display Name | Type | Use in DocGen |
|---|---|---|---|
| `Custom.SubSystem` | Sub System | string | Yes — work item grouping |
| `Custom.CustomerID` | Customer ID | string | Yes — customer traceability |
| `Custom.CustomerRequirementId` | Customer Requirement ID | string | Yes — external requirement link |
| `Custom.SAPWBS` | SAP WBS | string | Yes — cost/project tracking |
| `Custom.TestPhase` | Test Phase | string | Yes — test scope classification |
| `Custom.Phase` | Phase | string | Yes — lifecycle phase |
| `Elisra.TestPhase` | Test Phase (Elisra) | string | Yes — alternative namespace |
| `Elisra.CustomerRequirementId` | Customer Requirement ID (Elisra) | string | Yes — alternative namespace |

### Discovering custom fields at runtime

Use the `ado_discover_fields` tool to retrieve all fields available in the collection, including custom ones not in the seed catalog:

```json
{
  "tool": "ado_discover_fields",
  "arguments": {
    "pat": "...",
    "project": "YourProjectName",
    "workItemType": "Requirement"
  }
}
```

The tool queries `{adoOrgUrl}/_apis/wit/fields` (collection-level) and optionally `{adoOrgUrl}/{project}/_apis/wit/workitemtypes/{type}/fields` (project-level). Results are cached for one hour per collection. Pass `refresh: true` to force a re-fetch.

The output includes `isCustom: true` for any field whose reference name starts with `Custom.` or `Elisra.`.

### Case-insensitive field resolution

Field reference names in the seed catalog are stored in a `CaseInsensitiveMap` (`src/utils/caseInsensitiveMap.ts`). This means tool arguments and WIQL queries that use `custom.subsystem` instead of `Custom.SubSystem` are resolved correctly. This mirrors DocGen's behavior and accommodates the inconsistent casing that sometimes appears in TFS field metadata.

### Fields not in the seed catalog

If `ado_discover_fields` returns a field that is not in the seed catalog (i.e., `source: "discovered"` and `knownInDocGen: false`), the field can still be used in queries and fetches. Set `ADO_ALLOW_UNKNOWN_FIELDS=true` in `.env` to permit these fields to pass validation without warnings.
