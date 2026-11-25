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
  findPublishMember,
  listNextoreArtifacts,
  listProjectMembers,
  listWatchableArtifactProjectIds,
  listPublishProjectMembers,
  rememberProjectMember,
  retryNextorePublish,
} from './store.js';
import {
  hashFileSha256,
  hashFileSha256Sync,
  publishArtifactJob,
  type PublishOutcomeStatus,
} from './publisher.js';
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

/** The kinds a project file watcher reports, mirrored here so this module does
 * not import the chokidar-backed watcher. */
export type NextoreFileChangeKind = 'add' | 'change' | 'unlink';

/** A hash is only an optimisation hint here: an unreadable file must still enqueue. */
async function hashQuietly(filePath: string): Promise<string | null> {
  try {
    return await hashFileSha256(filePath);
  } catch {
    return null;
  }
}

function hashQuietlySync(filePath: string): string | null {
  try {
    return hashFileSha256Sync(filePath);
  } catch {
    return null;
  }
}

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
  watchProjectFiles?: (
    projectId: string,
    onChange: (changed: ReadonlyArray<{ path: string; kind: NextoreFileChangeKind }>) => void,
  ) => () => void;
  /** Resolve the project's current deliverable and root without a run-scoped gate. */
  resolveProjectDeliverable?: (
    projectId: string,
  ) => Promise<{ deliverable: NextoreDeliverableSnapshot; projectRoot: string }>;
  /**
   * Last resort for out-of-run publishing: a signed-in member who may edit the
   * project, used only when no publisher was ever recorded for it.
   */
  resolveFallbackMember?: (projectId: string) => Promise<number | null>;
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
  private readonly pendingFileChanges = new Map<string, Map<string, NextoreFileChangeKind>>();
  private readonly projectMembers = new Map<string, number>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconcileCursor = 0;

  constructor(private readonly deps: NextoreArtifactRuntimeDeps) {
    // Reconcile and backfill need the member a project publishes as. That map
    // used to be filled only by a run in this process, so a restart left every
    // project unreconcilable — exactly when a rollout runs.
    try {
      for (const row of listPublishProjectMembers(this.deps.db)) {
        this.projectMembers.set(row.projectId, row.memberId);
      }
      // A row written by the newer code wins: it is the member a run actually
      // published as, while the queue may only remember an older attempt.
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
      const sourcePath = path.resolve(input.projectRoot, artifact.sourcePath);
      enqueueNextorePublish(this.deps.db, {
        projectId: artifact.projectId,
        artifactId: artifact.artifactId,
        representation: artifact.representation,
        memberId: input.memberId,
        runId: input.runId,
        tier: input.tier,
        relativePath: artifact.relativePath,
        sourcePath,
        name: artifact.name,
        mimeType: artifact.mimeType,
        reason: 'run-complete',
        now: now(),
        contentHash: hashQuietlySync(sourcePath),
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
    const dispose = this.deps.watchProjectFiles(projectId, (changed) => {
      this.scheduleFileChangePublish(projectId, changed);
    });
    this.watchers.set(projectId, dispose);
  }

  /**
   * Start an out-of-run watcher for every project that already has artifact rows.
   *
   * Watching is per project tree, so the cost is bounded by the number of
   * projects that actually publish, not by the number of projects on disk. A
   * project whose tree cannot be watched is skipped; the next publish for it
   * starts a watcher again.
   */
  restoreWatchers(): number {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode) || !this.deps.watchProjectFiles) return 0;
    let restored = 0;
    for (const projectId of listWatchableArtifactProjectIds(this.deps.db)) {
      try {
        this.watchProject(projectId);
        restored += 1;
      } catch {
        // Leave the project unwatched rather than failing startup.
      }
    }
    return restored;
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

  /**
   * Debounce an out-of-run edit, remembering which files moved.
   *
   * The watcher fires once per burst, so the batch is the only record of what
   * changed. Without it a publish could only ever target the project's entry
   * file, which is why an HTML page uploaded into a project used to sit in the
   * project folder with no artifact row and no way to download it.
   */
  private scheduleFileChangePublish(
    projectId: string,
    changed: ReadonlyArray<{ path: string; kind: NextoreFileChangeKind }> = [],
  ): void {
    let batch = this.pendingFileChanges.get(projectId);
    if (!batch) {
      batch = new Map();
      this.pendingFileChanges.set(projectId, batch);
    }
    for (const change of changed) {
      if (!change || typeof change.path !== 'string' || change.path.length === 0) continue;
      batch.set(change.path, change.kind);
    }
    const pending = this.fileTimers.get(projectId);
    if (pending) clearTimeout(pending);
    const delay = this.deps.fileChangeDebounceMs ?? 1_500;
    const timer = setTimeout(() => {
      this.fileTimers.delete(projectId);
      const settled = [...(this.pendingFileChanges.get(projectId) ?? new Map())]
        .map(([path, kind]) => ({ path, kind }));
      this.pendingFileChanges.delete(projectId);
      void this.publishProjectAfterChange(projectId, settled);
    }, delay);
    timer.unref?.();
    this.fileTimers.set(projectId, timer);
  }

  /**
   * Publish after an out-of-run edit, resolving whose session to use.
   *
   * A recorded publisher is preferred. A project published before the daemon
   * kept that record has none, so a signed-in member who may edit the project
   * stands in and the choice is remembered for later edits. Only when nothing
   * can be resolved is the change dropped - with a log line naming the reason.
   */
  private async publishProjectAfterChange(
    projectId: string,
    changed: ReadonlyArray<{ path: string; kind: NextoreFileChangeKind }> = [],
  ): Promise<void> {
    let memberId: number | null = this.projectMembers.get(projectId)
      ?? findPublishMember(this.deps.db, projectId)
      ?? null;
    if (!memberId && this.deps.resolveFallbackMember) {
      try {
        memberId = await this.deps.resolveFallbackMember(projectId);
      } catch {
        memberId = null;
      }
      if (memberId) {
        const at = (this.deps.now ?? Date.now)();
        this.projectMembers.set(projectId, memberId);
        rememberProjectMember(this.deps.db, projectId, memberId, at);
      }
    }
    if (!memberId) {
      console.warn(
        '[nextore-artifact] file change ignored project=' + projectId
          + ': no signed-in member may edit this project',
      );
      return;
    }
    // A batch that names its own files publishes exactly those; the entry-file
    // path stays as the fallback for a burst that names nothing usable.
    if (await this.publishChangedFiles(projectId, memberId, changed)) return;
    await this.publishProjectDeliverable(projectId, memberId);
  }

  /**
   * Publish the files a watcher batch named.
   *
   * An existing artifact row is republished in place. A file with no row is
   * adopted only when it first appears ('add') and only when it is an HTML page
   * outside the daemon's own dot-directories, so a stray edit can never invent
   * an artifact id and a bulk write cannot re-adopt the whole tree on every
   * change.
   */
  private async publishChangedFiles(
    projectId: string,
    memberId: number,
    changed: ReadonlyArray<{ path: string; kind: NextoreFileChangeKind }>,
  ): Promise<number> {
    if (changed.length === 0) return 0;
    const resolveRoot = this.deps.resolveProjectRoot;
    if (!resolveRoot) return 0;
    const projectRoot = resolveRoot(projectId);
    if (!projectRoot) return 0;

    const sourceRows = listNextoreArtifacts(this.deps.db, projectId)
      .filter((row) => row.representation === 'source');
    const now = this.deps.now ?? Date.now;
    let enqueued = 0;

    for (const change of changed) {
      const relativePath = change.path.replaceAll('\\', '/');
      if (change.kind === 'unlink') continue;
      if (!/\.html?$/iu.test(relativePath)) continue;
      if (relativePath.split('/').some((segment) => segment.startsWith('.'))) continue;
      const row = sourceRows.find((candidate) => candidate.relativePath === relativePath);
      if (!row && change.kind !== 'add') continue;
      const reason = row ? 'file-change' : 'file-adopted';

      const artifacts = resolvePublishableArtifacts({
        projectId,
        artifactId: row?.artifactId ?? relativePath,
        runId: null,
        tier: null,
        deliverable: {
          valid: true,
          entryFile: relativePath,
          artifactKind: 'html',
          linkedPage: null,
        },
      });
      for (const artifact of artifacts) {
        const sourcePath = path.resolve(projectRoot, artifact.sourcePath);
        enqueueNextorePublish(this.deps.db, {
          projectId: artifact.projectId,
          artifactId: artifact.artifactId,
          representation: artifact.representation,
          memberId,
          runId: null,
          tier: null,
          relativePath: artifact.relativePath,
          sourcePath,
          name: artifact.name,
          mimeType: artifact.mimeType,
          reason,
          now: now(),
          contentHash: await hashQuietly(sourcePath),
        });
        enqueued += 1;
        console.log(
          '[nextore-artifact] publish enqueue project=' + artifact.projectId
            + ' artifact=' + artifact.artifactId
            + ' rep=' + artifact.representation
            + ' reason=' + reason
            + ' member=' + memberId,
        );
      }
    }
    if (enqueued > 0 && this.deps.autoDrain !== false) void this.wake();
    return enqueued;
  }

  private async publishProjectDeliverable(projectId: string, memberId: number): Promise<void> {
    const resolve = this.deps.resolveProjectDeliverable;
    if (!resolve) return;
    let resolved: { deliverable: NextoreDeliverableSnapshot; projectRoot: string };
    try {
      resolved = await resolve(projectId);
    } catch (error) {
      console.warn(
        '[nextore-artifact] file change ignored project=' + projectId
          + ': deliverable resolution failed (' + (error instanceof Error ? error.message : String(error)) + ')',
      );
      return;
    }
    const { deliverable, projectRoot } = resolved;
    if (!deliverable.valid || !deliverable.entryFile) {
      console.warn(
        '[nextore-artifact] file change ignored project=' + projectId
          + ': the project has no valid deliverable entry file',
      );
      return;
    }

    const entry = deliverable.entryFile.replaceAll('\\', '/');
    const records = listNextoreArtifacts(this.deps.db, projectId)
      .filter((row) => row.representation === 'source');
    const match = records.find((row) => row.relativePath === entry)
      ?? (records.length === 1 ? records[0] : null);
    if (!match) {
      console.warn(
        '[nextore-artifact] file change ignored project=' + projectId
          + ': no published source artifact matches entry=' + entry,
      );
      return;
    }

    const artifacts = resolvePublishableArtifacts({
      projectId,
      artifactId: match.artifactId,
      runId: null,
      tier: null,
      deliverable,
    });
    if (artifacts.length === 0) {
      console.warn(
        '[nextore-artifact] file change ignored project=' + projectId
          + ': the artifact registry returned no publishable representation for entry=' + entry,
      );
      return;
    }
    const now = this.deps.now ?? Date.now;
    for (const artifact of artifacts) {
      const sourcePath = path.resolve(projectRoot, artifact.sourcePath);
      enqueueNextorePublish(this.deps.db, {
        projectId: artifact.projectId,
        artifactId: artifact.artifactId,
        representation: artifact.representation,
        memberId,
        runId: null,
        tier: null,
        relativePath: artifact.relativePath,
        sourcePath,
        name: artifact.name,
        mimeType: artifact.mimeType,
        reason: 'file-change',
        now: now(),
        contentHash: await hashQuietly(sourcePath),
      });
      console.log(
        '[nextore-artifact] publish enqueue project=' + artifact.projectId
          + ' artifact=' + artifact.artifactId
          + ' rep=' + artifact.representation
          + ' reason=file-change member=' + memberId,
      );
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
          // A project that just published must keep tracking later edits, even
          // when the publish came from reconcile/adoption rather than a run.
          if (outcome?.status === 'published') {
            const at = (this.deps.now ?? Date.now)();
            this.projectMembers.set(tick.claimed.projectId, tick.claimed.memberId);
            rememberProjectMember(this.deps.db, tick.claimed.projectId, tick.claimed.memberId, at);
            try {
              this.watchProject(tick.claimed.projectId);
            } catch {
              // Publishing stays successful; the next start() retries watching.
            }
          }
        },
      });
      return result.processed;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 5_000): void {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode) || this.timer) return;
    // A restart used to forget every out-of-run watcher until the next run
    // finished, so edits made in between were never republished. Resume them
    // from the durable mapping rows before the first drain.
    this.restoreWatchers();
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
  async reconcileProject(
    projectId: string,
    actorMemberId?: number,
  ): Promise<ReconcileProjectResult | null> {
    if (!isNextoreArtifactPublishEnabled(this.deps.mode)) return null;
    const nextoreProjectId = this.deps.readProjectMapping?.(projectId) ?? null;
    const projectRoot = this.deps.resolveProjectRoot?.(projectId) ?? null;
    if (!nextoreProjectId || !projectRoot) {
      // Nothing to migrate: the project was never linked to NexTore, or its
      // folder is gone. Retrying cannot change that, so say so.
      return { adopted: 0, requeued: 0, orphaned: 0, skipped: 0, unavailable: false, notApplicable: true };
    }

    // The member who published most recently may have no live session (an
    // editor edited the file weeks ago), so every candidate is tried until one
    // yields a usable credential. The operator running a backfill is the last
    // candidate: they are asking for the project to be reconciled right now.
    const candidates: number[] = [];
    const known = this.projectMembers.get(projectId);
    if (known) candidates.push(known);
    const fromQueue = findPublishMember(this.deps.db, projectId);
    if (fromQueue) candidates.push(fromQueue);
    if (Number.isInteger(actorMemberId) && (actorMemberId ?? 0) > 0) {
      candidates.push(actorMemberId!);
    }

    let memberId: number | null = null;
    let accessToken: string | null = null;
    for (const candidate of new Set(candidates)) {
      const token = await this.accessTokenFor(candidate);
      if (token) {
        memberId = candidate;
        accessToken = token;
        break;
      }
    }
    if (!memberId || !accessToken) return null;
    this.projectMembers.set(projectId, memberId);
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

  /**
   * Queue a rendered snapshot for publication. The renderer runs in the route
   * (it is slow IO); the runtime only owns the durable queue row and the drain.
   */
  queueSnapshot(input: {
    projectId: string;
    artifactId: string;
    memberId: number;
    relativePath: string;
    sourcePath: string;
    name: string;
    mimeType: string;
    contentHash?: string | null;
  }): void {
    const now = this.deps.now ?? Date.now;
    enqueueNextorePublish(this.deps.db, {
      projectId: input.projectId,
      artifactId: input.artifactId,
      representation: 'snapshot',
      memberId: input.memberId,
      runId: null,
      tier: null,
      relativePath: input.relativePath,
      sourcePath: input.sourcePath,
      name: input.name,
      mimeType: input.mimeType,
      reason: 'snapshot-request',
      now: now(),
      contentHash: input.contentHash ?? null,
    });
    void this.wake();
  }

  /** Absolute project root, or null when the project folder is gone. */
  projectRoot(projectId: string): string | null {
    return this.deps.resolveProjectRoot?.(projectId) ?? null;
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
