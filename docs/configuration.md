# Configuration Reference

All configuration is supplied via environment variables. Copy `.env.example` to `.env` and edit before starting.

---

## Environment Variables

| Env Var | Default | Required | Description |
|---|---|---|---|
| `ADO_ORG_URL` | — | **Yes** | Full collection URL, e.g. `https://tfs.example.local/tfs/DefaultCollection`. Must start with `https://`. Trailing slash is stripped automatically. |
| `ADO_API_VERSION` | `7.0` | No | REST API version sent to ADO. The client applies a fallback ladder (`7.0 → 5.1 → none`) for on-prem TFS instances that reject newer versions. |
| `ADO_BATCH_SIZE` | `200` | No | Work item IDs per batch request. Maximum is `200` (hard cap from the `workitemsbatch` endpoint). Range: 1–200. |
| `ADO_AUTH_MODE` | `per_request_pat` | No | Auth strategy. See [Auth Modes](#auth-modes) below. |
| `ADO_PAT` | — | Only with `server_pat` | Server-side PAT. Required when `ADO_AUTH_MODE=server_pat`. Must not be set in `per_request_pat` mode (a warning is logged if it is, and the value is ignored). |
| `ADO_READ_ONLY` | `true` | No | Enforced at the config layer. No write tools exist in v1. Hardcoded to `"true"` in both `docker-compose.yml` services regardless of this value. |
| `ADO_ENABLE_DEBUG_OUTPUT` | `false` | No | Enables the `ado_debug_compile_wiql` tool and adds `debugWiql` to applicable scope responses. Do not enable in production — compiled WIQL may contain field values. |
| `ADO_REQUEST_TIMEOUT_MS` | `30000` | No | Per-request HTTP timeout in milliseconds. Minimum 1000. Increase for slow on-prem TFS or large result sets. |
| `ADO_ALLOW_UNKNOWN_FIELDS` | `false` | No | When `false`, the WIQL compiler rejects field references absent from the field discovery cache. Set to `true` to pass unknown refs through unvalidated (a warning is added to the response). |
| `ADO_FULL_RESPONSE_MAX_ITEMS` | `50` | No | Hard cap on items returned in full-response mode. Prevents oversized payloads from overwhelming the LLM context window. |
| `NODE_EXTRA_CA_CERTS` | — | On-prem TLS only | Absolute path inside the container to a PEM-encoded corporate CA bundle. Required when TFS uses a self-signed or internal CA. There is no `rejectUnauthorized: false` fallback — TLS errors are fatal. |
| `LOG_LEVEL` | `info` | No | Pino log level. Options: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Use `debug` or `trace` for local development only. |
| `MCPO_API_KEY` | — | mcpo only | Bearer token protecting the mcpo HTTP bridge endpoint. Passed as `Authorization: Bearer <key>` in requests to the bridge. |
| `MCPO_PORT` | `9090` | No | Host port the mcpo sidecar binds to. Maps to container port 8000. |

---

## Auth Modes

### `per_request_pat` (default)

Each MCP tool call supplies a `pat` argument. No credential is stored server-side. Suitable for multi-user deployments where different callers have different ADO permissions.

```json
{ "pat": "USER_PAT_HERE", "id": 12345 }
```

Do not set `ADO_PAT` in this mode — if set it is ignored with a warning.

### `server_pat`

A single PAT set in `ADO_PAT` is used for every request. All tool calls run under that identity. Suitable for single-user local setups or CI service accounts.

`ADO_PAT` is **required** when this mode is active. The server fails at startup if it is missing.

```dotenv
ADO_AUTH_MODE=server_pat
ADO_PAT=your-personal-access-token
```

### `trusted_header_future` (reserved)

Placeholder for a planned reverse-proxy header injection flow. Not implemented in v1 — the server throws a clear error if this mode is selected.

---

## TLS — Corporate CA Certificate (on-prem TFS)

If your Azure DevOps Server uses a self-signed or internal corporate CA:

**1. Export the CA certificate as PEM:**

```bash
# Linux/macOS — if you have the cert as .cer:
openssl x509 -inform DER -in corp-ca.cer -out corp-ca.pem

# Windows (PowerShell):
certutil -exportcert -encode <thumbprint> corp-ca.pem
```

**2. Set in `.env`:**

```dotenv
HOST_CA_CERT_PATH=./certs/corp-ca.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
```

`HOST_CA_CERT_PATH` is a Docker Compose helper that bind-mounts the host file into the container at the path specified by `NODE_EXTRA_CA_CERTS`. It is not processed by the application itself.

Node.js reads `NODE_EXTRA_CA_CERTS` at startup and appends the cert to its built-in CA store. No image rebuild is required.

There is no `rejectUnauthorized: false` fallback. A TLS handshake failure is a hard startup error with a clear message pointing to this setting.

---

## Response Size Tuning

The full-mode guard (`ADO_FULL_RESPONSE_MAX_ITEMS`) prevents large work item payloads from filling the LLM context window. The default of 50 is conservative. Raise it if your typical review scopes are larger and your context window can accommodate the output.

For bulk analysis, use `responseMode: "overview"` first to get risk counts and `sampleHighRiskIds`, then drill into specific items with context packets rather than requesting full payloads.
