# Troubleshooting

Common failure modes, their causes, and how to fix them.

---

## 1. TLS handshake fails / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Symptom**: Requests to your on-prem TFS fail with a Node.js TLS error such as:

```
Error: unable to verify the first certificate
  code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
```

**Cause**: Your TFS uses a certificate signed by a corporate or self-signed CA that Node.js does not trust by default.

**Fix**:

1. Export your corporate CA cert in PEM format.
2. Place it on the Docker host and set both variables in `.env`:

   ```env
   HOST_CA_CERT_PATH=./certs/elisra-ca.pem
   NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem
   ```

3. Recreate the container so the volume mount and env var take effect:

   ```bash
   docker compose down && docker compose up -d
   ```

The CA cert is mounted read-only into the container at the path `NODE_EXTRA_CA_CERTS` points to. Node.js reads this file at startup and adds the cert to its trust store.

---

## 2. 401 from ADO — authentication rejected

**Symptom**: ADO returns HTTP 401.

**Cause (a) — Bad PAT**: The Personal Access Token is malformed, expired, or was revoked.

**Fix**: Generate a new PAT in Azure DevOps → User Settings → Personal Access Tokens. Ensure it is not expired.

**Cause (b) — Wrong collection URL**: `ADO_ORG_URL` points to the wrong server or collection path.

**Fix**: Verify the URL matches the full collection path, e.g.:

```env
ADO_ORG_URL=https://tfs.corp.local/tfs/DefaultCollection
```

**Cause (c) — Insufficient PAT scope**: The PAT was created with scopes that do not include Work Items (Read) or the required resource area.

**Fix**: Recreate the PAT with at minimum:
- Work Items: Read
- Project and Team: Read
- Analytics: Read (if using analytics queries)

---

## 3. 403 from ADO — authorized but access denied

**Symptom**: ADO returns HTTP 403.

**Cause**: The PAT is valid and authenticates successfully, but the identity does not have permission to read the target project or resource. This is an ADO project-level permission issue, not a PAT issue.

**Fix**:

- Confirm the ADO user associated with the PAT has at least **Reader** access to the target project.
- Ask your ADO/TFS administrator to grant project access.
- If using `server_pat` mode, confirm the service account has the necessary permissions.

---

## 4. "Work item N not found"

**Symptom**: A tool call referencing a specific work item ID returns a not-found error.

**Cause**:

- The work item was deleted or moved to the recycle bin.
- The work item exists in a different collection — `ADO_ORG_URL` points to the wrong collection.
- The PAT does not have read access to the project that owns the work item.

**Fix**:

1. Verify the work item ID exists in your ADO/TFS instance directly via the web UI.
2. Confirm `ADO_ORG_URL` matches the collection that contains the item.
3. Confirm the PAT has Work Items: Read access for the owning project.

---

## 5. `PROJECT_REQUIRED` error

**Symptom**: A tool call fails with a `PROJECT_REQUIRED` error or similar validation message.

**Cause**: Certain tool inputs — such as `fieldFilters` or WIQL-based sources — require a `project` field to scope the query. The field was omitted.

**Fix**: Include the `project` parameter in the tool call. Example:

```json
{
  "project": "MyProject",
  "wiql": "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProject'"
}
```

---

## 6. `ado_discover_fields` returns seed catalog only

**Symptom**: `ado_discover_fields` returns only the built-in `knownInDocGen` fields and does not include your project's custom fields.

**Cause**: The server cannot reach ADO to perform live field discovery. This happens when:

- `ADO_ORG_URL` is unreachable from inside the container (network/DNS issue).
- The PAT lacks metadata access (`vso.work_read` scope or equivalent).
- The ADO API version used does not support the fields endpoint for your TFS version.

**Fix**:

1. Confirm the container can reach `ADO_ORG_URL`:
   ```bash
   docker exec elisra-mcp-ado node -e "fetch('$ADO_ORG_URL/_apis/wit/fields').then(r=>console.log(r.status))"
   ```
2. Verify the PAT has Work Items: Read scope.
3. If on a very old TFS version, try lowering `ADO_API_VERSION` (e.g., `5.1`).

---

## 7. WIQL compiler rejects a field

**Symptom**: A WIQL query fails with an error indicating the field is unknown or not permitted.

**Cause**: `ADO_ALLOW_UNKNOWN_FIELDS=false` (the default). The WIQL compiler validates all fields against the discovery cache. If `ado_discover_fields` has not been run — or the field is genuinely non-existent — it is rejected.

**Fix (option A — recommended)**: Run `ado_discover_fields` first to populate the cache with live ADO field metadata, then retry the query.

**Fix (option B — permissive mode)**: Set `ADO_ALLOW_UNKNOWN_FIELDS=true` in `.env`. The compiler will pass unknown fields through to ADO without local validation. ADO itself will reject invalid fields.

---

## 8. WIQL `CONTAINS` on a TreePath field is rejected

**Symptom**: A WIQL query using `[System.AreaPath] CONTAINS '...'` or `[System.IterationPath] CONTAINS '...'` fails.

**Cause**: ADO does not support `CONTAINS` on TreePath fields. This is an ADO/TFS restriction, not a server bug.

**Fix**: Use `UNDER` instead:

```sql
-- Wrong
WHERE [System.AreaPath] CONTAINS 'Sprint 5'

-- Correct
WHERE [System.AreaPath] UNDER 'MyProject\Sprint 5'
```

---

## 9. Full mode rejected — too many items

