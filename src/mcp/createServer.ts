import { createRequire } from 'module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { buildToolDeps, registerAllTools, type ToolDeps } from './tools/registerTools.js';
import { rewriteDefinitionsToDefs } from './schemaCompat.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version?: string };
const SERVER_VERSION: string = typeof pkg?.version === 'string' ? pkg.version : '0.0.0';

export interface CreateServerResult {
  server: McpServer;
  deps: ToolDeps;
}

export interface CreateServerOptions {
  applyMcpoSchemaCompat: boolean;
}

export function createConfiguredMcpServer(
  config: AppConfig,
  logger: Logger,
  opts: CreateServerOptions
): CreateServerResult {
  const server = new McpServer({
    name: 'elisra-mcp-ado',
    version: SERVER_VERSION,
  });

  const deps = buildToolDeps(config, logger);
  registerAllTools(server, deps);

  if (opts.applyMcpoSchemaCompat) {
    installSchemaCompatShim(server, logger);
  }

  return { server, deps };
}

function installSchemaCompatShim(server: McpServer, logger: Logger): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const innerServer = (server as any).server as { _requestHandlers: Map<string, (...args: unknown[]) => unknown> };
  const origHandler = innerServer._requestHandlers.get('tools/list');
  if (!origHandler) {
    logger.warn({}, 'installSchemaCompatShim: tools/list handler not found — schema compat not applied');
    return;
  }

  innerServer._requestHandlers.set('tools/list', async (...args: unknown[]) => {
    const result = await (origHandler as (...a: unknown[]) => Promise<{ tools?: Array<{ inputSchema?: unknown }> }>)(...args);
    if (result?.tools) {
      for (const tool of result.tools) {
        if (tool.inputSchema !== undefined) {
          tool.inputSchema = rewriteDefinitionsToDefs(tool.inputSchema);
        }
      }
    }
    return result;
  });
}
