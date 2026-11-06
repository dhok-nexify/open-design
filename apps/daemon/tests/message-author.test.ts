import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
  getMessage,
  insertConversation,
  insertProject,
  listMessages,
  openDatabase,
  upsertMessage,
} from '../src/db.js';

/**
 * The NexTore edition records who wrote each user turn (NXD-D11): the column
 * survives a reload, an update to the same row keeps it, and assistant rows
 * stay authorless because the agent produced them.
 */
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-msg-author-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function seed(db: ReturnType<typeof openDatabase>) {
  const now = Date.now();
  insertProject(db, { id: 'p1', name: 'P', createdAt: now, updatedAt: now });
  insertConversation(db, { id: 'c1', projectId: 'p1', title: 'T', createdAt: now, updatedAt: now });
}

describe('message author', () => {
  it('persists and reads back the author of a user turn', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seed(db);
    upsertMessage(db, 'c1', { id: 'm1', role: 'user', content: 'hi', authorMemberId: 42 });

    expect(listMessages(db, 'c1').find((m) => m.id === 'm1')?.authorMemberId).toBe(42);
    expect(getMessage(db, 'm1', 'c1')?.authorMemberId).toBe(42);
  });

  it('keeps the stored author when the row is rewritten', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seed(db);
    upsertMessage(db, 'c1', { id: 'm1', role: 'user', content: 'hi', authorMemberId: 42 });
    upsertMessage(db, 'c1', { id: 'm1', role: 'user', content: 'hi again' });

    expect(getMessage(db, 'm1', 'c1')?.authorMemberId).toBe(42);
  });

  it('leaves assistant rows without an author', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seed(db);
    upsertMessage(db, 'c1', { id: 'a1', role: 'assistant', content: '', runId: 'r1' });

    expect(getMessage(db, 'a1', 'c1')?.authorMemberId).toBeUndefined();
  });

  it('migrates an existing database that predates the column', () => {
    const first = openDatabase(tempDir, { dataDir: tempDir });
    seed(first);
    upsertMessage(first, 'c1', { id: 'm1', role: 'user', content: 'hi' });
    closeDatabase();

    const reopened = openDatabase(tempDir, { dataDir: tempDir });
    expect(getMessage(reopened, 'm1', 'c1')?.authorMemberId).toBeUndefined();
    upsertMessage(reopened, 'c1', { id: 'm2', role: 'user', content: 'hi', authorMemberId: 7 });
    expect(getMessage(reopened, 'm2', 'c1')?.authorMemberId).toBe(7);
  });
});
