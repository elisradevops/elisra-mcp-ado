# Open WebUI Integration

`elisra-mcp-ado` exposes a stdio MCP transport. Open WebUI requires an HTTP endpoint, so a `mcpo` sidecar bridges the gap.

## Quick Start

### 1. Prepare environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required fields:

```bash
ADO_ORG_URL=https://tfs.your-company.local/tfs/DefaultCollection
MCPO_API_KEY=choose-a-strong-random-key
```

If your TFS uses a corporate CA certificate:

```bash
# Path to your corp CA PEM on the host
HOST_CA_CERT_PATH=/etc/ssl/certs/your-corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

### 2. Start the stack

```bash
docker compose up -d
```

Two containers start:
- `elisra-mcp-ado` — MCP server (stdio, no exposed port)
- `elisra-mcp-ado-mcpo` — HTTP bridge on port **9090**

Verify the bridge is up:

```bash
curl -s -H "Authorization: Bearer $MCPO_API_KEY" http://localhost:9090/openapi.json | jq '.info'
```

### 3. Add to Open WebUI

1. Open Open WebUI → **Settings → Tools**
2. Click **Add Tool Server**
3. Fill in:
   - **URL**: `http://localhost:9090` (or replace with your host/IP)
   - **API Key**: the value you set in `MCPO_API_KEY`
4. Click **Save**

Open WebUI will discover all MCP tools automatically from the `/openapi.json` endpoint.

### 4. Grant tool access to a model

1. Open a chat with any model
2. Enable **Tools** in the model settings or via the chat toolbar
3. The `elisra-mcp-ado` tools appear in the tool list (prefixed with their names, e.g. `ado_ping`)

## Authentication

### Per-request PAT (default, recommended)

With `ADO_AUTH_MODE=per_request_pat` (the default), each tool call accepts an optional `pat` argument.

In Open WebUI, pass the PAT as a tool argument when invoking a tool:

```
Use ado_ping with pat=<your-pat>
```

For production, prefer configuring a connection-level secret (see below) so the PAT is not visible in the chat transcript.

### Server PAT (service account / automated use)

For automation, switch to server-side PAT:

```bash
# .env
ADO_AUTH_MODE=server_pat
ADO_PAT=your-service-account-pat
```

The PAT is loaded from the environment at startup. Tool calls do not need a `pat` argument.

**Security:** Never set `ADO_PAT` in `per_request_pat` mode — the server will warn and ignore it.

### Open WebUI connection-level secret (recommended for production)

Instead of passing a PAT in chat, configure the PAT as an Open WebUI connection-level secret:
1. **Settings → Connections → Tool Servers** → edit the `elisra-mcp-ado` entry
2. Under **Headers**, add: `X-Forwarded-Pat: <your-pat>`
3. On the server side, switch to `trusted_header_future` mode (not yet implemented in v1)

Until v1 adds trusted-header support, use `server_pat` mode for production.

## Verifying the Integration

### ado_ping

```
Call ado_ping (with pat=<your-pat> if using per_request_pat mode)
```

Expected response:
```json
{
  "collection": "https://tfs.your-company.local/tfs/DefaultCollection",
  "projects": ["ProjectA", "ProjectB", "..."],
  "apiVersion": "7.0"
}
```

### ado_discover_fields

```
Call ado_discover_fields with project="YourProject"
```

Returns the field catalog. Confirms ADO connectivity and field metadata access.

## Logs

```bash
# MCP server logs
docker logs -f elisra-mcp-ado

# mcpo bridge logs
docker logs -f elisra-mcp-ado-mcpo
```

PATs and Authorization headers are redacted in all log output.

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

Mount your corporate CA and set `NODE_EXTRA_CA_CERTS`:

```bash
# .env
HOST_CA_CERT_PATH=/path/to/your-corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

The server fails loud on TLS errors — there is no `rejectUnauthorized:false` fallback by design.

### 401 / 403 from ADO

- Verify the PAT has **Read** access to Work Items on the target project.
- Confirm `ADO_ORG_URL` points to the correct collection (e.g. `https://tfs.company.local/tfs/DefaultCollection`, not just the server root).

### mcpo returns 401

Confirm the `Authorization: Bearer <key>` header matches `MCPO_API_KEY` exactly (case-sensitive).

### Port 9090 already in use

Change the host port in `docker-compose.yml` or set `MCPO_PORT`:

```yaml
ports:
  - "${MCPO_PORT:-9090}:8000"
```
