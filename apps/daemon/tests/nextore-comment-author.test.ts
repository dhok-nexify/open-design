import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  getPreviewComment,
  insertConversation,
  insertProject,
  listPreviewComments,
  openDatabase,
  updatePreviewCommentStatus,
  upsertPreviewComment,
} from '../src/db.js';
import { previewCommentToCloud } from '../src/collab/collab-cloud-service.js';
import { registerProjectCommentRoutes } from '../src/routes/project/comments.js';

// NEXTORE (NXD-D22): a comment's author in the edition is a NexTore member id,
// stored in its own column beside the upstream workspaceMemberId. Comments are
// author-only to edit, delete or re-status, handing one to the agent needs
// project edit rights, and the id never reaches the upstream relay payload.

const PROJECT = 'p1';
const CONVERSATION = 'conv-1';
const MEMBER = 7;
const OTHER = 8;

let server: http.Server | null = null;
let tempDir: string | null = null;

afterEach(async () => {
  if (server) {
    const toClose = server;
    server = null;
    await new Promise<void>((resolve) => toClose.close(() => resolve()));
  }
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function target() {
  return {
    filePath: 'index.html',
    elementId: 'hero',
    selector: '[data-od-id="hero"]',
    label: 'h1.hero',
    text: 'Hero',
    position: { x: 0, y: 0, width: 10, height: 10 },
    htmlHint: '<h1>',
  };
}

function seedDatabase(dir: string) {
  const db = openDatabase(dir);
  insertProject(db, { id: PROJECT, name: 'Project', createdAt: 1, updatedAt: 1 });
  insertConversation(db, {
    id: CONVERSATION,
    projectId: PROJECT,
    title: 'Chat',
    createdAt: 1,
    updatedAt: 1,
  });
  return db;
}

async function startServer({ canWrite = true }: { canWrite?: boolean } = {}) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-nextore-comment-'));
  const db = seedDatabase(tempDir);
  const projectWrites: Array<Record<string, unknown>> = [];

  const app = express();
  app.use(express.json());
  // The edition gate attaches the session to res.locals; this stands in for it.
  app.use((req, res, next) => {
    const header = req.headers['x-test-nextore-member'];
    if (typeof header === 'string' && header) {
      (res.locals as { nextoreSession?: { memberId: number } }).nextoreSession = {
        memberId: Number(header),
      };
    }
    next();
  });
  registerProjectCommentRoutes(app, {
    db,
    projectStore: {
      updateProject: () => undefined,
      getWorkspaceProject: () => null,
      getWorkspaceProjectByProjectId: () => null,
    } as any,
    conversations: {
      getConversation: () => ({ id: CONVERSATION, projectId: PROJECT }),
      listPreviewComments,
      upsertPreviewComment,
      getPreviewComment,
      updatePreviewCommentStatus,
      updatePreviewCommentAnchor: () => null,
      deletePreviewComment: () => true,
      reorderPreviewComment: () => null,
    } as any,
    // No workspace identity: the edition never has one.
    isSharedProject: async () => false,
    authorizeProjectRequest: async (_req, res, _projectId, options) => {
      projectWrites.push(options as unknown as Record<string, unknown>);
      if (canWrite) return true;
      // Mirrors the real authorizer, which writes the denial itself.
      (res as any).status(403).json({ error: 'forbidden' });
      return false;
    },
    telemetry: {
      captureProductEvent: () => undefined,
    } as any,
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  const base = `http://127.0.0.1:${address.port}`;

  async function json(
    route: string,
    options: { method?: string; body?: unknown; nextoreMember?: number } = {},
  ) {
    const headers: Record<string, string> = {};
    const init: RequestInit = { method: options.method ?? 'GET', headers };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (typeof options.nextoreMember === 'number') {
      headers['x-test-nextore-member'] = String(options.nextoreMember);
    }
    const response = await fetch(`${base}${route}`, init);
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : {} };
  }

  return { db, json, projectWrites, route: `/api/projects/${PROJECT}/conversations/${CONVERSATION}/comments` };
}

describe('NexTore comment authorship (NXD-D22)', () => {
  it('stores the caller member id beside the upstream author column', async () => {
    const api = await startServer();
    const created = await api.json(api.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'first note' },
    });
    expect(created.status).toBe(200);
    expect(created.body.comment.authorNextoreMemberId).toBe(MEMBER);
    expect(created.body.comment.authorMemberId).toBeUndefined();

    const stored = listPreviewComments(api.db, PROJECT, CONVERSATION) as Array<{
      authorNextoreMemberId?: number;
      authorMemberId?: string;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.authorNextoreMemberId).toBe(MEMBER);
    expect(stored[0]?.authorMemberId).toBeUndefined();
  });

  it('refuses an edit by another member and keeps the original author', async () => {
    const api = await startServer();
    const created = await api.json(api.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'mine' },
    });
    const id = created.body.comment.id as string;

    const hijack = await api.json(api.route, {
      method: 'POST',
      nextoreMember: OTHER,
      body: { target: target(), note: 'hijacked', id },
    });
    expect(hijack.status).toBe(403);

    const edit = await api.json(api.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'edited', id, authorNextoreMemberId: OTHER },
    });
    expect(edit.status).toBe(200);
    expect(edit.body.comment.note).toBe('edited');
    expect(edit.body.comment.authorNextoreMemberId).toBe(MEMBER);
  });

  it('lets only the author change status', async () => {
    const api = await startServer();
    const created = await api.json(api.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'mine' },
    });
    const id = created.body.comment.id as string;

    const other = await api.json(`${api.route}/${id}`, {
      method: 'PATCH',
      nextoreMember: OTHER,
      body: { status: 'resolved' },
    });
    expect(other.status).toBe(403);

    const mine = await api.json(`${api.route}/${id}`, {
      method: 'PATCH',
      nextoreMember: MEMBER,
      body: { status: 'resolved' },
    });
    expect(mine.status).toBe(200);
    expect(mine.body.comment.status).toBe('resolved');
  });

  it('denies handing a note to the agent without project edit rights', async () => {
    const readonly = await startServer({ canWrite: false });
    const created = await readonly.json(readonly.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'send me' },
    });
    const id = created.body.comment.id as string;
    const sent = await readonly.json(`${readonly.route}/${id}`, {
      method: 'PATCH',
      nextoreMember: MEMBER,
      body: { status: 'applying' },
    });
    expect(sent.status).toBe(403);
    expect(readonly.projectWrites).toHaveLength(1);
  });

  it('allows handing a note to the agent with project edit rights', async () => {
    const writable = await startServer({ canWrite: true });
    const created2 = await writable.json(writable.route, {
      method: 'POST',
      nextoreMember: MEMBER,
      body: { target: target(), note: 'send me too' },
    });
    const id2 = created2.body.comment.id as string;
    const sent2 = await writable.json(`${writable.route}/${id2}`, {
      method: 'PATCH',
      nextoreMember: MEMBER,
      body: { status: 'applying' },
    });
    expect(sent2.status).toBe(200);
    expect(sent2.body.comment.status).toBe('applying');
  });

  it('keeps the NexTore id out of the upstream relay payload', () => {
    const cloud = previewCommentToCloud(
      {
        id: 'c1',
        projectId: PROJECT,
        conversationId: CONVERSATION,
        filePath: 'index.html',
        elementId: 'hero',
        selector: '[data-od-id="hero"]',
        label: 'h1.hero',
        text: 'Hero',
        htmlHint: '<h1>',
        position: { x: 0, y: 0, width: 10, height: 10 },
        note: 'note',
        status: 'open',
        createdAt: 1,
        updatedAt: 1,
        authorNextoreMemberId: MEMBER,
      } as any,
      'workspace-member',
    );
    expect(JSON.stringify(cloud)).not.toContain(String(MEMBER));
  });
});

