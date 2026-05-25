import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal McpServer stand-in that captures tool registrations and dispatches
 * them synchronously. Used in integration tests and simulation scripts.
 */
export class FakeMcpServer {
  private readonly _handlers = new Map<string, ToolHandler>();

  tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler): void {
    this._handlers.set(name, handler);
  }

  async call(name: string, args: Record<string, unknown>) {
    const h = this._handlers.get(name);
    if (!h) throw new Error(`Tool not registered: ${name}`);
    return h(args);
  }

  has(name: string): boolean {
    return this._handlers.has(name);
  }

  asMcpServer(): McpServer {
    return this as unknown as McpServer;
  }
}

export function parseToolText(result: Awaited<ReturnType<FakeMcpServer['call']>>): Record<string, unknown> {
  if (result.isError) throw new Error(`Tool returned error: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}
