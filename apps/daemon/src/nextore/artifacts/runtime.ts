import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  NextoreArtifactRecord,
  NextoreArtifactRepresentation,
  NextoreArtifactStatusResponse,
  NextoreTier,
} from '@open-design/contracts';

import type { NextoreSessionStore } from '../auth/session-store.js';
import type { NextoreArtifactClient } from '../client.js';
import type { NextoreConfig } from '../config.js';
import { isNextoreArtifactPublishEnabled, type NextoreArtifactAuthorityMode } from './features.js';
import {
  enqueueNextorePublish,
  getNextoreArtifact,
  retryNextorePublish,
} from './store.js';
import { publishArtifactJob, type PublishOutcomeStatus } from './publisher.js';
import {
  resolvePublishableArtifacts,
  type NextoreDeliverableSnapshot,
} from './registry.js';
import { resolveMemberAccessToken } from './session-access.js';
import { buildNextoreArtifactStatus } from './status.js';
import {
  drainNextorePublishQueue,
  jobFromQueueItem,
  type NextorePublishWorkerDeps,
} from './worker.js';

type SqliteDb = Database.Database;

export interface NextoreArtifactStatusEvent {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  status: PublishOutcomeStatus;
  version: number | null;
  error: string | null;
}

export interface EnqueueNextoreRunInput {
  projectId: string;
  artifactId: string;
  projectRoot: string;
  runId: string | null;
  tier: NextoreTier | null;
  memberId: number;
  deliverable: NextoreDeliverableSnapshot;
  exportedFiles?: readonly string[];
  savedAt?: string | null;
}

export interface NextoreArtifactRuntimeDeps {
  db: SqliteDb;
  client: NextoreArtifactClient;
  sessionStore: NextoreSessionStore;
  config: NextoreConfig;
  mode: NextoreArtifactAuthorityMode;
  /** Local project id -> NexTore project folder id, from project metadata. */
  readProjectMapping?: (projectId: string) => string | null;
  workerId?: string;
  now?: () => number;
  onStatus?: (event: NextoreArtifactStatusEvent) => void;
  autoDrain?: boolean;
}

/**
 * P04c runtime: enqueue finalized deliverables, drain the durable queue, and expose status.
 * The timer is intentionally simple; a single process is the only active publisher for a data root.
 */
export class NextoreArtifactRuntime {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private wakePending = false;

  constructor(private readonly deps: NextoreArtifactRuntimeDeps) {}

  get mode(): NextoreArtifactAuthorityMode {
    return this.deps.mode;
  }

  enqueueRun(input: EnqueueNextoreRunInput): number {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return 0;
    const artifacts = resolvePublishableArtifacts({
      projectId: input.projectId,
      artifactId: input.artifactId,
      runId: input.runId,
      tier: input.tier,
      deliverable: input.deliverable,
      ...(input.exportedFiles ? { exportedFiles: input.exportedFiles } : {}),
    });
    const now = this.deps.now ?? Date.now;
    for (const artifact of artifacts) {
      enqueueNextorePublish(this.deps.db, {
        projectId: artifact.projectId,
        artifactId: artifact.artifactId,
        representation: artifact.representation,
        memberId: input.memberId,
        runId: input.runId,
        tier: input.tier,
        relativePath: artifact.relativePath,
        sourcePath: path.resolve(input.projectRoot, artifact.sourcePath),
        name: artifact.name,
        mimeType: artifact.mimeType,
        reason: 'run-complete',
        now: now(),
      });
    }
    if (artifacts.length > 0 && this.deps.autoDrain !== false) void this.wake();
    return artifacts.length;
  }

  async drainOnce(): Promise<number> {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return 0;
    if (this.running) {
      this.wakePending = true;
      return 0;
    }
    this.running = true;
    try {
      const worker: NextorePublishWorkerDeps = {
        db: this.deps.db,
        workerId: this.deps.workerId ?? 'nextore-artifact-runtime',
        resolveJob: async (item) => jobFromQueueItem(item),
        publish: async (job) => publishArtifactJob(job, {
          db: this.deps.db,
          client: this.deps.client,
          resolveAccessToken: (memberId) => resolveMemberAccessToken(memberId, {
            store: this.deps.sessionStore,
            config: this.deps.config,
            ...(this.deps.now ? { now: this.deps.now } : {}),
          }),
          ...(this.deps.now ? { now: this.deps.now } : {}),
          ...(this.deps.readProjectMapping
            ? { resolveNextoreProjectId: this.deps.readProjectMapping }
            : {}),
        }),
        ...(this.deps.now ? { now: this.deps.now } : {}),
      };
      const result = await drainNextorePublishQueue(worker, {
        onTick: (tick) => {
          if (!tick.claimed) return;
          const outcome = tick.outcome;
          this.deps.onStatus?.({
            projectId: tick.claimed.projectId,
            artifactId: tick.claimed.artifactId,
            representation: tick.claimed.representation,
            status: outcome?.status ?? 'failed',
            version: outcome?.version ?? null,
            error: outcome ? outcome.errorCode : 'job_payload_missing',
          });
        },
      });
      return result.processed;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 5_000): void {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode) || this.timer) return;
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, intervalMs);
    this.timer.unref?.();
    void this.drainOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(projectId: string, artifactId: string): NextoreArtifactStatusResponse {
    return buildNextoreArtifactStatus(this.deps.db, projectId, artifactId);
  }

  /**
   * Re-arm a failed or dead-lettered queue item and drain immediately.
   * Returns false when no queue row exists for that representation.
   */
  retry(
    projectId: string,
    artifactId: string,
    representation: NextoreArtifactRepresentation,
  ): boolean {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return false;
    const now = this.deps.now ?? Date.now;
    const reset = retryNextorePublish(this.deps.db, projectId, artifactId, representation, now());
    if (reset && this.deps.autoDrain !== false) void this.wake();
    return reset;
  }

  /** Published-record lookup used by the download proxy. */
  artifactRecord(
    projectId: string,
    artifactId: string,
    representation: NextoreArtifactRepresentation,
  ): NextoreArtifactRecord | null {
    return getNextoreArtifact(this.deps.db, projectId, artifactId, representation);
  }

  /** NexTore project folder id for a local project, or null when unmapped. */
  nextoreProjectId(projectId: string): string | null {
    return this.deps.readProjectMapping?.(projectId) ?? null;
  }

  /** Resolve a still-valid member token for a proxied NexTore call. */
  async accessTokenFor(memberId: number): Promise<string | null> {
    return resolveMemberAccessToken(memberId, {
      store: this.deps.sessionStore,
      config: this.deps.config,
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });
  }

  private async wake(): Promise<void> {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return;
    if (this.running) {
      this.wakePending = true;
      return;
    }
    await this.drainOnce();
    if (this.wakePending) {
      this.wakePending = false;
      void this.drainOnce();
    }
  }
}
