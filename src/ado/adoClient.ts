import http from 'node:http';
import https from 'node:https';
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { AuthContext } from '../auth/authContext.js';
import { buildAuthHeader } from '../auth/patAuth.js';
import { redactError } from '../auth/redact.js';
import { isTlsError } from '../security/secretRedaction.js';

const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5000;

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']);

function isRetryable(err: unknown): boolean {
  if (err instanceof AxiosError) {
    if (err.response) {
      const s = err.response.status;
      return s === 429 || s >= 500;
    }
    // Network-level — but not TLS (TLS errors must fail immediately)
    if (isTlsError(err)) return false;
    return RETRYABLE_CODES.has(err.code ?? '');
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  const exp = RETRY_BASE_MS * Math.pow(2, attempt - 1);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exp * jitter, RETRY_MAX_MS);
}

function buildTlsErrorMessage(err: unknown): string {
  const code =
    (err as Record<string, unknown>)?.['code'] ??
    ((err as Record<string, unknown>)?.['cause'] as Record<string, unknown>)?.['code'] ??
    'unknown';
  return (
    `TLS certificate validation failed for Azure DevOps Server (${String(code)}). ` +
    `If the server uses a self-signed or corporate CA certificate, ` +
    `set NODE_EXTRA_CA_CERTS=/path/to/ca.pem and restart. ` +
    `Do NOT disable certificate validation.`
  );
}

function mapHttpError(err: AxiosError, debug: boolean): Error {
  const status = err.response?.status;
  if (status === 401 || status === 403 || status === 404) {
    if (debug) {
      return new Error(`ADO returned HTTP ${status}: check PAT permissions and project name.`);
    }
    return new Error(
      'ADO request failed (access denied, invalid credentials, or resource not found). ' +
      'Enable ADO_ENABLE_DEBUG_OUTPUT=true for details.'
    );
  }
  const safe = redactError(err);
  return safe;
}

function createAxiosInstance(config: AppConfig): AxiosInstance {
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 300_000 });
  // CA-only TLS — Node automatically reads NODE_EXTRA_CA_CERTS from env.
  // No rejectUnauthorized:false — fail loud if cert is untrusted.
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 300_000 });

  return axios.create({
    timeout: config.adoRequestTimeoutMs,
    httpAgent,
    httpsAgent,
    maxRedirects: 5,
    validateStatus: null, // we inspect status manually
  });
}

export interface AdoRequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  auth: AuthContext;
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
}

export class AdoClient {
  private readonly axios: AxiosInstance;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    axiosOverride?: AxiosInstance
  ) {
    this.axios = axiosOverride ?? createAxiosInstance(config);
  }

  async request<T>(options: AdoRequestOptions): Promise<T> {
    const authHeader = options.auth.pat ? buildAuthHeader(options.auth.pat) : undefined;

    const axiosConfig: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      params: options.params,
      data: options.data,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        const response = await this.axios.request<T>(axiosConfig);

        // TLS can succeed but HTTP status may still indicate error
        const status = response.status;
        if (status >= 400) {
          const isRetryableStatus = status === 429 || status >= 500;
          if (!isRetryableStatus) {
            // 401/403/404 — not retryable, map to safe error
            const fakeErr = new AxiosError(
              `Request failed with status ${status}`,
              String(status),
              undefined,
              undefined,
              response as AxiosResponse
            );
            Object.assign(fakeErr, { response });
            throw mapHttpError(fakeErr, this.config.adoEnableDebugOutput);
          }
          lastError = new Error(`ADO request returned HTTP ${status}`);
          if (attempt < RETRY_MAX) {
            const delay = retryDelay(attempt);
            this.logger.warn({ attempt, delay, status, url: options.url }, 'Retrying ADO request');
            await sleep(delay);
            continue;
          }
          throw redactError(lastError);
        }

        return response.data;
      } catch (err) {
        if (isTlsError(err)) {
          throw new Error(buildTlsErrorMessage(err));
        }
        if (!isRetryable(err)) {
          throw redactError(err);
        }
        lastError = err;
        if (attempt < RETRY_MAX) {
          const delay = retryDelay(attempt);
          this.logger.warn({ attempt, delay, url: options.url }, 'Retrying ADO request after transient error');
          await sleep(delay);
        }
      }
    }
    throw redactError(lastError);
  }

  async get<T>(url: string, auth: AuthContext, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>({ method: 'GET', url, auth, params });
  }

  async post<T>(url: string, auth: AuthContext, data: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', url, auth, data });
  }

  buildUrl(...segments: string[]): string {
    const base = this.config.adoOrgUrl;
    const path = segments.join('/').replace(/\/+/g, '/');
    return `${base}/${path}`;
  }
}
