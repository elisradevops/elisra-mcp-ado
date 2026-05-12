# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Verify the build succeeded
RUN test -f dist/index.js || (echo "Build failed: dist/index.js not found" && exit 1)

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# CA certificates support — NODE_EXTRA_CA_CERTS must point to a mounted file.
# This layer installs the OS ca-certificates package so update-ca-certificates works,
# but we do NOT bundle any corporate CA into the image.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r mcp && \
    useradd -r -g mcp -d /app -s /sbin/nologin -c "MCP server user" mcp

WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=build /build/dist ./dist

# Ownership
RUN chown -R mcp:mcp /app

USER mcp

# MCP servers communicate over stdio — no port to expose.
# For HTTP-based inspection, run mcpo as a sidecar (see docker-compose.yml).

# Health check: config loads cleanly → exit 0
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=2 \
  CMD node dist/health.js

ENTRYPOINT ["node", "dist/index.js"]
