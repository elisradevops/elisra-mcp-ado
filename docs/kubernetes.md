# Kubernetes Deployment

Reference manifests for running `elisra-mcp-ado` (and the mcpo HTTP bridge) in Kubernetes. These are starting points — adapt namespaces, resource limits, and image tags to your cluster.

> **Note:** In v1, the MCP server is stdio-only. The Pod below wraps the server with mcpo so it is reachable over HTTP. An HTTP-native MCP transport is reserved for a future version.

---

## Auth Mode Choice

| Mode | Kubernetes implication |
|---|---|
| `per_request_pat` (recommended) | Pod holds no credential. Each tool call supplies a PAT in the request body. No Secret is needed for the PAT itself. |
| `server_pat` | A single PAT is stored in a Kubernetes `Secret` and injected as `ADO_PAT`. All requests run under that identity. |

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
  ADO_AUTH_MODE: "per_request_pat"   # or "server_pat"
  ADO_READ_ONLY: "true"
  ADO_ENABLE_DEBUG_OUTPUT: "false"
  ADO_REQUEST_TIMEOUT_MS: "30000"
  ADO_ALLOW_UNKNOWN_FIELDS: "false"
  ADO_FULL_RESPONSE_MAX_ITEMS: "50"
  LOG_LEVEL: "info"
  NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/elisra-ca.pem"
  MCPO_PORT: "8000"
```

---

## Secret — sensitive values

### Per-request PAT mode (no ADO credential in cluster)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: elisra-mcp-ado-secrets
  namespace: mcp
type: Opaque
stringData:
  MCPO_API_KEY: "replace-with-a-strong-random-key"
```

### Server PAT mode (single shared identity)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: elisra-mcp-ado-secrets
  namespace: mcp
type: Opaque
stringData:
  MCPO_API_KEY: "replace-with-a-strong-random-key"
  ADO_PAT: "replace-with-your-ado-personal-access-token"
```

---

## Corporate CA Certificate

If your ADO Server uses a self-signed or internal CA, mount the certificate as a `ConfigMap` (it is not a secret — CA certs are public).

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

The Deployment below mounts this at `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/elisra-ca.pem`.

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
        - name: mcp-mcpo
          image: elisradevops/elisra-mcp-ado-mcpo:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8000
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
              path: /openapi.json
              port: 8000
              httpHeaders:
                - name: Authorization
                  value: "Bearer $(MCPO_API_KEY)"
            initialDelaySeconds: 5
            periodSeconds: 15
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /openapi.json
              port: 8000
              httpHeaders:
                - name: Authorization
                  value: "Bearer $(MCPO_API_KEY)"
            initialDelaySeconds: 10
            periodSeconds: 30
            failureThreshold: 3
      volumes:
        - name: corp-ca
          configMap:
            name: elisra-corp-ca
```

> **Important:** The `readinessProbe` and `livenessProbe` use `$(MCPO_API_KEY)` variable expansion. Kubernetes supports env var substitution inside the same container spec when the referenced var is defined in `envFrom` or `env`. Verify this works in your cluster version (≥1.14); otherwise hardcode the key in the probe or use an exec probe.

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
    - name: http
      port: 80
      targetPort: 8000
      protocol: TCP
  type: ClusterIP
```

Expose via `Ingress` or `LoadBalancer` if external access is needed.

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
                  name: http
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

# Logs (startup probe, first ADO connection attempt)
kubectl logs -n mcp -l app=elisra-mcp-ado

# mcpo HTTP bridge is reachable
kubectl port-forward -n mcp svc/elisra-mcp-ado 9090:80
curl -H "Authorization: Bearer <MCPO_API_KEY>" http://localhost:9090/openapi.json | jq '.info'
```

---

## Security Notes

- Pod runs as non-root (`runAsUser: 1000`). No capability escalation.
- `ADO_PAT` (if used) lives in a Kubernetes `Secret` — not a `ConfigMap`. Ensure RBAC limits who can read it.
- `MCPO_API_KEY` is also in the `Secret`. Rotate it if compromised without image rebuild.
- The corporate CA cert is in a `ConfigMap` (public data) — intentional. Do not mix with the `Secret`.
- `ADO_READ_ONLY=true` is set in the `ConfigMap`. Never set it to `false` — no write tools exist in v1 and the value is enforced at the config layer.
- For per-request PAT mode: no PAT touches the cluster. Each caller supplies their own PAT per tool call. This is the recommended production posture.
