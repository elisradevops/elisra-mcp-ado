# elisra-mcp-ado

Azure DevOps Server / TFS MCP server — read-only, scope-first, field-generic.

Exposes work-item query and requirement-review tools over the Model Context Protocol (MCP), usable from Claude, Open WebUI, or any MCP-compatible client.

## Phase 1 status

Scaffold complete. Available tools: `ado_ping`, `ado_check_pat`.
Review, scope, and field tools land in Phases 3–9.

## Quick start

```bash
cp .env.example .env
# Edit .env — set ADO_ORG_URL, ADO_AUTH_MODE, NODE_EXTRA_CA_CERTS
npm install
npm run build
node dist/index.js
```

With mcpo bridge for Open WebUI:

```bash
docker compose up -d
# Add http://localhost:9090 as a tool server in Open WebUI → Settings → Tools
```

## Authentication

| Mode | How to use |
|---|---|
| `per_request_pat` (default) | Each tool call passes `auth.pat` — no PAT stored server-side |
| `server_pat` | Set `ADO_PAT` env — useful for service-account POC |

See `docs/pat-auth.md` for security guidance.

## TLS (on-prem)

If your Azure DevOps Server uses a self-signed or corporate CA certificate:

```bash
NODE_EXTRA_CA_CERTS=/path/to/ca.pem node dist/index.js
```

**There is no `rejectUnauthorized:false` escape hatch.** The server fails loudly with a clear error if the TLS handshake fails. See `docs/onprem-ado.md`.

## Configuration

See `.env.example` for all variables. Key ones:

| Variable | Default | Description |
|---|---|---|
| `ADO_ORG_URL` | required | e.g. `https://tfs.example.local/tfs/DefaultCollection` |
| `ADO_AUTH_MODE` | `per_request_pat` | Auth model |
| `ADO_API_VERSION` | `7.0` | Falls back to 5.1 → none on older TFS |
| `NODE_EXTRA_CA_CERTS` | — | Path to corp CA bundle |

## Development

```bash
npm run dev       # tsx watch mode
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Architecture

See `docs/` and the implementation plan at `.claude/plans/`.

Layer rules (strict):
- `mcp/tools/*` — thin: Zod schema validation + service call + response format
- `services/*` — workflows, reusable outside MCP
- `ado/*` — REST primitives, batching (200-id cap), retry, CA-only TLS
- `domain/*` — pure types and pure functions, no I/O
- `utils/*` — generic helpers, no ADO or MCP knowledge
