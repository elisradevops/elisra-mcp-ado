# Docker Reference

This document covers how `elisra-mcp-ado` is packaged, configured, and run in Docker.

---

## Images

Two images are provided:

| Image | Purpose |
|---|---|
| `elisradevops/elisra-mcp-ado` | MCP server (stdio transport) |
| `elisradevops/elisra-mcp-ado-mcpo` | mcpo HTTP bridge for Open WebUI |

Both are built from the same source tree. Multi-arch manifests (`linux/amd64`, `linux/arm64`) are published to DockerHub.

---

## Dockerfile (`docker/Dockerfile`)

The main image uses a two-stage build.

### Stage 1 — build

```dockerfile
FROM node:22-slim AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN test -f dist/index.js || (echo "Build failed: dist/index.js not found" && exit 1)
```

- Base: `node:22-slim`
- Installs all dependencies (dev + prod) with `npm ci`
- Compiles TypeScript to `dist/` via `npm run build`
- Guard step: aborts the build if `dist/index.js` is missing

### Stage 2 — runtime

```dockerfile
FROM node:22-slim AS runtime
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN groupadd -r mcp && \
    useradd -r -g mcp -d /app -s /sbin/nologin -c "MCP server user" mcp
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
RUN chown -R mcp:mcp /app
USER mcp
```

Key characteristics:

