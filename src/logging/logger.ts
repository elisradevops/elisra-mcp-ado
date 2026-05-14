import winston from 'winston';
import type { AppConfig } from '../config/config.js';

// Pino-compatible log levels (fatal/trace added as custom levels)
const LOG_LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  http: 4,
  verbose: 5,
  debug: 6,
  trace: 7,
};

type LeveledMethod = (meta: object, msg?: string) => void;

export interface Logger {
  fatal: LeveledMethod;
  error: LeveledMethod;
  warn: LeveledMethod;
  info: LeveledMethod;
  http: LeveledMethod;
  verbose: LeveledMethod;
  debug: LeveledMethod;
  trace: LeveledMethod;
}

const REDACT_KEYS = new Set([
  'pat', 'token', 'secret', 'password', 'authorization', 'x-ado-pat',
  'cookie', 'credential',
]);

function deepRedact(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepRedact);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = REDACT_KEYS.has(k.toLowerCase()) ? '<REDACTED>' : deepRedact(v);
  }
  return result;
}

// Adapts pino-style logger.level({ meta }, 'message') calls to winston's internal format
const pinoCompatSplat = winston.format((info) => {
  const SPLAT = Symbol.for('splat');
  const splat: unknown[] = (info as Record<symbol, unknown[]>)[SPLAT] ?? [];
  if (splat.length > 0 && typeof splat[0] === 'string' && typeof info.message === 'object' && info.message !== null) {
    const meta = info.message as Record<string, unknown>;
    info.message = splat[0];
    Object.assign(info, meta);
    (info as Record<symbol, unknown[]>)[SPLAT] = splat.slice(1);
  }
  return info;
});

const redactFormat = winston.format((info) => {
  return deepRedact(info) as typeof info;
});

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'adoEnableDebugOutput'>): Logger {
  const inner = winston.createLogger({
    levels: LOG_LEVELS,
    level: config.logLevel,
    format: winston.format.combine(
      pinoCompatSplat(),
      redactFormat(),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.Console({
        stderrLevels: Object.keys(LOG_LEVELS),
      }),
    ],
  });
  return inner as unknown as Logger;
}

export function createSilentLogger(): Logger {
  const inner = winston.createLogger({ levels: LOG_LEVELS, silent: true, transports: [] });
  return inner as unknown as Logger;
}
