import pino from 'pino';
import type { AppConfig } from '../config/config.js';

export type Logger = pino.Logger;

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'adoEnableDebugOutput'>): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        'pat',
        'token',
        'secret',
        'password',
        'authorization',
        'x-ado-pat',
        'cookie',
        'credential',
        '*.pat',
        '*.token',
        '*.secret',
        '*.password',
        '*.authorization',
        '*.x-ado-pat',
        '*.cookie',
        '*.credential',
        'config.headers.authorization',
        'config.auth',
        'request._header',
        'request._headers',
      ],
      censor: '<REDACTED>',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  });
}

// Convenience no-op logger for tests
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
