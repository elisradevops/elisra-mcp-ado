# ─── mcpo HTTP bridge image ────────────────────────────────────────────────────
# Extends the MCP server image with mcpo (pip) so it can bridge stdio → HTTP
# for Open WebUI integration.
#
# mcpo: https://github.com/open-webui/mcpo
# Usage:  mcpo --port 8000 --api-key <key> -- node dist/index.js
# ──────────────────────────────────────────────────────────────────────────────
FROM elisradevops/elisra-mcp-ado:latest AS mcpo-bridge

USER root

# python3-pip on Debian bookworm raises "externally-managed-environment" for bare pip.
# --break-system-packages is the minimal fix that avoids pulling in venv infrastructure.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    pip3 install --no-cache-dir --break-system-packages mcpo && \
    rm -rf /var/lib/apt/lists/*

USER mcp

EXPOSE 8000

# MCPO_API_KEY is read by mcpo from the --api-key flag (passed via shell var substitution)
ENTRYPOINT ["sh", "-c", "mcpo --port 8000 --api-key \"${MCPO_API_KEY:-changeme}\" --log-level warning -- node /app/dist/index.js"]
