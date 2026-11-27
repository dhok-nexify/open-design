import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNotificationOutboxDelivery,
  enqueueCommentNotification,
  listDueNotifications,
  migrateNextoreNotificationOutbox,
} from '../src/nextore/notification-outbox.js';
import type { CommentNoticeInput } from '../src/nextore/comment-notify.js';

const notice = (id: string): CommentNoticeInput => ({
  projectId: 'p1',
  nextoreProjectId: '4242',
  commentId: id,
  authorMemberId: 7,
  isReply: false,
  projectName: 'Landing',
  commentText: 'hello',
  createdAt: '2026-11-27T00:00:00.000Z',
  recipientIds: [],
});

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  migrateNextoreNotificationOutbox(db);
});

afterEach(() => {
  db.close();
});

describe('notification outbox', () => {
  it('writes the trigger inside a transaction and survives a reopen', () => {
    db.transaction(() => {
      db.prepare('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY)').run();
      db.prepare('INSERT INTO comments (id) VALUES (?)').run('c1');
      enqueueCommentNotification(db, notice('c1'), 1000);
    })();

    expect(listDueNotifications(db, 1000)).toHaveLength(1);
    expect(listDueNotifications(db, 999)).toHaveLength(0);
  });

  it('is idempotent by project and comment id', () => {
    enqueueCommentNotification(db, notice('c1'), 1000);
    enqueueCommentNotification(db, notice('c1'), 2000);
    expect(listDueNotifications(db, 5000)).toHaveLength(1);
  });

  it('retries transient failures with backoff and dead-letters permanent ones', async () => {
    let now = 1000;
    enqueueCommentNotification(db, notice('c1'), now);
    const notify = vi.fn(async () => 'failed' as const);
    const delivery = createNotificationOutboxDelivery({
      db, now: () => now, notify, maxAttempts: 3,
    });

    await delivery.processDue();
    expect(listDueNotifications(db, now)).toHaveLength(0);
    expect(listDueNotifications(db, now + 1000)).toHaveLength(1);

    now += 1000;
    await delivery.processDue();
    now += 5000;
    await delivery.processDue();

    const rows = db.prepare('SELECT attempts, delivered_at AS deliveredAt, last_error AS lastError FROM nextore_notification_outbox').all() as Array<{
      attempts: number; deliveredAt: number | null; lastError: string | null;
    }>;
    expect(rows[0]).toMatchObject({ attempts: 3, lastError: 'dead_letter' });
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('marks a decided notification delivered so it is never retried', async () => {
    enqueueCommentNotification(db, notice('c1'), 1000);
    const delivery = createNotificationOutboxDelivery({
      db, now: () => 1000, notify: async () => 'skipped',
    });
    await delivery.processDue();
    expect(listDueNotifications(db, 100_000)).toHaveLength(0);
  });
});