**Symptom**: A tool call using full (non-sampled) response mode fails or is rejected because the result set exceeds the configured limit.

**Cause**: The query returns more items than `ADO_FULL_RESPONSE_MAX_ITEMS` (default: `50`). Full mode is intentionally capped to prevent unbounded responses.

**Fix (option A)**: Narrow the query scope — add more `WHERE` conditions to reduce the result set.

**Fix (option B)**: Use sampled/paginated mode instead of full mode.

**Fix (option C)**: Raise the limit if you have confirmed the larger response is safe:

```env
ADO_FULL_RESPONSE_MAX_ITEMS=200
```

---

## 10. mcpo returns 401

**Symptom**: HTTP requests to the mcpo bridge (`http://localhost:9090`) return 401.

**Cause**: The `Authorization: Bearer <token>` header is missing, or the token does not match `MCPO_API_KEY`.

**Fix**:

1. Check what key is set:
   ```bash
   docker inspect elisra-mcp-ado-mcpo | grep MCPO_API_KEY
   ```
2. Send requests with the correct header:
   ```
   Authorization: Bearer <your-MCPO_API_KEY>
   ```
3. If using Open WebUI, set the same key in the tool server configuration.

---

## 11. Container exits immediately after start

**Symptom**: `docker compose up` starts the container but it exits within seconds. `docker ps` shows it as `Exited`.

**Cause**: Configuration validation failed. `loadConfig()` runs at startup and throws if required variables are missing or invalid. Common triggers:

- `ADO_ORG_URL` is not set or is not a valid HTTPS URL.
- `ADO_AUTH_MODE=server_pat` is set but `ADO_PAT` is not provided.

**Fix**:

1. Check the logs:
   ```bash
   docker logs elisra-mcp-ado
   ```
   The error message lists every failing validation with the variable name and reason.

2. Fix the reported variables in `.env` and restart:
   ```bash
   docker compose down && docker compose up -d
   ```

---

## 12. High latency on large batches

**Symptom**: Tool calls that fetch many work items are slow, or requests time out.

**Cause (a) — Batch size too large**: `ADO_BATCH_SIZE=200` sends large requests; on-prem TFS may be slow under load.

**Fix**: Lower the batch size to reduce per-request payload:

```env
ADO_BATCH_SIZE=50
```

**Cause (b) — TFS server load**: The on-prem TFS/Azure DevOps Server instance is under heavy CPU or I/O load.

**Fix**: Check TFS server health via the TFS admin console or Windows Performance Monitor. Consider running queries during off-peak hours, or ask your TFS administrator to investigate server-side bottlenecks.

**Cause (c) — Request timeout too short**: `ADO_REQUEST_TIMEOUT_MS` fires before the server responds.

**Fix**: Increase the timeout:

```env
ADO_REQUEST_TIMEOUT_MS=60000
```

---

## 13. mcpo bridge crashes with `McpError: Connection closed`

**Symptom**: The `elisra-mcp-ado-mcpo` container enters `CrashLoopBackOff` (k8s) or exits immediately (Docker). Logs from the mcpo container show:

```
McpError: Connection closed
```

The MCP server's own startup log may be missing or incomplete because mcpo discards the Node child's stderr in some failure modes.

**Diagnosis**:

1. Read the persisted Node stderr log from inside the container:
   ```bash
   kubectl exec <pod-name> -- cat /app/logs/mcp.stderr
   # or locally:
   docker exec elisra-mcp-ado-mcpo cat /app/logs/mcp.stderr
   ```
   This file is written by the Node process (via the `LOG_FILE` env) and survives container restarts in the same container lifecycle.

2. Check the HEALTHCHECK status:
   ```bash
   docker inspect --format='{{.State.Health.Status}}' elisra-mcp-ado-mcpo
   ```
   `unhealthy` after startup confirms the Node child failed during init even though the container is still running.

3. Confirm the `MCPO_VERSION` build arg matches the pinned version:
   ```bash
   docker inspect elisradevops/elisra-mcp-ado-mcpo:latest | grep -A1 MCPO_VERSION
   ```
   An unpinned (`pip install mcpo` without a version) or downgraded version may behave differently.

4. Confirm the ENTRYPOINT has no extra flags after `--api-key`:
   ```bash
   docker inspect --format='{{json .Config.Entrypoint}}' elisradevops/elisra-mcp-ado-mcpo:latest
   ```
   The expected output is:
   ```json
   ["sh","-c","mcpo --port 8000 --api-key \"${MCPO_API_KEY:-changeme}\" -- node /app/dist/index.js"]
   ```
   **If `--log-level <level>` appears before `--`**, remove it and rebuild. That flag is forwarded to uvicorn and crashes the child-process supervisor in the pinned mcpo version.

**Known causes**:

| Cause | Indicator | Fix |
|---|---|---|
| `--log-level` flag in ENTRYPOINT | Crash immediately after init, no Node log | Remove flag, rebuild image |
| `ADO_ORG_URL` missing or invalid | `Configuration validation failed` in `/app/logs/mcp.stderr` | Set a valid HTTPS URL in env |
| `ADO_AUTH_MODE=server_pat` without `ADO_PAT` | `ADO_PAT is required` in stderr | Set `ADO_PAT` or switch to `per_request_pat` |
| Wrong mcpo version | Crash after upgrade with no code change | Pin `MCPO_VERSION` and rebuild |
| Schema compat failure | `AssertionError: Custom field not found` in mcpo logs | Ensure image is built from current source (schemaCompat recursive walk fix is in ≥0.5.2) |
