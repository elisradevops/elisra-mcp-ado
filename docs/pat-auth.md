# PAT Authentication

`elisra-mcp-ado` uses Azure DevOps Personal Access Tokens (PATs) for every request to ADO Server / TFS. This document covers what a PAT is, how to create one, the two supported auth modes, and the redaction guarantees applied to logs.

---

## What is a PAT?

A Personal Access Token is a scoped, revocable credential that substitutes for a user password when calling the Azure DevOps REST API. The server encodes the PAT as a Basic auth header using the standard ADO convention:

```
Authorization: Basic base64(":" + pat)
```

The username part is intentionally left empty — ADO treats the token value as the credential.

---

## Creating a PAT in Azure DevOps Server

1. Open your ADO Server instance and sign in.
2. Click your avatar (top-right) → **Personal access tokens**.
3. Click **New Token**.
4. Set the following:
   - **Name** — something identifiable, e.g. `mcp-ado-readonly`.
   - **Organization** — select the collection this server connects to.
   - **Expiration** — choose the shortest practical window; rotate on schedule.
   - **Scopes** — select **Custom defined**, then enable at minimum:
     - `Work Items` → **Read**
   - Additional scopes needed by specific tools:
     - `Project and Team` → **Read** — required for `ado_list_projects` and `ado_ping`.
     - `Analytics` → **Read** — if you intend to use any analytics queries (not in v1).
5. Click **Create** and copy the token immediately — it is shown only once.

> **Minimum scope**: Work Items Read + Project and Team Read.
> Do not grant Write or Manage scopes. The server enforces read-only at the transport layer (`ADO_READ_ONLY=true`), but limiting the PAT scope adds a second layer of protection.

---

## Auth Modes

The mode is configured via the `ADO_AUTH_MODE` environment variable. The two active modes are `per_request_pat` (default) and `server_pat`. A third value, `trusted_header_future`, is reserved and not implemented.

### `per_request_pat` (default)

Each tool call supplies its own PAT as a tool argument named `pat`. The server does not store any credential between calls.

```
# .env
ADO_AUTH_MODE=per_request_pat
# ADO_PAT must NOT be set in this mode (the server logs a warning if it is)
```

How a call looks from the LLM/client side:

```json
{
  "tool": "ado_get_work_items_by_ids",
  "arguments": {
    "pat": "abcdefghij...",
    "ids": [1234, 5678]
  }
}
```

The PAT travels only in the in-process call — it is never persisted to disk, never written to stdout, and is redacted from all log output before any log serializer runs.

**Security note**: in this mode the PAT is visible in the chat transcript between the LLM and the tool. Any chat history stored by the MCP client (Claude, Open WebUI, etc.) will contain the raw token. This is acceptable for developer use but is not recommended for production deployments. Use `server_pat` mode for production.

### `server_pat`

The server reads a single PAT from the `ADO_PAT` environment variable at startup. All tool calls use that credential without requiring the caller to supply one.

```
# .env
ADO_AUTH_MODE=server_pat
ADO_PAT=<your-pat>
```

Use this mode for:
- Service accounts running automated pipelines.
- Open WebUI deployments where the PAT must not be visible to the end user.
- CI/CD integration where a dedicated service account PAT is injected via secrets management.

Do not use `server_pat` for multi-user deployments unless all users should share the same ADO identity.

> If `ADO_AUTH_MODE=server_pat` is set but `ADO_PAT` is absent, the server exits at startup with a clear error rather than silently using an empty credential.

### `trusted_header_future` (reserved, v1 not implemented)

This mode is defined in the configuration schema as a placeholder for a future flow where a trusted reverse proxy injects an identity header (e.g. from an SSO gateway). It is **not implemented** in v1 — calling any tool while this mode is active will return an error immediately.

---

## PAT Redaction in Logs

All log output passes through two layers of redaction before it reaches `stdout`/`stderr`:

**Layer 1 — pino path redaction** (`src/logging/logger.ts`)

Pino is configured with an explicit `redact` list. Any log object containing these key names at any nesting depth will have the value replaced with `<REDACTED>` before serialization:

```
pat, token, secret, password, authorization, x-ado-pat,
cookie, credential, *.pat, *.token, ...
config.headers.authorization, config.auth,
request._header, request._headers
```

**Layer 2 — regex scrub** (`src/security/secretRedaction.ts`)

Before any error message or arbitrary string reaches the logger, `redactString()` applies a regex that matches base64-encoded PAT-shaped strings (52 or more alphanumeric/base64 characters) and replaces them with `<PAT_REDACTED>`:

```ts
const PAT_SHAPE = /[A-Za-z0-9+/]{52,}={0,2}/g;
```

`redactDeep()` walks arbitrary objects recursively, applying both the key-name block list and the regex to every string value.

**Axios error sanitization** (`src/auth/redact.ts`)

When an HTTP request fails, `redactError()` strips `config.headers`, `config.auth`, `request._header`, and `request._headers` from the Axios error object before passing it to the logger or returning it as a tool error response.

The combined effect: no PAT value — whether passed per-request or loaded from env — can appear in any log line, error message, or tool error response.
