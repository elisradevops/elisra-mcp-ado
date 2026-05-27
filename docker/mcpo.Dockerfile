# ─── mcpo HTTP bridge image ────────────────────────────────────────────────────
# Extends the MCP server image with mcpo (pip) so it can bridge stdio → HTTP
# for Open WebUI integration.
#
# mcpo: https://github.com/open-webui/mcpo
# Usage:  mcpo --port 8000 --api-key <key> -- node dist/index.js
# ──────────────────────────────────────────────────────────────────────────────
ARG MCP_IMAGE_TAG=latest
FROM elisradevops/elisra-mcp-ado:${MCP_IMAGE_TAG} AS mcpo-bridge

# Pin mcpo to avoid silent breakage from upstream changes between builds.
# Override at build time: docker build --build-arg MCPO_VERSION=x.y.z ...
ARG MCPO_VERSION=0.0.20

USER root

# python3-pip on Debian bookworm raises "externally-managed-environment" for bare pip.
# --break-system-packages is the minimal fix that avoids pulling in venv infrastructure.
# curl is needed for the HEALTHCHECK probe.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends python3 python3-pip curl && \
    pip3 install --no-cache-dir --break-system-packages "mcpo==${MCPO_VERSION}" && \
    rm -rf /var/lib/apt/lists/*

# Persist MCP server stderr so operators can diagnose child-process crashes:
#   kubectl exec <pod> -- cat /app/logs/mcp.stderr
ENV LOG_FILE=/app/logs/mcp.stderr
RUN mkdir -p /app/logs && chown mcp:mcp /app/logs

USER mcp

EXPOSE 8000

# Probe the mcpo HTTP server — catches both "mcpo never started" and
# "mcpo started but Node child failed during init".
# Shell (CMD) form is required here so ${MCPO_API_KEY} expands at container runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS -H "Authorization: Bearer ${MCPO_API_KEY:-changeme}" \
      http://127.0.0.1:8000/openapi.json || exit 1

# MCPO_API_KEY is read by mcpo from the --api-key flag (passed via shell var substitution).
# NEVER add --log-level <level> here — it routes the flag to uvicorn and breaks the
# child-process supervisor in the pinned mcpo version.
ENTRYPOINT ["sh", "-c", "mcpo --port 8000 --api-key \"${MCPO_API_KEY:-changeme}\" -- node /app/dist/index.js"]
