import { generateRequestId } from '../../utils/requestId.js';
import { requestContextStorage } from '../../utils/requestContext.js';
import type { Logger } from '../../logging/logger.js';

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Returns a wrapper that:
 *  1. Generates a unique requestId per invocation.
 *  2. Propagates requestId + toolName through AsyncLocalStorage so every log
 *     entry within the call (including ADO client errors) carries the same ID.
 *  3. Emits a "tool invoked" INFO log at the start of each call.
 *
 * Usage in tool files:
 *   server.tool(name, desc, schema, wrapTool(name, async (args) => { ... }));
 */
export function createWrapTool(logger: Logger) {
  return function wrapTool<TArgs>(
    toolName: string,
    handler: (args: TArgs) => Promise<ToolResult>
  ): (args: TArgs) => Promise<ToolResult> {
    return (args: TArgs): Promise<ToolResult> => {
      // Inherit appUserId and resolvedAuth from the outer HTTP-layer context (trusted_user_header mode).
      // This preserves the pre-resolved ADO AuthContext across the AsyncLocalStorage.run() boundary
      // so tool handlers can call resolveAuthContext() without re-doing the MongoDB lookup.
      const outerCtx = requestContextStorage.getStore();
      return requestContextStorage.run(
        {
          requestId: generateRequestId(),
          toolName,
          appUserId: outerCtx?.appUserId,
          resolvedAuth: outerCtx?.resolvedAuth,
        },
        () => {
          logger.info({ toolName }, 'tool invoked');
          return handler(args);
        }
      );
    };
  };
}
