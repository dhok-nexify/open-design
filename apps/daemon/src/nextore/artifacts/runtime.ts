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
  listNextoreArtifacts,
  listProjectMembers,
  rememberProjectMember,
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
  reconcileProjectArtifacts,
  type ReconcileProjectResult,
} from './reconcile.js';
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
  /**
   * Start a watcher for a project tree. Returns a disposer. Out-of-run edits
   * reuse this so the artifact published by the last run keeps tracking the
   * file the user actually edits.
   */
  watchProjectFiles?: (projectId: string, onChange: () => void) => () => void;
  /** Resolve the project's current deliverable and root without a run-scoped gate. */
  resolveProjectDeliverable?: (
    projectId: string,
  ) => Promise<{ deliverable: NextoreDeliverableSnapshot; projectRoot: string }>;
  /** Debounce for out-of-run edits; defaults to 1500 ms. */
  fileChangeDebounceMs?: number;
  /** Absolute project root, needed to requeue a drifted artifact. */
  resolveProjectRoot?: (projectId: string) => string | null;
  /** Interval between reconciliation sweeps; defaults to 15 minutes. */
  reconcileIntervalMs?: number;
  /** Projects reconciled per sweep; defaults to 5. */
  reconcileBatchSize?: number;
  /** Delay between two project reconciles in one sweep; defaults to 250 ms. */
  reconcileSpacingMs?: number;
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
  private readonly watchers = new Map<string, () => void>();
  private readonly fileTimers = new Map<string, NodeJS.Timeout>();
  private readonly projectMembers = new Map<string, number>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconcileCursor = 0;

  constructor(private readonly deps: NextoreArtifactRuntimeDeps) {
    // Reconcile and backfill need the member a project publishes as. That map
    // used to be filled only by a run in this process, so a restart left every
    // project unreconcilable — exactly when a rollout runs.
    try {
      for (const row of listProjectMembers(this.deps.db)) {
        this.projectMembers.set(row.projectId, row.memberId);
      }
    } catch {
      // The store is created lazily; a failure here must not stop the runtime.
    }
  }

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
    if (artifacts.length > 0) {
      this.projectMembers.set(input.projectId, input.memberId);
      rememberProjectMember(this.deps.db, input.projectId, input.memberId, now());
      this.watchProject(input.projectId);
    }
    if (artifacts.length > 0 && this.deps.autoDrain !== false) void this.wake();
    return artifacts.length;
  }

  /**
   * Watch a project for edits made outside a Run. Only representations that
   * were already published (or queued) are republished, so a stray edit cannot
   * invent a new artifact id. The publisher still compares content hashes, so a
   * touch that changes nothing stays a no-op.
   */
  watchProject(projectId: string): void {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return;
    if (!this.deps.watchProjectFiles || this.watchers.has(projectId)) return;
    const dispose = this.deps.watchProjectFiles(projectId, () => {
      this.scheduleFileChangePublish(projectId);
    });
    this.watchers.set(projectId, dispose);
  }

  /** Stop every out-of-run watcher (shutdown and tests). */
  unwatchAll(): void {
    for (const dispose of this.watchers.values()) {
      try {
        dispose();
      } catch {
        // A watcher that already failed must not block the rest of shutdown.
      }
    }
    this.watchers.clear();
    for (const timer of this.fileTimers.values()) clearTimeout(timer);
    this.fileTimers.clear();
  }

  private scheduleFileChangePublish(projectId: string): void {
    const memberId = this.projectMembers.get(projectId);
    if (!memberId) return;
    const pending = this.fileTimers.get(projectId);
    if (pending) clearTimeout(pending);
    const delay = this.deps.fileChangeDebounceMs ?? 1_500;
    const timer = setTimeout(() => {
      this.fileTimers.delete(projectId);
      void this.publishProjectDeliverable(projectId, memberId);
    }, delay);
    timer.unref?.();
    this.fileTimers.set(projectId, timer);
  }

  private async publishProjectDeliverable(projectId: string, memberId: number): Promise<void> {
    const resolve = this.deps.resolveProjectDeliverable;
    if (!resolve) return;
    let resolved: { deliverable: NextoreDeliverableSnapshot; projectRoot: string };
    try {
      resolved = await resolve(projectId);
    } catch {
      return;
    }
    const { deliverable, projectRoot } = resolved;
    if (!deliverable.valid || !deliverable.entryFile) return;

    const entry = deliverable.entryFile.replaceAll('\\', '/');
    const records = listNextoreArtifacts(this.deps.db, projectId)
      .filter((row) => row.representation === 'source');
    const match = records.find((row) => row.relativePath === entry)
      ?? (records.length === 1 ? records[0] : null);
    if (!match) return;

    const artifacts = resolvePublishableArtifacts({
      projectId,
      artifactId: match.artifactId,
      runId: null,
      tier: null,
      deliverable,
    });
    if (artifacts.length === 0) return;
    const now = this.deps.now ?? Date.now;
    for (const artifact of artifacts) {
      enqueueNextorePublish(this.deps.db, {
        projectId: artifact.projectId,
        artifactId: artifact.artifactId,
        representation: artifact.representation,
        memberId,
        runId: null,
        tier: null,
        relativePath: artifact.relativePath,
        sourcePath: path.resolve(projectRoot, artifact.sourcePath),
        name: artifact.name,
        mimeType: artifact.mimeType,
        reason: 'file-change',
        now: now(),
      });
    }
    if (this.deps.autoDrain !== false) void this.wake();
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
    const reconcileEvery = this.deps.reconcileIntervalMs ?? 15 * 60_000;
    this.reconcileTimer = setInterval(() => {
      void this.reconcileSweepOnce();
    }, reconcileEvery);
    this.reconcileTimer.unref?.();
    void this.drainOnce();
  }

  /**
   * Reconcile a bounded slice of the projects this process has published for.
   *
   * P04h: a sweep must never hammer the module. It walks the member list
   * round-robin, reconciles at most `reconcileBatchSize` projects, and leaves
   * the rest for the next tick.
   */
  /** One bounded sweep. Public so ops surfaces and tests can drive it. */
  async reconcileSweepOnce(): Promise<number> {
    const projects = [...this.projectMembers.keys()];
    if (projects.length === 0) return 0;
    const batchSize = Math.max(1, this.deps.reconcileBatchSize ?? 5);
    const spacing = Math.max(0, this.deps.reconcileSpacingMs ?? 250);
    const start = this.reconcileCursor % projects.length;
    const slice = projects.slice(start, start + batchSize);
    if (slice.length < batchSize && projects.length > slice.length) {
      slice.push(...projects.slice(0, Math.min(batchSize - slice.length, start)));
    }
    for (let i = 0; i < slice.length; i += 1) {
      if (i > 0 && spacing > 0) {
        await new Promise((resolve) => setTimeout(resolve, spacing));
      }
      await this.reconcileProject(slice[i]!).catch(() => null);
    }
    this.reconcileCursor = (start + slice.length) % projects.length;
    return slice.length;
  }

  /**
   * Compare one project's mapping against the module. Returns null when the
   * daemon cannot reconcile yet (no member, no mapping, no session).
   */
  async reconcileProject(projectId: string): Promise<ReconcileProjectResult | null> {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return null;
    const memberId = this.projectMembers.get(projectId);
    const nextoreProjectId = this.deps.readProjectMapping?.(projectId) ?? null;
    const projectRoot = this.deps.resolveProjectRoot?.(projectId) ?? null;
    if (!memberId || !nextoreProjectId || !projectRoot) return null;
    const accessToken = await this.accessTokenFor(memberId);
    if (!accessToken) return null;
    return reconcileProjectArtifacts({
      db: this.deps.db,
      client: this.deps.client,
      projectId,
      nextoreProjectId,
      accessToken,
      projectRoot,
      memberId,
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    this.unwatchAll();
    this.projectMembers.clear();
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

  /** Every representation mapping the daemon holds for one project. */
  artifacts(projectId: string): NextoreArtifactRecord[] {
    return listNextoreArtifacts(this.deps.db, projectId);
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
