import { describe, it, expect } from 'vitest';
import { generateRequestId } from '../../src/utils/requestId.js';
import { requestContextStorage, getRequestContext } from '../../src/utils/requestContext.js';
import { createWrapTool } from '../../src/mcp/tools/toolHelpers.js';
import { createSilentLogger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// generateRequestId
// ─────────────────────────────────────────────────────────────────────────────

describe('generateRequestId', () => {
  it('returns a non-empty string', () => {
    expect(generateRequestId()).toBeTruthy();
  });

  it('returns distinct values across calls', () => {
    const ids = Array.from({ length: 20 }, generateRequestId);
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
  });

  it('matches UUID v4 format', () => {
    const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(generateRequestId()).toMatch(uuidV4Re);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requestContextStorage propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('requestContextStorage', () => {
  it('returns undefined outside any run() scope', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('propagates context within run() callback', () => {
    return requestContextStorage.run({ requestId: 'test-id-1', toolName: 'test_tool' }, () => {
      const ctx = getRequestContext();
      expect(ctx?.requestId).toBe('test-id-1');
      expect(ctx?.toolName).toBe('test_tool');
    });
  });

  it('propagates context through async operations', async () => {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    return requestContextStorage.run({ requestId: 'async-id', toolName: 'async_tool' }, async () => {
      await delay(1);
      expect(getRequestContext()?.requestId).toBe('async-id');
    });
  });

  it('isolates contexts across concurrent runs', async () => {
    const results: Array<string | undefined> = [];

    await Promise.all([
      requestContextStorage.run({ requestId: 'id-a', toolName: 'tool_a' }, async () => {
        await new Promise<void>((r) => setTimeout(r, 5));
        results.push(getRequestContext()?.requestId);
      }),
      requestContextStorage.run({ requestId: 'id-b', toolName: 'tool_b' }, async () => {
        await new Promise<void>((r) => setTimeout(r, 2));
        results.push(getRequestContext()?.requestId);
      }),
    ]);

    expect(results).toContain('id-a');
    expect(results).toContain('id-b');
    expect(results).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wrapTool — requestId generation and context propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('createWrapTool', () => {
  const logger = createSilentLogger();
  const wrapTool = createWrapTool(logger);

  it('each invocation gets a unique requestId', async () => {
    const ids: Array<string | undefined> = [];
    const handler = wrapTool('test_tool', async (_args: Record<string, never>) => {
      ids.push(getRequestContext()?.requestId);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    await handler({});
    await handler({});
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('requestId is visible inside handler via getRequestContext()', async () => {
    let capturedId: string | undefined;
    const handler = wrapTool('ctx_test_tool', async (_args: Record<string, never>) => {
      capturedId = getRequestContext()?.requestId;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    await handler({});
    expect(capturedId).toBeTruthy();
    const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(capturedId).toMatch(uuidV4Re);
  });

  it('toolName is set in context', async () => {
    let capturedTool: string | undefined;
    const handler = wrapTool('my_special_tool', async (_args: Record<string, never>) => {
      capturedTool = getRequestContext()?.toolName;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    await handler({});
    expect(capturedTool).toBe('my_special_tool');
  });

  it('returns handler result unchanged', async () => {
    const expected = { content: [{ type: 'text' as const, text: 'hello' }] };
    const handler = wrapTool('passthrough_tool', async (_args: Record<string, never>) => expected);
    const result = await handler({});
    expect(result).toStrictEqual(expected);
  });

  it('propagates isError results unchanged', async () => {
    const handler = wrapTool('error_tool', async (_args: Record<string, never>) => ({
      content: [{ type: 'text' as const, text: 'something failed' }],
      isError: true,
    }));
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  it('inherits appUserId from outer context', async () => {
    let capturedUserId: string | undefined;
    const handler = wrapTool('user_tool', async (_args: Record<string, never>) => {
      capturedUserId = getRequestContext()?.appUserId;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    await requestContextStorage.run(
      { requestId: 'outer-req-id', toolName: '', appUserId: 'user@example.com' },
      () => handler({})
    );

    expect(capturedUserId).toBe('user@example.com');
  });

  it('appUserId is undefined when outer context has none', async () => {
    let capturedUserId: string | undefined = 'sentinel';
    const handler = wrapTool('no_user_tool', async (_args: Record<string, never>) => {
      capturedUserId = getRequestContext()?.appUserId;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    await handler({});
    expect(capturedUserId).toBeUndefined();
  });
});
