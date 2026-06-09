# elisra-mcp-ado

Azure DevOps Server / TFS MCP server — read-only, scope-first, field-generic.

Exposes work-item query and requirement-review tools over the Model Context Protocol (MCP), usable from Claude, Open WebUI, or any MCP-compatible client.

## Security posture (P0 + P1)

### Write tools
**Write operations are not supported in this release.** All tools are read-only. `ADO_READ_ONLY=true` is the default and is enforced at runtime in `AdoClient` — mutating HTTP methods (POST, PUT, PATCH, DELETE) are blocked before any outbound request is made, regardless of which tools are registered.

### Authentication modes

| Mode | Production-safe | Use case |
|---|---|---|
| `server_pat` | **Yes** | Shared service account, single PAT in env |
| `trusted_user_header` | **Yes** | Per-user encrypted PAT from MongoDB (P1) |
| `per_request_pat` | **No** | Dev/local only — requires `ADO_ALLOW_PAT_IN_TOOL_ARGS=true` |

**`per_request_pat` is NOT production-safe.** The PAT travels as a plain tool-call argument through MCP protocol JSON, the LLM's context window, proxy access logs, and conversation history. This mode requires `ADO_ALLOW_PAT_IN_TOOL_ARGS=true` and will not start without it. Never set this flag in production, staging, or shared environments.

### MCPO API key (legacy bridge)
`MCPO_API_KEY` is required when running the legacy `mcpo` profile. It must be a securely generated token of at least 16 characters. Placeholder values (`changeme`, `password`, etc.) and short keys are rejected at startup.

---

## P1: Per-user encrypted PAT store

### Design overview

1. A trusted upstream layer (Open WebUI backend, reverse proxy) authenticates the app user and injects their stable user ID into the `x-forwarded-user` HTTP header (configurable).
2. The HTTP transport layer extracts and validates this identity before the MCP session starts.
3. The server looks up the user's encrypted ADO PAT in MongoDB (`ado_user_credentials` collection).
4. The PAT is decrypted in memory using AES-256-GCM and placed into `AsyncLocalStorage` — it never reaches tool arguments, logs, or LLM context.
5. Tool handlers call `resolveAuthContext()` which reads the pre-resolved `AuthContext` from the async context — zero database round-trips per tool call.
6. PAT lifecycle (connect/test/rotate/disconnect) is handled through HTTP endpoints at `/ado/connection/*` — these are not exposed as MCP tools and never reach the LLM.

### dg-api-gate reference
The MongoDB connection layer follows the pattern from `dg-api-gate`:
- Same `MONGODB_URI` env var name (operational consistency with the existing platform)
- Same `connectToDatabase()` → bootstrap call → singleton pattern
- Same startup logging: `'Connected to MongoDB successfully'` / error handling on connect

**Deviation:** We use the native `mongodb` driver instead of Mongoose because:
- The MCP server is ES module–only with minimal dependencies
- Precise async lifecycle control (graceful shutdown, startup failure modes)
- No Mongoose schema overhead for a security-sensitive credential store
- No Mongoose v5/v6 deprecation warnings about connection options

Reference files inspected: `dg-api-gate/src/util/mongodb.ts`, `dg-api-gate/src/controllers/DatabaseController.ts`, `dg-api-gate/src/test/util/mongodb.test.ts`.

### Encryption design
- Algorithm: AES-256-GCM (authenticated encryption)
- Per-PAT random 96-bit IV (NIST SP 800-38D recommended)
- 128-bit auth tag — decryption fails on any ciphertext or tag modification
- Stored envelope: `{ ciphertext, iv, authTag, keyId, algorithm }`
- Key rotation: increment `PAT_ENCRYPTION_KEY_ID`; old records retain keyId for decryption until re-encrypted on next update
- Master key: `PAT_ENCRYPTION_KEY_B64` — must come from a Kubernetes Secret, never hardcoded

### MongoDB schema: `ado_user_credentials`

```typescript
{
  appUserId: string;                    // stable user ID from trusted header
  adoCollectionKey: string;             // ADO collection URL (from ADO_ORG_URL)
  adoIdentityDisplayName?: string;      // sanitized ADO identity metadata
  adoIdentityUniqueName?: string;
  encryptedPat: {
    ciphertext: string;                 // hex-encoded AES-256-GCM ciphertext
    iv: string;                         // hex-encoded 96-bit IV
    authTag: string;                    // hex-encoded 128-bit auth tag
    keyId: string;                      // key version for rotation
    algorithm: "aes-256-gcm";
  };
  patExpiresAt?: Date;
  status: "connected" | "invalid" | "revoked" | "expired";
  createdAt: Date;
  updatedAt: Date;
  lastValidatedAt?: Date;
  lastUsedAt?: Date;
}
```

