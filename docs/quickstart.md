# Quick Start

Get `elisra-mcp-ado` running in five steps.

## Prerequisites

- **Docker + Docker Compose** (recommended path)
- A Personal Access Token (PAT) for your Azure DevOps Server / TFS instance with **Work Items → Read** and **Project and Team → Read** scopes

---

## Steps

### 1. Clone and install

```bash
git clone https://github.com/elisradevops/elisra-mcp-ado.git
cd elisra-mcp-ado
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

### 3. Set required variables

Open `.env` and set at minimum:

```dotenv
ADO_ORG_URL=https://tfs.yourcompany.local/tfs/DefaultCollection
MCPO_API_KEY=your-secret-key
```

For on-prem TFS with a corporate CA certificate, also set:

```dotenv
HOST_CA_CERT_PATH=/path/to/your-corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

See [configuration.md](configuration.md) for the full variable reference.

### 4. Start the services

```bash
docker compose up -d
```

Two containers start:

| Container | Role |
|---|---|
| `elisra-mcp-ado` | MCP server (stdio transport, no exposed port) |
| `elisra-mcp-ado-mcpo` | HTTP bridge for Open WebUI (port 9090 by default) |

### 5. Verify connectivity

Confirm the bridge is running:

```bash
curl -s -H "Authorization: Bearer your-secret-key" \
  http://localhost:9090/openapi.json | jq '.info'
```

Then call `ado_ping` with your PAT:

```bash
curl -s -X POST http://localhost:9090/ado_ping \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"pat": "YOUR_ADO_PAT"}'
```

A successful response returns the collection URL, available projects, and the negotiated API version.

---

## Connect to Open WebUI

1. Open WebUI → **Settings → Tools → Add Tool Server**
2. URL: `http://localhost:9090`
3. API Key: the value you set in `MCPO_API_KEY`
4. Save — all tools are discovered automatically from `/openapi.json`

See [openwebui.md](openwebui.md) for a full walkthrough.

---

## Connect to Claude Desktop or another MCP client

Point the client at the stdio transport directly (no mcpo needed):

```json
{
  "command": "node",
  "args": ["/path/to/elisra-mcp-ado/dist/index.js"],
  "env": {
    "ADO_ORG_URL": "https://tfs.yourcompany.local/tfs/DefaultCollection",
    "ADO_AUTH_MODE": "per_request_pat"
  }
}
```

---

## Next Steps

- [configuration.md](configuration.md) — full env var reference
- [pat-auth.md](pat-auth.md) — PAT creation, auth modes, redaction guarantees
- [requirement-review.md](requirement-review.md) — 7-attribute quality model
- [context-aware-review.md](context-aware-review.md) — context packets and gap analysis
- [troubleshooting.md](troubleshooting.md) — common errors and fixes
