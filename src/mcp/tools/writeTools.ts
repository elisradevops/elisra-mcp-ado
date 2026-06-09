import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../../config/config.js';
import type { Logger } from '../../logging/logger.js';
import type { WriteApprovalStore } from '../../approvals/writeApprovalStore.js';
import { WriteApprovalStore as WAS } from '../../approvals/writeApprovalStore.js';
import type { WorkItemCreateClient } from '../../ado/workItemCreateClient.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import type { ToolDeps } from './registerTools.js';
import { getRequestContext } from '../../utils/requestContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 32_768;
const TAGS_MAX = 1024;
const PATH_MAX = 512;

const WorkItemItemSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).transform((s) => s.trim()),
  description: z.string().max(DESCRIPTION_MAX).optional().transform((s) => s?.trim() ?? undefined),
  areaPath: z.string().max(PATH_MAX).optional().transform((s) => s?.trim() ?? undefined),
  iterationPath: z.string().max(PATH_MAX).optional().transform((s) => s?.trim() ?? undefined),
  tags: z.string().max(TAGS_MAX).optional().transform((s) => s?.trim() ?? undefined),
  priority: z.number().int().min(1).max(4).optional(),
});

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function err(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function checkAllowlist(value: string, allowlist: string[], label: string): string | null {
  if (allowlist.length === 0) return null;
  if (!allowlist.includes(value)) {
    return `${label} "${value}" is not in the allowed list. Allowed: ${allowlist.join(', ')}`;
  }
  return null;
}

function checkPathPrefixes(value: string | undefined, prefixes: string[], label: string): string | null {
  if (!value || prefixes.length === 0) return null;
  if (!prefixes.some((p) => value.startsWith(p))) {
    return `${label} "${value}" does not start with an allowed prefix. Allowed prefixes: ${prefixes.join(', ')}`;
  }
  return null;
}

export type PreviewInput = {
  project: string;
  workItemType: string;
  items: Array<{
    title: string;
    description?: string;
    areaPath?: string;
    iterationPath?: string;
    tags?: string;
    priority?: number;
  }>;
};

export function createPreviewHandler(
  config: AppConfig,
  store: WriteApprovalStore,
  logger: Logger,
) {
  return async (args: PreviewInput): Promise<ToolResult> => {
    const ctx = getRequestContext();
    const appUserId = ctx?.appUserId;

    if (!appUserId) {
      return err('User identity is required for write operations. Ensure trusted_user_header auth mode is active.');
    }

    const projectError = checkAllowlist(args.project, config.adoAllowedProjects, 'Project');
    if (projectError) return err(projectError);

    const typeError = checkAllowlist(args.workItemType, config.adoAllowedWorkItemTypes, 'Work item type');
    if (typeError) return err(typeError);

    if (args.items.length === 0) {
      return err('At least one work item is required.');
    }
    if (args.items.length > config.adoWriteMaxItemsPerApproval) {
      return err(
        `Too many items: ${args.items.length} requested, maximum is ${config.adoWriteMaxItemsPerApproval}. ` +
        `Adjust ADO_WRITE_MAX_ITEMS_PER_APPROVAL to increase this limit.`,
      );
    }

    const normalizedItems: Array<z.infer<typeof WorkItemItemSchema>> = [];
    for (let i = 0; i < args.items.length; i++) {
      const parseResult = WorkItemItemSchema.safeParse(args.items[i]);
      if (!parseResult.success) {
        const issues = parseResult.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        return err(`Item [${i}] validation failed: ${issues}`);
      }
      const item = parseResult.data;

      const areaPathError = checkPathPrefixes(item.areaPath, config.adoAllowedAreaPathPrefixes, 'areaPath');
      if (areaPathError) return err(`Item [${i}]: ${areaPathError}`);

      const iterPathError = checkPathPrefixes(item.iterationPath, config.adoAllowedIterationPathPrefixes, 'iterationPath');
      if (iterPathError) return err(`Item [${i}]: ${iterPathError}`);

      normalizedItems.push(item);
    }

    const doc = WAS.buildDocument({
      appUserId,
      requestId: ctx?.requestId ?? 'unknown',
      project: args.project,
      workItemType: args.workItemType,
      normalizedPayload: normalizedItems,
      ttlSeconds: config.adoWriteApprovalTtlSeconds,
    });

    try {
      await store.createApproval(doc);
    } catch (storeErr) {
      const message = storeErr instanceof Error ? storeErr.message : String(storeErr);
      logger.error({ appUserId, operation: 'preview_create_work_items', sanitizedError: message }, 'Failed to store approval');
      return err('Failed to store approval. Please try again.');
    }

    logger.info({
      appUserId,
      approvalId: doc.approvalId,
      project: doc.project,
      workItemType: doc.workItemType,
      itemCount: normalizedItems.length,
      operation: 'preview_create_work_items',
    }, 'Work item creation approval created');

    return {
      content: [{
        type: 'text',
        text: safeJsonStringify({
          approvalId: doc.approvalId,
          operation: doc.operation,
          project: doc.project,
          workItemType: doc.workItemType,
          itemCount: normalizedItems.length,
          expiresAt: doc.expiresAt.toISOString(),
          items: normalizedItems.map((item) => ({ title: item.title, description: item.description })),
          noAdoWriteOccurred: true,
          nextStep: `Call ado_confirm_create_work_items with approvalId "${doc.approvalId}" to create the work items.`,
        }, 2),
      }],
    };
  };
}

export type ConfirmInput = { approvalId: string };

export function createConfirmHandler(
  config: AppConfig,
  store: WriteApprovalStore,
  createClient: WorkItemCreateClient,
  logger: Logger,
) {
  return async (args: ConfirmInput): Promise<ToolResult> => {
    const ctx = getRequestContext();
    const appUserId = ctx?.appUserId;
    const requestId = ctx?.requestId ?? 'unknown';

    if (!appUserId) {
      return err('User identity is required for write operations.');
    }

    if (config.adoReadOnly) {
      return err('ADO is in read-only mode. Set ADO_READ_ONLY=false to enable write operations.');
    }

    // Atomically claim the approval — transitions pending → executing.
    // Returns null for: not found, wrong user, expired, already executing, or terminal.
    // Same null return for all failure cases — no user enumeration, no state leakage.
    let claimedApproval: import('../../approvals/writeApprovalStore.js').WriteApprovalDocument | null;
    try {
      claimedApproval = await store.claimForExecution(args.approvalId, appUserId, requestId);
    } catch (claimErr) {
      const message = claimErr instanceof Error ? claimErr.message : String(claimErr);
      logger.error({ appUserId, approvalId: args.approvalId, sanitizedError: message }, 'Approval claim failed');
      return err('Failed to claim approval. Please try again.');
    }

    if (!claimedApproval) {
      return err(
        `Approval not available: ${args.approvalId}. ` +
        'It may not exist, may belong to another user, may be expired, or may already be in use.',
      );
    }

    // Approval is now executing — MUST reach a terminal state from here.
    // Any failure must call markTerminal with needs_manual_review.

    let auth;
    try {
      auth = resolveAuthContext(config);
    } catch {
      logger.warn({ appUserId, approvalId: claimedApproval.approvalId }, 'Auth resolution failed after claim — marking needs_manual_review');
      await store.markTerminal(claimedApproval.approvalId, 'needs_manual_review').catch(() => {});
      return err(
        'Unable to resolve ADO credentials. Ensure your PAT is registered via the settings endpoint. ' +
        'Approval has been marked for manual review.',
      );
    }

    if (!auth.pat) {
      logger.warn({ appUserId, approvalId: claimedApproval.approvalId }, 'No PAT after claim — marking needs_manual_review');
      await store.markTerminal(claimedApproval.approvalId, 'needs_manual_review').catch(() => {});
      return err(
        'No ADO credential available for this user. Register a PAT via the settings endpoint. ' +
        'Approval has been marked for manual review.',
      );
    }

    // Execute write loop — stop on first failure
    const createdIds: number[] = [];
    const createdUrls: string[] = [];
    let failureReason: string | null = null;

    for (let i = 0; i < claimedApproval.normalizedPayload.length; i++) {
      const item = claimedApproval.normalizedPayload[i];
      try {
        const created = await createClient.createOne(
          claimedApproval.project,
          claimedApproval.workItemType,
          item,
          auth,
        );
        createdIds.push(created.id);
        if (created.webUrl) createdUrls.push(created.webUrl);
      } catch (adoErr) {
        const msg = adoErr instanceof Error ? adoErr.message : String(adoErr);
        failureReason = auth.pat ? msg.split(auth.pat).join('[REDACTED]') : msg;
        break;
      }
    }

    const allCreated = failureReason === null;
    const anyCreated = createdIds.length > 0;

    let terminalStatus: import('../../approvals/writeApprovalStore.js').TerminalStatus;
    if (allCreated) {
      terminalStatus = 'used_success';
    } else if (anyCreated) {
      terminalStatus = 'used_partial_failure';
    } else {
      terminalStatus = 'used_failed_after_attempt';
    }

    await store.markTerminal(
      claimedApproval.approvalId,
      terminalStatus,
      anyCreated && !allCreated ? createdIds : undefined,
    ).catch((markErr: unknown) => {
      const msg = markErr instanceof Error ? markErr.message : String(markErr);
      logger.error(
        { approvalId: claimedApproval!.approvalId, sanitizedError: msg },
        'Failed to mark approval terminal — stuck in executing, manual review required',
      );
    });

    logger.info({
      timestamp: new Date().toISOString(),
      requestId: ctx?.requestId,
      approvalId: claimedApproval.approvalId,
      appUserId,
      operation: 'confirm_create_work_items',
      project: claimedApproval.project,
      workItemType: claimedApproval.workItemType,
      requestedItemCount: claimedApproval.normalizedPayload.length,
      createdWorkItemIds: createdIds,
      terminalStatus,
      success: allCreated,
      ...(failureReason ? { sanitizedError: failureReason } : {}),
      payloadHash: claimedApproval.payloadHash,
    }, allCreated ? 'Work items created' : 'Work item creation failed or partial');

    if (!allCreated) {
      return {
        content: [{
          type: 'text',
          text: safeJsonStringify({
            success: false,
            terminalStatus,
            approvalId: claimedApproval.approvalId,
            partialCreatedWorkItemIds: createdIds,
            sanitizedError: failureReason,
            note: 'This approval is now terminal. To retry, create a new preview.',
          }, 2),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: safeJsonStringify({
          success: true,
          terminalStatus,
          approvalId: claimedApproval.approvalId,
          operation: claimedApproval.operation,
          project: claimedApproval.project,
          workItemType: claimedApproval.workItemType,
          createdWorkItemIds: createdIds,
          workItemUrls: createdUrls,
        }, 2),
      }],
    };
  };
}

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, writeApprovalStore, workItemCreateClient, wrapTool } = deps;

  if (!writeApprovalStore || !workItemCreateClient) {
    logger.info(
      {},
      'Write tools not registered: writeApprovalStore or workItemCreateClient unavailable. ' +
      'Requires trusted_user_header auth mode with MongoDB.',
    );
    return;
  }

  const previewHandler = createPreviewHandler(config, writeApprovalStore, logger);
  const confirmHandler = createConfirmHandler(config, writeApprovalStore, workItemCreateClient, logger);

  server.tool(
    'ado_preview_create_work_items',
    'Stage a work item creation request for approval. Returns approvalId — NO items are created yet. ' +
    'User must call ado_confirm_create_work_items with the approvalId to execute.',
    {
      project: z.string().min(1).describe('ADO project name.'),
      workItemType: z.string().min(1).describe('Work item type, e.g. "Task", "Bug".'),
      items: z.array(z.object({
        title: z.string().min(1).max(255).describe('Required title.'),
        description: z.string().max(32768).optional().describe('Optional description.'),
        areaPath: z.string().max(512).optional().describe('Optional area path.'),
        iterationPath: z.string().max(512).optional().describe('Optional iteration path.'),
        tags: z.string().max(1024).optional().describe('Optional semicolon-separated tags.'),
        priority: z.number().int().min(1).max(4).optional().describe('Priority 1-4.'),
      })).min(1).max(config.adoWriteMaxItemsPerApproval).describe('Items to create.'),
    },
    wrapTool('ado_preview_create_work_items', previewHandler as (args: PreviewInput) => Promise<ToolResult>),
  );

  server.tool(
    'ado_confirm_create_work_items',
    'Execute a previously approved work item creation. Accepts ONLY approvalId. ' +
    'Do NOT pass work item content — it was fixed at preview time.',
    {
      approvalId: z.string().uuid().describe('approvalId from ado_preview_create_work_items.'),
    },
    wrapTool('ado_confirm_create_work_items', confirmHandler),
  );
}
