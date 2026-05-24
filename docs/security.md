# Security Model

This document covers every security control active in `elisra-mcp-ado` v1: TLS enforcement, credential redaction, read-only enforcement, the mcpo bridge API key, full-response size guard, and the PAT-in-chat risk of `per_request_pat` mode.

---

## TLS: CA-only, No Bypass

All outbound connections to Azure DevOps Server use `https.Agent` with Node's default CA validation. There is no `rejectUnauthorized: false` option, no environment flag to disable validation, and no code path that accepts an untrusted certificate.

```ts
// src/ado/adoClient.ts — excerpted
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  keepAliveMsecs: 300_000,
  // No rejectUnauthorized:false — fail loud if cert is untrusted
});
```

If TLS validation fails, the client detects the error code and returns a diagnostic message:

```
TLS certificate validation failed for Azure DevOps Server (CERT_UNTRUSTED).
If the server uses a self-signed or corporate CA certificate,
set NODE_EXTRA_CA_CERTS=/path/to/ca.pem and restart.
Do NOT disable certificate validation.
```

TLS errors are not retried — the connection fails immediately without backoff. This prevents credential leakage to an endpoint that cannot be verified.

**On-prem TFS with a corporate CA**: use `NODE_EXTRA_CA_CERTS`. Node reads this environment variable natively and appends the file to its trusted CA store. No code changes are required. See `docs/onprem-ado.md` for how to export the cert and mount it into the container.

---

## PAT Redaction

Every log line and every error returned to a tool caller passes through two redaction layers before leaving the process. See `docs/pat-auth.md` for the full description. In brief:

- **pino path redaction** (layer 1): key-name block list at any object depth — `pat`, `token`, `secret`, `password`, `authorization`, `x-ado-pat`, `cookie`, `credential`, and their Axios nested paths. Values are replaced with `<REDACTED>` before serialization.
- **regex scrub** (layer 2): `redactString()` in `src/security/secretRedaction.ts` replaces any 52+-character base64 string — the shape of an ADO PAT — with `<PAT_REDACTED>`. Applied to every string before it is logged or returned as a tool error.
- **Axios error sanitization**: `redactError()` strips `config.headers`, `config.auth`, `request._header`, `request._headers` from failed HTTP request errors before they reach any output path.

Where redaction applies:

| Code path | Redacted by |
|---|---|
| pino log statements | pino `redact` config (layer 1) |
| Error messages passed to logger | `redactError()` + `redactString()` (layer 2) |
| Tool error responses returned to LLM | `redactError()` (layer 2) |
| HTTP request config in Axios errors | `redactError()` explicit field removal |

Where redaction does **not** apply:

- The in-memory `AuthContext.pat` field while a request is in flight. This is intentional: the PAT must be present to sign the HTTP request.
- The `ADO_PAT` environment variable in `server_pat` mode — this is a process-level secret and is never logged or returned.

---

## Read-Only Enforcement

`ADO_READ_ONLY=true` is set in both `.env.example` and hardcoded to `"true"` in `docker-compose.yml` for both services. The value is parsed at startup and stored in `AppConfig.adoReadOnly`.

In v1, all registered tools are read-only by design — the tool set contains no write, update, or delete operations. `ADO_READ_ONLY` exists as an explicit contract that is checked at the application layer and documented in configuration so that any future write tools must opt in explicitly rather than inheriting a permissive default.

PAT scope provides a second enforcement layer: the minimum required scope is `Work Items: Read`. A PAT without write scopes cannot mutate data regardless of what the server attempts.

---

## MCPO_API_KEY: mcpo Bridge Protection

The `mcpo` sidecar wraps the stdio MCP server as an HTTP endpoint for Open WebUI. Without authentication, any process that can reach the container's port could invoke ADO tools.

`MCPO_API_KEY` is passed to mcpo at startup. mcpo requires the key in a `Authorization: Bearer <key>` header on every HTTP request. Requests without the correct key are rejected before reaching the MCP server.

```
# .env
MCPO_API_KEY=<strong-random-value>
```

In `docker-compose.yml` the key defaults to `changeme` for local development. **Change this before any network-accessible deployment.**

The key protects the HTTP bridge only — the stdio transport (`elisra-mcp-ado` service) has no HTTP surface and is not affected.

---

## Pagination Guard: ADO_PAGE_SIZE_MAX

All review tools return results one page at a time. The maximum page size is bounded by `ADO_PAGE_SIZE_MAX` (default: 200 — the ADO `workitemsbatch` ceiling). Callers cannot request more items per page than this limit.

The server-side snapshot cache (`ScopeSnapshotCache`) holds resolved ID lists for up to `ADO_SCOPE_CACHE_MAX_ENTRIES` concurrent scopes (default: 50) with a TTL of `ADO_SCOPE_CACHE_TTL_MS` (default: 600 000 ms). This bounds memory usage to approximately 8 MB worst-case.

Purpose: prevent unbounded context injections that could degrade LLM performance, exhaust token budgets, or trigger context-length errors. The model iterates via `cursor` until `pageInfo.isComplete=true`, accumulating items locally before drawing conclusions — it never receives an unsized response.

---

## PAT Visibility in `per_request_pat` Mode

When `ADO_AUTH_MODE=per_request_pat`, the LLM passes the PAT as a tool argument. This means:

- The PAT appears in the model's context window during the conversation turn.
- Any client that stores conversation history (Claude, Open WebUI, etc.) will persist the raw token value in that history.
- The PAT is not visible in server logs (redacted), but it is visible in the chat transcript.

**Recommendation**: use `per_request_pat` only in:
- Developer workstations where the chat history is local and controlled.
- Sessions where the PAT is short-lived and will be revoked after the session.

For any shared, multi-user, or long-lived deployment, use `server_pat` mode with a service account PAT injected via a secrets manager. The end user never sees or handles the PAT in that configuration.

---

## Project Access: Governed by PAT, Not by Server Config

By design, `elisra-mcp-ado` does not maintain an `ADO_ALLOWED_PROJECTS` or `ADO_DEFAULT_PROJECT` allowlist. These variables were explicitly removed (see `.env.example` comments).

Project access is determined entirely by what the PAT is authorized to see in Azure DevOps. If the PAT's owning account has access to three projects, the server can query all three. If the account is scoped to a single project, the server cannot access others regardless of tool arguments.

This keeps the authorization model simple, consistent, and auditable through ADO's own access controls rather than a secondary server-side list that could become stale or misconfigured.
