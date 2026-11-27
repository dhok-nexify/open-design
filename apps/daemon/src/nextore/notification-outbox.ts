import type Database from 'better-sqlite3';

import type { CommentNoticeInput } from './comment-notify.js';
import { notifyCommentSafely, type CommentNotifyDeps } from './comment-notify.js';

type SqliteDb = Database.Database;

/**
 * Daemon-side durable trigger outbox. The notification intent is written in the
 * same SQLite transaction as the comment, then drained by a bounded worker with
 * exponential backoff and a dead-letter state.
 */

export interface NotificationOutboxRow {
  eventId: string;
  eventType: string;
  projectId: string;
  payloadJson: string;
  attempts: number;
  nextAttemptAt: number;
  deliveredAt: number | null;
  lastError: string | null;
  createdAt: number;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_notification_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    project_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    delivered_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nextore_notification_due
    ON nextore_notification_outbox (delivered_at, next_attempt_at);
`;

export function migrateNextoreNotificationOutbox(db: SqliteDb): void {
  db.exec(SCHEMA_SQL);
}

/** Stable idempotency identity: one delivery per comment, however many retries. */
export function commentNotificationEventId(projectId: string, commentId: string): string {
  return `cmt_${projectId}:${commentId}`.slice(0, 128);
}

/** Synchronous enqueue so it can run inside the comment's DB transaction. */
export function enqueueCommentNotification(
  db: SqliteDb,
  input: CommentNoticeInput,
  now: number = Date.now(),
): void {
  migrateNextoreNotificationOutbox(db);
  const eventId = commentNotificationEventId(input.projectId, input.commentId);
  db.prepare(`
    INSERT INTO nextore_notification_outbox
      (event_id, event_type, project_id, payload_json, attempts, next_attempt_at, delivered_at, last_error, created_at)
    VALUES (?, 'comment', ?, ?, 0, ?, NULL, NULL, ?)
    ON CONFLICT(event_id) DO NOTHING
  `).run(eventId, input.projectId, JSON.stringify(input), now, now);
}

export function listDueNotifications(
  db: SqliteDb,
  now: number,
  limit = 20,
): NotificationOutboxRow[] {
  migrateNextoreNotificationOutbox(db);
  return db.prepare(`
    SELECT event_id AS eventId, event_type AS eventType, project_id AS projectId,
           payload_json AS payloadJson, attempts, next_attempt_at AS nextAttemptAt,
           delivered_at AS deliveredAt, last_error AS lastError, created_at AS createdAt
      FROM nextore_notification_outbox
     WHERE delivered_at IS NULL AND next_attempt_at <= ?
     ORDER BY created_at ASC LIMIT ?
  `).all(now, limit) as NotificationOutboxRow[];
}

function backoffMs(attempts: number): number {
  const seconds = attempts <= 1 ? 1 : attempts === 2 ? 5 : attempts === 3 ? 15 : attempts === 4 ? 60 : 300;
  return seconds * 1000;
}

export function createNotificationOutboxDelivery(input: {
  db: SqliteDb;
  notify: (notice: CommentNoticeInput) => Promise<'sent' | 'skipped' | 'failed'>;
  pollIntervalMs?: number;
  maxAttempts?: number;
  now?: () => number;
  log?: (message: string) => void;
}) {
  const db = input.db;
  const now = input.now ?? Date.now;
  const pollIntervalMs = input.pollIntervalMs ?? 5_000;
  const maxAttempts = input.maxAttempts ?? 5;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function processDue(): Promise<{ sent: number; retried: number; deadLettered: number }> {
    if (running) return { sent: 0, retried: 0, deadLettered: 0 };
    running = true;
    const result = { sent: 0, retried: 0, deadLettered: 0 };
    try {
      for (const row of listDueNotifications(db, now())) {
        let notice: CommentNoticeInput;
        try {
          notice = JSON.parse(row.payloadJson) as CommentNoticeInput;
        } catch {
          db.prepare('UPDATE nextore_notification_outbox SET delivered_at = ?, last_error = ? WHERE event_id = ?')
            .run(now(), 'invalid_payload', row.eventId);
          continue;
        }

        let outcome: 'sent' | 'skipped' | 'failed';
        try {
          outcome = await input.notify(notice);
        } catch (error) {
          outcome = 'failed';
          input.log?.('[notification-outbox] delivery threw: '
            + (error instanceof Error ? error.message : String(error)));
        }

        if (outcome === 'sent') {
          db.prepare('UPDATE nextore_notification_outbox SET delivered_at = ?, last_error = NULL WHERE event_id = ?')
            .run(now(), row.eventId);
          result.sent += 1;
          continue;
        }

        // 'skipped' means the module made a permanent decision (disabled, no
        // recipients, duplicate). It is terminal, not a failure to retry.
        if (outcome === 'skipped') {
          db.prepare('UPDATE nextore_notification_outbox SET delivered_at = ?, last_error = NULL WHERE event_id = ?')
            .run(now(), row.eventId);
          result.sent += 1;
          continue;
        }

        const attempts = row.attempts + 1;
        const dead = attempts >= maxAttempts;
        db.prepare(`
          UPDATE nextore_notification_outbox
             SET attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE event_id = ?
        `).run(
          attempts,
          dead ? now() : now() + backoffMs(attempts),
          dead ? 'dead_letter' : 'delivery_failed',
          row.eventId,
        );
        if (dead) result.deadLettered += 1;
        else result.retried += 1;
      }
    } finally {
      running = false;
    }
    return result;
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void processDue().catch((error) => {
          input.log?.('[notification-outbox] sweep failed: '
            + (error instanceof Error ? error.message : String(error)));
        });
      }, pollIntervalMs);
      timer.unref?.();
      void processDue().catch(() => undefined);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    processDue,
  };
}

/** Convenience wiring helper: notify through the existing comment notifier. */
export function createCommentNotificationDelivery(deps: CommentNotifyDeps) {
  return async (notice: CommentNoticeInput) => notifyCommentSafely(deps, notice);
}