Indexes: unique on `{ appUserId, adoCollectionKey }`, `{ status }`, `{ patExpiresAt }`.

### Trusted user identity
The `TRUSTED_USER_HEADER` (default: `x-forwarded-user`) must be injected **only** by a trusted backend layer. Browser clients must never be able to set this header directly. The implementation validates:
- Header must be present and non-empty
- Maximum 256 characters
- Printable ASCII only

### PAT lifecycle endpoints
These are HTTP endpoints at `/ado/connection/*`, protected by bearer auth + trusted user identity. They are **not** MCP tools — the LLM never sees them.

| Endpoint | Method | Purpose |
|---|---|---|
| `/ado/connection/connect` | POST | Register or update user's ADO PAT |
| `/ado/connection/status` | GET | Get sanitized credential status |
| `/ado/connection/test` | POST | Test current stored PAT against ADO |
| `/ado/connection/rotate` | POST | Replace PAT (validates new one first) |
| `/ado/connection/disconnect` | POST | Revoke stored credential |

The raw PAT is input from a secure settings form — **never from chat or tool arguments**. Results never contain the PAT.

### STDIO transport limitation
`trusted_user_header` mode requires the HTTP transport. STDIO/MCPO transport cannot carry per-request HTTP headers, so this mode fails closed if selected with stdio transport.

---

## Configuration

See `.env.example` for all variables.

| Variable | Default | Description |
|---|---|---|
| `ADO_ORG_URL` | required | e.g. `https://tfs.example.local/tfs/DefaultCollection` |
| `ADO_AUTH_MODE` | `server_pat` | Auth mode |
| `ADO_PAT` | required for `server_pat` | Service account PAT |
| `ADO_READ_ONLY` | `true` | Runtime-enforced — blocks all mutating ADO requests |
| `ADO_ALLOW_PAT_IN_TOOL_ARGS` | `false` | Must be `true` to use `per_request_pat` (dev only) |
| `MCPO_API_KEY` | — | Required for legacy mcpo profile; must be ≥16 chars |
| `ADO_API_VERSION` | `7.0` | Falls back to 5.1 → none on older TFS |
| `NODE_EXTRA_CA_CERTS` | — | Path to corp CA bundle |
| `MONGODB_URI` | — | Required for `trusted_user_header` — supply via K8s Secret |
| `MONGO_DB_NAME` | `ado_mcp` | MongoDB database name |
| `ADO_CREDENTIALS_COLLECTION` | `ado_user_credentials` | MongoDB collection name |
| `PAT_ENCRYPTION_KEY_B64` | — | Required for `trusted_user_header` — 32-byte key, base64 |
| `PAT_ENCRYPTION_KEY_ID` | `v1` | Key version label for rotation |
| `TRUSTED_USER_HEADER` | `x-forwarded-user` | Trusted identity header name |
| `TRUSTED_USER_NAME_HEADER` | — | Optional display name header (metadata only) |

---

## Quick start

```bash
cp .env.example .env
# Edit .env — set ADO_ORG_URL, ADO_AUTH_MODE, etc.
npm install
npm run build
node dist/index.js
```

## Development

```bash
npm run dev       # tsx watch mode
npm test          # vitest (697 tests)
npm run typecheck # tsc --noEmit
```

## Architecture

Layer rules (strict):
- `mcp/tools/*` — thin: Zod schema validation + service call + response format
- `services/*` — workflows, reusable outside MCP
- `ado/*` — REST primitives, batching (200-id cap), retry, CA-only TLS
- `credentials/*` — per-user PAT store: repository + resolver
- `crypto/*` — AES-256-GCM encryption abstraction
- `lifecycle/*` — PAT connect/test/rotate/disconnect (not MCP tools)
- `auth/*` — auth context resolution, trusted identity extraction
- `db/*` — MongoDB client singleton (native driver)
- `domain/*` — pure types and pure functions, no I/O
- `utils/*` — generic helpers, no ADO or MCP knowledge

## What is still missing before P2 (write tools)

1. **Per-user attribution**: Write tools need to attribute actions to the individual user. `trusted_user_header` + per-user PAT now provides this foundation.
2. **Preview → approval → execute flow**: Write tools must require explicit user confirmation before mutating any ADO state.
3. **Write audit trail**: A structured audit log for every create/update operation.
4. **Write tool implementation**: No write MCP tools exist yet. Adding them requires P2 scope.
5. **Key rotation tooling**: A management script to re-encrypt all credentials under a new key ID when rotating `PAT_ENCRYPTION_KEY_B64`.
