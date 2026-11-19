import type Database from 'better-sqlite3';
import type { NextorePublishQueueItem } from '@open-design/contracts';

import {
  claimNextNextorePublish,
  completeNextorePublish,
  failNextorePublish,
  updateNextoreArtifactStatus,
} from './store.js';
import type { PublishArtifactJob, PublishOutcome } from './publisher.js';

type SqliteDb = Database.Database;

export type NextoreArtifactJobResolver =
  (item: NextorePublishQueueItem) => Promise<PublishArtifactJob | null>;

export type NextoreArtifactPublisher =
  (job: PublishArtifactJob) => Promise<PublishOutcome>;

export interface NextorePublishWorkerDeps {
  db: SqliteDb;
  workerId: string;
  resolveJob: NextoreArtifactJobResolver;
  publish: NextoreArtifactPublisher;
  now?: () => number;
  leaseMs?: number;
  maxAttempts?: number;
  backoffMs?: readonly number[];
}

export interface NextorePublishWorkerTick {
  claimed: NextorePublishQueueItem | null;
  outcome: PublishOutcome | null;
}

export interface DrainNextorePublishQueueOptions {
  maxItems?: number;
  shouldStop?: () => boolean;
  onTick?: (tick: NextorePublishWorkerTick) => void;
}

const DEFAULT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 60_000, 300_000, 900_000];

/** Build a publish job from the durable queue payload, or null when the row is incomplete. */
export function jobFromQueueItem(item: NextorePublishQueueItem): PublishArtifactJob | null {
  if (item.memberId <= 0 || !item.sourcePath || !item.name || !item.mimeType) return null;
  return {
    projectId: item.projectId,
    artifactId: item.artifactId,
    representation: item.representation,
    relativePath: item.relativePath,
    name: item.name,
    mimeType: item.mimeType,
    sourcePath: item.sourcePath,
    runId: item.runId,
    tier: item.tier,
    memberId: item.memberId,
  };
}

function retryOutcome(errorCode: string, message: string): PublishOutcome {
  return {
    status: 'publish_pending',
    version: null,
    treeObjectId: null,
    errorCode,
    message,
    retryable: true,
    contentHash: null,
  };
}

/**
 * One worker tick: claim at most one due item, publish it, and settle the queue row.
 *
 * The caller owns the loop and the per-project serialization; this function is intentionally
 * deterministic so tests can drive it with an injected clock.
 */
export async function runNextorePublishWorkerOnce(
  deps: NextorePublishWorkerDeps,
): Promise<NextorePublishWorkerTick> {
  const now = deps.now ?? Date.now;
  const item = claimNextNextorePublish(deps.db, {
    workerId: deps.workerId,
    now: now(),
    leaseMs: deps.leaseMs ?? 300_000,
  });
  if (!item) return { claimed: null, outcome: null };

  let outcome: PublishOutcome;
  try {
    const job = await deps.resolveJob(item);
    if (!job) {
      completeNextorePublish(deps.db, item.id, deps.workerId);
      return { claimed: item, outcome: null };
    }
    outcome = await deps.publish(job);
  } catch (error) {
    outcome = retryOutcome(
      'publish_failed',
      error instanceof Error ? error.message : 'Artifact publish failed.',
    );
  }
  if (outcome.status === 'failed' || outcome.status === 'publish_pending') {
    // The queue row can be settled without leaving a mapping row, so the code
    // is the only durable trace of a first-attempt refusal. Never log the
    // message: it can carry upstream text.
    console.warn('[nextore-artifact] publish ' + outcome.status
      + ' code=' + (outcome.errorCode ?? 'unknown'));
  }

  if (outcome.status === 'published' || outcome.status === 'orphaned' || !outcome.retryable) {
    completeNextorePublish(deps.db, item.id, deps.workerId);
    return { claimed: item, outcome };
  }

  const maxAttempts = deps.maxAttempts ?? 6;
  if (item.attempts >= maxAttempts) {
    const at = now();
    failNextorePublish(deps.db, {
      id: item.id,
      workerId: deps.workerId,
      error: outcome.errorCode ?? 'dead_letter',
      deadLetter: true,
      now: at,
    });
    updateNextoreArtifactStatus(deps.db, {
      projectId: item.projectId,
      artifactId: item.artifactId,
      representation: item.representation,
      status: 'failed',
      lastError: `dead_letter:${outcome.errorCode ?? 'publish_failed'}`,
      updatedAt: at,
    });
    return { claimed: item, outcome };
  }

  const backoff = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
  const delay = backoff[Math.min(item.attempts - 1, backoff.length - 1)] ?? 5_000;
  failNextorePublish(deps.db, {
    id: item.id,
    workerId: deps.workerId,
    error: outcome.message ?? outcome.errorCode ?? 'retry',
    retryAt: now() + delay,
  });
  return { claimed: item, outcome };
}

/**
 * Drain due items one at a time. Sequential processing is the simplest correct per-project
 * serialization: a project cannot have two publishes in flight, and a retry that was just
 * scheduled as not-due naturally stops the drain.
 */
export async function drainNextorePublishQueue(
  deps: NextorePublishWorkerDeps,
  options: DrainNextorePublishQueueOptions = {},
): Promise<{ processed: number }> {
  const maxItems = Math.max(1, options.maxItems ?? 100);
  let processed = 0;
  while (processed < maxItems && !options.shouldStop?.()) {
    const tick = await runNextorePublishWorkerOnce(deps);
    options.onTick?.(tick);
    if (!tick.claimed) break;
    processed += 1;
  }
  return { processed };
}