// The legacy multi-per-element rebuild drops and recreates preview_comments, so
// the NexTore author column has to be part of that rebuild or an old database
// would silently lose it on the upgrade that introduces it.
describe('NexTore comment author migration', () => {
  it('survives the legacy preview_comments rebuild', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-nextore-comment-legacy-'));
    const legacy = seedDatabase(tempDir);
    legacy.exec(`
      DROP TABLE preview_comments;
      CREATE TABLE preview_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        element_id TEXT NOT NULL,
        selector TEXT NOT NULL,
        label TEXT NOT NULL,
        text TEXT NOT NULL,
        position_json TEXT NOT NULL,
        html_hint TEXT NOT NULL,
        selection_kind TEXT,
        member_count INTEGER,
        pod_members_json TEXT,
        style_json TEXT,
        attachments_json TEXT,
        slide_index INTEGER,
        slide_key INTEGER NOT NULL DEFAULT -1,
        note TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        anchor_state TEXT,
        anchored_version INTEGER,
        author_member_id TEXT,
        last_good_position_json TEXT,
        UNIQUE(project_id, conversation_id, file_path, element_id, slide_index, author_member_id)
      );
      INSERT INTO preview_comments
        (id, project_id, conversation_id, file_path, element_id, selector, label, text,
         position_json, html_hint, note, status, created_at, updated_at)
      VALUES ('legacy-1', '${PROJECT}', '${CONVERSATION}', 'index.html', 'hero',
              '[data-od-id="hero"]', 'h1.hero', 'Hero', '{}', '<h1>',
              'legacy note', 'open', 1, 1);
    `);
    closeDatabase();

    const upgraded = openDatabase(tempDir);
    const columns = upgraded
      .prepare(`PRAGMA table_info(preview_comments)`)
      .all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain('author_nextore_member_id');
    expect(names).toContain('pin_seq');
    expect(names).toContain('sort_key');

    const kept = upgraded
      .prepare(`SELECT note FROM preview_comments WHERE id = 'legacy-1'`)
      .get() as { note: string };
    expect(kept.note).toBe('legacy note');

    const saved = upsertPreviewComment(
      upgraded,
      PROJECT,
      CONVERSATION,
      { target: target(), note: 'edition note', authorNextoreMemberId: MEMBER },
    );
    expect(saved?.authorNextoreMemberId).toBe(MEMBER);
  });
});