- **Non-root user**: `mcp:mcp`, home `/app`, no login shell
- **Production deps only**: `npm ci --omit=dev`
- **CA certificates**: `ca-certificates` OS package is installed so `update-ca-certificates` works at runtime. No corporate CA is bundled — see [CA cert mounting](#ca-cert-mounting) below.
- **No exposed port**: MCP servers communicate over stdio. Use the mcpo sidecar for HTTP access.

### Health check

```dockerfile
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=2 \
  CMD node dist/health.js
```

`dist/health.js` is a minimal config-load probe (`src/health.ts`):

```ts
import { loadConfig } from './config/env.js';
try {
  loadConfig();
  process.exit(0);
} catch {
  process.exit(1);
}
```

It calls `loadConfig()` which validates all required environment variables via Zod. Exit `0` means the container is healthy; exit `1` means config is broken.

---

## mcpo.Dockerfile (`docker/mcpo.Dockerfile`)

Extends the runtime image to add the [mcpo](https://github.com/open-webui/mcpo) HTTP bridge:

```dockerfile
FROM elisradevops/elisra-mcp-ado:latest AS mcpo-bridge

ARG MCPO_VERSION=0.0.20

USER root
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends python3 python3-pip curl && \
    pip3 install --no-cache-dir --break-system-packages "mcpo==${MCPO_VERSION}" && \
    rm -rf /var/lib/apt/lists/*

ENV LOG_FILE=/app/logs/mcp.stderr
RUN mkdir -p /app/logs && chown mcp:mcp /app/logs

USER mcp
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS -H "Authorization: Bearer ${MCPO_API_KEY:-changeme}" \
      http://127.0.0.1:8000/openapi.json || exit 1

ENTRYPOINT ["sh", "-c", "mcpo --port 8000 --api-key \"${MCPO_API_KEY:-changeme}\" -- node /app/dist/index.js"]
```

- Adds `python3` + `pip3` + `curl` on top of the runtime image
- **Pins mcpo** to `MCPO_VERSION` (default `0.0.20`). Override at build time:
  ```bash
  docker build --build-arg MCPO_VERSION=0.0.21 -f docker/mcpo.Dockerfile .
  ```
- Installs `mcpo` with `--break-system-packages` (required on Debian bookworm; avoids venv overhead)
- Sets `LOG_FILE=/app/logs/mcp.stderr` so the MCP server's Node process writes a persistent log file. Read after a crash:
  ```bash
  kubectl exec <pod> -- cat /app/logs/mcp.stderr
  # or locally:
  docker exec elisra-mcp-ado-mcpo cat /app/logs/mcp.stderr
  ```
- `HEALTHCHECK` probes `GET /openapi.json` on the mcpo HTTP port every 30 seconds. The container transitions to `unhealthy` if the probe fails 3 times in a row — this catches cases where the Node child process exits but the container itself stays up.
- Drops back to `USER mcp` after installation
- Exposes port `8000` internally; mapped to `MCPO_PORT` (default `9090`) on the host
- `MCPO_API_KEY` is passed to mcpo's `--api-key` flag at startup

> **Warning**: Never add `--log-level <level>` to the mcpo ENTRYPOINT. In the pinned mcpo version the flag is forwarded to uvicorn and crashes the child-process supervisor, producing `McpError: Connection closed` at startup with no useful error message. See `docs/troubleshooting.md` for diagnosis steps.

---

## docker-compose.yml

Two services are defined:

```yaml
services:
  elisra-mcp-ado:          # MCP server (stdio)
  elisra-mcp-ado-mcpo:     # mcpo HTTP bridge
```

### Environment variables

Both services share the same set of ADO variables. The mcpo service adds `MCPO_API_KEY`.

| Variable | Default | Description |
|---|---|---|
| `ADO_ORG_URL` | **required** | Full TFS/ADO collection URL, e.g. `https://tfs.corp.local/tfs/DefaultCollection` |
| `ADO_API_VERSION` | `7.0` | API version; the server tries a ladder `7.0 → 5.1 → none` for on-prem TFS |
| `ADO_BATCH_SIZE` | `200` | Max items per ADO batch request (1–200) |
| `ADO_AUTH_MODE` | `per_request_pat` | `per_request_pat` (each call supplies its own PAT) or `server_pat` (single PAT in `ADO_PAT`) |
| `ADO_PAT` | — | Required only when `ADO_AUTH_MODE=server_pat` |
| `ADO_READ_ONLY` | `true` | Hard-coded to `true` in compose; prevents write operations |
| `ADO_ENABLE_DEBUG_OUTPUT` | `false` | Emit verbose ADO request/response logs |
| `ADO_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds |
| `ADO_ALLOW_UNKNOWN_FIELDS` | `false` | If `false`, WIQL compiler rejects fields not in the discovery cache |
| `ADO_PAGE_SIZE_DEFAULT` | `50` | Default items per page for cursor-paginated review tools |
| `ADO_PAGE_SIZE_MAX` | `200` | Maximum items per page (ADO batch ceiling) |
| `ADO_SCOPE_CACHE_TTL_MS` | `600000` | Cursor lifetime in ms (10 min); expired cursors return `CURSOR_EXPIRED` |
| `ADO_SCOPE_CACHE_MAX_ENTRIES` | `50` | Maximum concurrent scope snapshots in memory |
| `LOG_LEVEL` | `info` | Pino log level: `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `NODE_EXTRA_CA_CERTS` | — | Path **inside the container** to the corporate CA cert file |
| `MCPO_API_KEY` | `changeme` | mcpo service only — bearer token for HTTP access |
| `MCPO_PORT` | `9090` | mcpo service only — host port mapped to container port 8000 |

### CA cert volume mount

```yaml
volumes:
  - ${HOST_CA_CERT_PATH:-/dev/null}:${NODE_EXTRA_CA_CERTS:-/etc/ssl/certs/elisra-ca.pem}:ro
```

- `HOST_CA_CERT_PATH`: path to the CA cert on the Docker host
- `NODE_EXTRA_CA_CERTS`: path inside the container (must match the env var Node reads)
- If `HOST_CA_CERT_PATH` is unset, `/dev/null` is mounted — Node ignores an empty file

To enable, copy your CA cert and set both variables in `.env`:

```bash
mkdir -p ./certs
cp /path/to/corp-ca.pem ./certs/elisra-ca.pem

# .env
HOST_CA_CERT_PATH=./certs/elisra-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

---

## Quick Start

```bash
cp .env.example .env
# Edit .env — set ADO_ORG_URL, auth mode, and optionally CA cert paths
docker compose up -d
```

To follow logs:

```bash
docker compose logs -f elisra-mcp-ado
docker compose logs -f elisra-mcp-ado-mcpo
```

---

## Build from Source

```bash
docker build -t elisradevops/elisra-mcp-ado:dev -f docker/Dockerfile .
```

To also build the mcpo bridge from your local dev image:

```bash
# Build runtime first (required as the mcpo base)
docker build -t elisradevops/elisra-mcp-ado:latest -f docker/Dockerfile .
# Then build mcpo on top
docker build -t elisradevops/elisra-mcp-ado-mcpo:dev -f docker/mcpo.Dockerfile .
```

---

## Production: Pull from DockerHub

```bash
docker pull elisradevops/elisra-mcp-ado:latest
docker pull elisradevops/elisra-mcp-ado-mcpo:latest
```

Multi-arch manifests cover `linux/amd64` and `linux/arm64`. Docker will pull the correct variant automatically.

---

## Security Notes

- The container runs as `mcp` (non-root UID/GID). No capabilities are added.
- No corporate CA cert is baked into the image — certs are mount-only at runtime.
- `ADO_READ_ONLY=true` is hardcoded in `docker-compose.yml` and cannot be overridden by `.env`.
- `ADO_PAT` should be kept in a `.env` file that is not committed to version control (`.env` is in `.gitignore`).
