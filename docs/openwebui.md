# Open WebUI Integration

`elisra-mcp-ado` exposes a native MCP Streamable HTTP endpoint (`/mcp`). No sidecar or bridge required.

## Quick Start

### 1. Prepare environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required fields:

```bash
ADO_ORG_URL=https://tfs.your-company.local/tfs/DefaultCollection
ADO_PAT=your-service-account-pat
MCP_HTTP_BEARER_TOKEN=choose-a-strong-random-key
```

If your TFS uses a corporate CA certificate:

```bash
HOST_CA_CERT_PATH=/etc/ssl/certs/your-corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

### 2. Start the server

```bash
docker compose up -d
```

One container starts: `elisra-mcp-ado` — native MCP HTTP on port **3000**.

Verify it is up:

```bash
curl -fsS http://localhost:3000/healthz
# {"status":"ok"}
```

Verify the MCP endpoint accepts your bearer token:

```bash
curl -fsS \
  -H "Authorization: Bearer $MCP_HTTP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://localhost:3000/mcp | jq '.result.tools[].name'
```

### 3. Add to Open WebUI

1. Open Open WebUI → **Settings → Tools**
2. Click **Add Tool**
3. Set the **Type** to **MCP**
4. Fill in:
   - **URL**: `http://<your-server-ip>:3000/mcp`
   - **Authorization Header**: `Bearer <MCP_HTTP_BEARER_TOKEN>`
5. Click **Save**

Open WebUI discovers all tools automatically via the MCP `tools/list` call.

### 4. Grant tool access to a model

1. Open a chat with any model
2. Enable **Tools** in the model settings or via the chat toolbar
3. The `elisra-mcp-ado` tools appear in the tool list (e.g. `ado_ping`, `ado_query_work_items`)

## Authentication

### ADO authentication (server-side, operator-managed)

In HTTP mode, ADO authentication is **always server-side**. The `ADO_PAT` is set by the operator in the deployment environment and is never exposed in chat or in the MCP protocol.

```bash
# .env (operator sets this — not visible to Open WebUI users)
ADO_AUTH_MODE=server_pat
ADO_PAT=your-service-account-pat
```

Tool calls do **not** accept a `pat` argument when the server is in `server_pat` mode. If a model attempts to pass one, it is ignored.

### MCP bearer token (tool-server access control)

`MCP_HTTP_BEARER_TOKEN` is the credential that protects the `/mcp` endpoint itself. Set it in Open WebUI as the Authorization header value. It is separate from the ADO PAT.

**Security notes:**
- The bearer token controls access to the MCP server; the ADO PAT controls access to Azure DevOps.
- The ADO PAT never leaves the server. It will not appear in chat transcripts, logs, or MCP responses.
- PATs and Authorization headers are redacted in all server log output.

## Verifying the Integration

### ado_ping

```
Call ado_ping
```

Expected response:
```json
{
  "collection": "https://tfs.your-company.local/tfs/DefaultCollection",
  "projects": ["ProjectA", "ProjectB"],
  "apiVersion": "7.0"
}
```

This verifies server-to-ADO connectivity. If the ADO PAT is wrong or the `ADO_ORG_URL` is incorrect, this call returns an error before any other tool is attempted.

### ado_discover_fields

```
Call ado_discover_fields with project="YourProject"
```

Returns the field catalog for the project. Confirms field metadata access.

## Pagination Protocol

All review tools return **one page** of results per call. The model must iterate until `pageInfo.isComplete=true`.

### Overview / first call

Call any review tool **without** a `cursor` to get the first page:

```json
{
  "source": { "type": "fieldFilters", "filters": [...] },
  "pageSize": 50
}
```

Response includes:
```json
{
  "_instruction": "Use ONLY the work items in items[] for analysis...",
  "pageInfo": {
    "totalMatched": 312,
    "offset": 0,
    "pageSize": 50,
    "returnedCount": 50,
    "nextCursor": "eyJzIjoiNGI3....",
    "isComplete": false
  },
  "items": [...]
}
```

### Subsequent pages

Pass the `nextCursor` value back to get the next page:

```json
{
  "source": { "type": "fieldFilters", "filters": [...] },
  "cursor": "eyJzIjoiNGI3....",
  "pageSize": 50
}
```

Repeat until `pageInfo.isComplete=true`. Accumulate `items[]` locally across all pages before drawing conclusions.

**Never invent or infer items that have not yet been returned.**

### Cursor expiry

