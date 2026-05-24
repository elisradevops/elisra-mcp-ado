# Kubernetes Deployment

Reference manifests for running `elisra-mcp-ado` in Kubernetes. These are starting points — adapt namespaces, resource limits, and image tags to your cluster.

The server runs as a native MCP Streamable HTTP endpoint on port `3000`. No `mcpo` sidecar is required.

---

## Auth Mode

HTTP mode requires `server_pat`. A single ADO PAT lives in a Kubernetes `Secret` and is injected as `ADO_PAT`. All MCP tool calls run under that identity. Users never supply or see the PAT.

| Mode | HTTP transport | Note |
|---|---|---|
| `server_pat` | **Required** | PAT in cluster Secret; all tool calls share one identity |
| `per_request_pat` | Not supported | stdio/local dev only |

---

## Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mcp
```

---

## ConfigMap — non-secret configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: elisra-mcp-ado-config
  namespace: mcp
data:
  ADO_ORG_URL: "https://tfs.corp.local/tfs/DefaultCollection"
  ADO_API_VERSION: "7.0"
  ADO_BATCH_SIZE: "200"
  ADO_AUTH_MODE: "server_pat"
  ADO_READ_ONLY: "true"
  ADO_ENABLE_DEBUG_OUTPUT: "false"
  ADO_REQUEST_TIMEOUT_MS: "30000"
  ADO_ALLOW_UNKNOWN_FIELDS: "false"
  ADO_PAGE_SIZE_DEFAULT: "50"
  ADO_PAGE_SIZE_MAX: "200"
  ADO_SCOPE_CACHE_TTL_MS: "600000"
  ADO_SCOPE_CACHE_MAX_ENTRIES: "50"
  LOG_LEVEL: "info"
  MCP_TRANSPORT: "http"
  MCP_HTTP_HOST: "0.0.0.0"
  MCP_HTTP_PORT: "3000"
  MCP_HTTP_PATH: "/mcp"
  NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/elisra-ca.pem"
```

---

## Secret — sensitive values

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: elisra-mcp-ado-secrets
  namespace: mcp
type: Opaque
stringData:
  ADO_PAT: "replace-with-your-ado-personal-access-token"
  MCP_HTTP_BEARER_TOKEN: "replace-with-a-strong-random-key"
```

`MCP_HTTP_BEARER_TOKEN` is the credential Open WebUI sends as `Authorization: Bearer ...`. Rotate it without image rebuild by updating the Secret and restarting the Pod.

---

## Corporate CA Certificate

If your ADO Server uses a self-signed or internal CA, mount the certificate as a `ConfigMap` (CA certs are public — not a secret).

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: elisra-corp-ca
  namespace: mcp
data:
  elisra-ca.pem: |
    -----BEGIN CERTIFICATE-----
    <base64-encoded CA certificate>
    -----END CERTIFICATE-----
```

The Deployment below mounts this at the path set in `NODE_EXTRA_CA_CERTS`.

If you do not have an internal CA, remove the `volumes`/`volumeMounts` entries for `corp-ca`.

---

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: elisra-mcp-ado
  namespace: mcp
  labels:
    app: elisra-mcp-ado
spec:
  replicas: 1
  selector:
    matchLabels:
      app: elisra-mcp-ado
  template:
    metadata:
      labels:
        app: elisra-mcp-ado
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: elisra-mcp-ado
          image: elisradevops/elisra-mcp-ado:latest
          imagePullPolicy: Always
          ports:
            - name: mcp-http
              containerPort: 3000
              protocol: TCP
          envFrom:
            - configMapRef:
                name: elisra-mcp-ado-config
            - secretRef:
                name: elisra-mcp-ado-secrets
          volumeMounts:
            - name: corp-ca
              mountPath: /etc/ssl/certs/elisra-ca.pem
              subPath: elisra-ca.pem
              readOnly: true
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 15
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
            failureThreshold: 3
      volumes:
        - name: corp-ca
          configMap:
            name: elisra-corp-ca
```

The `/healthz` probe requires no authentication. It returns `{"status":"ok"}` when the server is ready.

---

## Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: elisra-mcp-ado
  namespace: mcp
spec:
  selector:
    app: elisra-mcp-ado
  ports:
    - name: mcp-http
      port: 3000
      targetPort: 3000
      protocol: TCP
  type: ClusterIP
```

Change `type` to `LoadBalancer` or add an `Ingress` if external access is needed. TLS termination is handled at the ingress layer — the Node process serves plain HTTP.

---

## Ingress (optional)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: elisra-mcp-ado
  namespace: mcp
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "120"
spec:
  rules:
    - host: mcp-ado.corp.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: elisra-mcp-ado
                port:
                  name: mcp-http
  tls:
    - hosts:
        - mcp-ado.corp.local
      secretName: mcp-ado-tls
```

---

## Apply All Manifests

Save the sections above into files and apply in order:

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f corp-ca-configmap.yaml   # skip if no internal CA
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml             # optional
```

---

## Verify

```bash
# Pod is running
kubectl get pods -n mcp

# Logs (startup, first ADO connection attempt)
kubectl logs -n mcp -l app=elisra-mcp-ado

# MCP endpoint is reachable (port-forward then test)
kubectl port-forward -n mcp svc/elisra-mcp-ado 3000:3000

curl -fsS http://localhost:3000/healthz
# {"status":"ok"}

MCP_BEARER=$(kubectl get secret elisra-mcp-ado-secrets -n mcp -o jsonpath='{.data.MCP_HTTP_BEARER_TOKEN}' | base64 -d)
curl -fsS \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://localhost:3000/mcp | jq '.result.tools[].name'
```

---

## Security Notes

- Pod runs as non-root (`runAsUser: 1000`). No capability escalation.
- `ADO_PAT` and `MCP_HTTP_BEARER_TOKEN` live in a Kubernetes `Secret`. Ensure RBAC limits who can read it.
- PATs and Authorization headers are redacted in all log output.
- The corporate CA cert is in a `ConfigMap` (public data) — intentional. Do not mix with the `Secret`.
- `ADO_READ_ONLY=true` is set in the ConfigMap. Never set it to `false` — no write tools exist and the value is enforced at the config layer.

---

## Legacy: mcpo Bridge

If you are still routing through the `mcpo` OpenAPI bridge (older Open WebUI versions), swap the container image to `elisradevops/elisra-mcp-ado-mcpo:latest`, change the container port to `8000`, and add `MCPO_API_KEY` to the Secret. The probes should hit `/openapi.json` with an `Authorization: Bearer $(MCPO_API_KEY)` header.

For new deployments, use the native HTTP mode above.
