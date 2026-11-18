import type Database from 'better-sqlite3';
import type {
  NextoreArtifactRepresentationStatus,
  NextoreArtifactStatusResponse,
  NextorePublishQueueItem,
} from '@open-design/contracts';

import { listNextoreArtifacts, listNextorePublishQueue } from './store.js';

type SqliteDb = Database.Database;

function queueSummary(items: readonly NextorePublishQueueItem[]): {
  pending: boolean;
  attempts: number;
  nextAttemptAt: number | null;
  deadLettered: boolean;
  lastError: string | null;
} {
  if (items.length === 0) {
    return {
      pending: false,
      attempts: 0,
      nextAttemptAt: null,
      deadLettered: false,
      lastError: null,
    };
  }
  const due = items
    .map((item) => item.nextAttemptAt)
    .filter((value): value is number => typeof value === 'number');
  return {
    pending: items.some((item) => item.deadLetteredAt === null),
    attempts: Math.max(...items.map((item) => item.attempts)),
    nextAttemptAt: due.length > 0 ? Math.min(...due) : null,
    deadLettered: items.some((item) => item.deadLetteredAt !== null),
    lastError: items.find((item) => item.lastError)?.lastError ?? null,
  };
}

/**
 * Status is derived from the mapping and queue tables; it is never a second source of truth.
 * Share readiness is filled by P04e after the snapshot representation is published.
 */
export function buildNextoreArtifactStatus(
  db: SqliteDb,
  projectId: string,
  artifactId: string,
): NextoreArtifactStatusResponse {
  const records = listNextoreArtifacts(db, projectId, artifactId);
  const queue = listNextorePublishQueue(db, projectId);
  const representations: NextoreArtifactRepresentationStatus[] = records.map((record) => ({
    representation: record.representation,
    artifact: record,
    queue: queueSummary(queue.filter(
      (item) => item.artifactId === artifactId && item.representation === record.representation,
    )),
    share: null,
  }));
  return { projectId, artifactId, representations };
}