Cursors are valid for 10 minutes (configurable via `ADO_SCOPE_CACHE_TTL_MS`). If a `CURSOR_EXPIRED` error is returned, restart pagination from page 1 (call without `cursor`).

### Scale constraint

The snapshot cache is in-process memory. Do not horizontally scale the MCP server without sticky sessions or an external cache (e.g. Redis). Single-replica Kubernetes deployments are unaffected.

### Migration from responseMode="samples" / "full"

The old `responseMode`, `sampleSize`, and `maxItems` parameters have been removed. Replace with `pageSize` and iterate via `cursor`. The old parameters were designed to return partial results for LLM analysis, which caused the model to invent missing items — the cursor-paginated approach eliminates that failure mode.

## Operator Reference

### Required environment variables (HTTP mode)

| Variable | Description |
|---|---|
| `ADO_ORG_URL` | Full collection URL, e.g. `https://tfs.corp.local/tfs/DefaultCollection` |
| `ADO_PAT` | Service account PAT with Read access to Work Items |
| `MCP_HTTP_BEARER_TOKEN` | Bearer token for the `/mcp` endpoint |

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind address inside container |
| `MCP_HTTP_PORT` | `3000` | Listen port |
| `MCP_HTTP_PATH` | `/mcp` | MCP endpoint path |
| `MCP_ALLOWED_HOSTS` | *(empty)* | Comma-separated allowed `Host` header values (DNS rebinding protection) |
| `ADO_API_VERSION` | `7.0` | ADO REST API version (TFS 2018 → `4.1`) |
| `NODE_EXTRA_CA_CERTS` | *(unset)* | Path to corporate CA PEM inside container |
| `LOG_LEVEL` | `info` | Log verbosity |
| `ADO_PAGE_SIZE_DEFAULT` | `50` | Default items per page for cursor-paginated review tools |
| `ADO_PAGE_SIZE_MAX` | `200` | Maximum items per page (ADO batch ceiling) |
| `ADO_SCOPE_CACHE_TTL_MS` | `600000` | Cursor lifetime in milliseconds (10 min). Expired cursors return `CURSOR_EXPIRED`. |
| `ADO_SCOPE_CACHE_MAX_ENTRIES` | `50` | Maximum concurrent scope snapshots in memory |

### Corporate CA certificates (on-prem TFS)

```bash
# Mount your corp CA into the container
HOST_CA_CERT_PATH=/etc/ssl/certs/your-corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

See `docs/onprem-ado.md` for full TLS setup.

### Distinguishing error sources

| Error | Source | Check |
|---|---|---|
| `401` from `/mcp` | MCP bearer token wrong | Verify `MCP_HTTP_BEARER_TOKEN` matches the header sent by Open WebUI |
| `401` / `403` from `ado_ping` | ADO PAT rejected | Verify `ADO_PAT` has Read access to the target collection |
| TLS error in logs | Corporate CA not trusted | Set `NODE_EXTRA_CA_CERTS` and mount the CA cert |

## Updating

```bash
docker compose pull
docker compose up -d
```

## Troubleshooting

### TLS handshake fails

```
Error: unable to verify the first certificate
```

Mount your corporate CA and set `NODE_EXTRA_CA_CERTS`. See `docs/onprem-ado.md`.

### 401 from the MCP endpoint

The `Authorization: Bearer ...` header sent by Open WebUI does not match `MCP_HTTP_BEARER_TOKEN`. Both values must match exactly (case-sensitive). Re-check the Open WebUI tool configuration.

### 401 / 403 from ADO

- Verify `ADO_PAT` has **Read** access to Work Items on the target project.
- Confirm `ADO_ORG_URL` points to the correct collection (e.g. `https://tfs.company.local/tfs/DefaultCollection`, not the server root).

### Port 3000 already in use

Set `MCP_HTTP_PORT` in `.env`:

```bash
MCP_HTTP_PORT=3001
```

---

## Legacy: mcpo Bridge

If you are still using an older Open WebUI version that does not support native MCP, the `mcpo` OpenAPI bridge is available as a legacy option.

Start with the `legacy` profile:

```bash
docker compose --profile legacy up -d
```

This starts `elisra-mcp-ado-mcpo` on port **9090** (configurable via `MCPO_PORT`). In Open WebUI, add a **Tool Server** with:
- **URL**: `http://<host>:9090`
- **API Key**: value of `MCPO_API_KEY`

The `mcpo` bridge does **not** support `server_pat` mode out of the box — each tool call requires a `pat` argument. For production, migrate to native MCP HTTP mode.
