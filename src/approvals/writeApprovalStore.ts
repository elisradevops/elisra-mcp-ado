import { createHash, randomUUID } from 'node:crypto';
import type { Collection, Filter } from 'mongodb';
import type { Logger } from '../logging/logger.js';

export type ApprovalStatus =
  | 'pending'
  | 'executing'
  | 'used_success'
  | 'used_partial_failure'
  | 'used_failed_after_attempt'
  | 'needs_manual_review'
  | 'expired';

/** Terminal states — approval is done and cannot be re-executed. */
export type TerminalStatus = Exclude<ApprovalStatus, 'pending' | 'executing' | 'expired'>;

export interface NormalizedWorkItemInput {
  title: string;
  description?: string;
  areaPath?: string;
  iterationPath?: string;
  tags?: string;
  priority?: number;
}

export interface WriteApprovalDocument {
  approvalId: string;
  appUserId: string;
  requestId: string;
  operation: 'create_work_items';
  project: string;
  workItemType: string;
  normalizedPayload: NormalizedWorkItemInput[];
  payloadHash: string;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  /** Populated when status=used_partial_failure */
  partialCreatedIds?: number[];
  /** When the executing claim was made */
  executionStartedAt?: Date;
  /** requestId that claimed this approval */
  executionRequestId?: string;
}

export interface CreateApprovalInput {
  appUserId: string;
  requestId: string;
  project: string;
  workItemType: string;
  normalizedPayload: NormalizedWorkItemInput[];
  ttlSeconds: number;
}

export class WriteApprovalStore {
  constructor(
    private readonly col: Collection<WriteApprovalDocument>,
    private readonly logger: Logger,
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ approvalId: 1 }, { unique: true, name: 'uq_approval_id' });
    await this.col.createIndex({ appUserId: 1, status: 1 }, { name: 'idx_user_status' });
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires' });
    this.logger.info(
      { collection: (this.col as { collectionName?: string }).collectionName },
      'Write approval indexes ensured',
    );
  }

  async createApproval(doc: WriteApprovalDocument): Promise<WriteApprovalDocument> {
    await this.col.insertOne(doc);
    return doc;
  }

  async findApproval(approvalId: string): Promise<WriteApprovalDocument | null> {
    return this.col.findOne({ approvalId }, { projection: { _id: 0 } });
  }

  /**
   * Atomically claim a pending approval for execution.
   *
   * Uses findOneAndUpdate with a compound filter — only one concurrent caller can win.
   * The second caller finds status:'executing', the filter misses, and receives null.
   *
   * Returns the claimed document (with status=executing) on success.
   * Returns null when: not found, wrong appUserId, not pending, expired, already executing, or terminal.
   *
   * The null return gives no information about WHY the claim failed — prevents user enumeration.
   */
  async claimForExecution(
    approvalId: string,
    appUserId: string,
    requestId: string,
  ): Promise<WriteApprovalDocument | null> {
    const now = new Date();
    const filter: Filter<WriteApprovalDocument> = {
      approvalId,
      appUserId,
      status: 'pending',
      expiresAt: { $gt: now },
    };
    const update = {
      $set: {
        status: 'executing' as ApprovalStatus,
        executionStartedAt: now,
        executionRequestId: requestId,
      },
    };

    const result = await this.col.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      projection: { _id: 0 },
    });

    return result ?? null;
  }

  /**
   * Mark an approval terminal after write attempts complete.
   * Transitions from executing → terminal state.
   * partialCreatedIds: set when status=used_partial_failure.
   */
  async markTerminal(
    approvalId: string,
    status: TerminalStatus,
    partialCreatedIds?: number[],
  ): Promise<void> {
    const update: Record<string, unknown> = { status, usedAt: new Date() };
    if (partialCreatedIds !== undefined) {
      update['partialCreatedIds'] = partialCreatedIds;
    }
    await this.col.updateOne({ approvalId }, { $set: update });
  }

  /**
   * Find approvals stuck in executing state longer than staleThresholdSeconds.
   * These represent server crashes after claim but before terminal marking.
   * NEVER auto-retry — may duplicate ADO work items. Require manual review.
   */
  async listStaleExecuting(staleThresholdSeconds: number): Promise<WriteApprovalDocument[]> {
    const threshold = new Date(Date.now() - staleThresholdSeconds * 1000);
    return this.col
      .find(
        {
          status: 'executing',
          executionStartedAt: { $lt: threshold },
        } as Filter<WriteApprovalDocument>,
        { projection: { _id: 0 } },
      )
      .toArray();
  }

  async expireStale(): Promise<void> {
    await this.col.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } } as Parameters<typeof this.col.updateMany>[0],
      { $set: { status: 'expired' as ApprovalStatus } },
    );
  }

  static buildDocument(input: CreateApprovalInput): WriteApprovalDocument {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    return {
      approvalId: randomUUID(),
      appUserId: input.appUserId,
      requestId: input.requestId,
      operation: 'create_work_items',
      project: input.project,
      workItemType: input.workItemType,
      normalizedPayload: input.normalizedPayload,
      payloadHash: WriteApprovalStore.hashPayload(input.normalizedPayload),
      status: 'pending',
      createdAt: now,
      expiresAt,
    };
  }

  static hashPayload(payload: NormalizedWorkItemInput[]): string {
    const canonical = JSON.stringify(
      payload.map((item) => {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(item).sort()) {
          sorted[key] = (item as unknown as Record<string, unknown>)[key];
        }
        return sorted;
      }),
    );
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  static isExpired(doc: Pick<WriteApprovalDocument, 'expiresAt'>): boolean {
    return doc.expiresAt < new Date();
  }

  /**
   * Returns true only for terminal states.
   * pending and executing are NOT terminal — pending can be claimed; executing is in-flight.
   */
  static isTerminal(doc: Pick<WriteApprovalDocument, 'status'>): boolean {
    return (
      doc.status !== 'pending' &&
      doc.status !== 'executing' &&
      doc.status !== 'expired'
    );
  }

  static belongsToUser(
    doc: Pick<WriteApprovalDocument, 'appUserId'>,
    appUserId: string,
  ): boolean {
    return doc.appUserId === appUserId;
  }
}
