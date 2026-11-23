import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommentFileState } from '@open-design/contracts';

import {
  closeDatabase,
  getProject,
  insertConversation,
  insertProject,
  openDatabase,
  updateProject,
  upsertPreviewComment,
} from '../../src/db.js';
import { ensureWorkspaceArtifactForPath, getLiveWorkspaceArtifactByPath } from '../../src/chat-artifacts/store.js';
import { migrateCommentPathsForRename } from '../../src/collab/comment-path-migration.js';

let root: string | undefined;
afterEach(() => {
  closeDatabase();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-comment-rename-'));
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'conv-1', projectId: 'p', title: 'C', createdAt: 1, updatedAt: 1 });
  return db;
}

function seedComment(
  db: ReturnType<typeof fixture>,
  filePath: string,
  id: string,
  conversationId = 'conv-1',
) {
  upsertPreviewComment(db, 'p', conversationId, {
    id,
    note: 'note',
    target: {
      filePath,
      elementId: 'headline',
      selector: '#headline',
      label: 'Headline',
      text: 'Hello',
      position: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<h1>Hello</h1>',
    },
  } as never);
}

function commentPaths(db: ReturnType<typeof fixture>): string[] {
  return [...db.prepare('SELECT file_path FROM preview_comments ORDER BY id').all() as Array<{ file_path: string }>]
    .map((row) => row.file_path);
}

describe('migrateCommentPathsForRename', () => {
  it('moves one file\'s comments, artifact identity and comment-file fact', () => {
    const db = fixture();
    seedComment(db, 'index.html', 'cmt-1');
    const artifact = ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'index.html', kind: 'html' });
    const state: CommentFileState = {
      schemaVersion: 1,
      revision: 1,
      files: [{
        sourceFileId: artifact.id,
        sourceFilePath: 'index.html',
        entryPath: 'index.html',
        resourceId: 'r1',
        versionId: 'v1',
        retired: false,
      }],
    };
    updateProject(db, 'p', { metadata: { keep: 'me', _commentFiles: state } });

    const result = migrateCommentPathsForRename(db, 'p', 'index.html', 'landing.html');

    expect(result).toEqual({ comments: 1, artifacts: 1, facts: 1 });
    expect(commentPaths(db)).toEqual(['landing.html']);
    expect(getLiveWorkspaceArtifactByPath(db, 'p', 'landing.html')?.id).toBe(artifact.id);
    expect(getLiveWorkspaceArtifactByPath(db, 'p', 'index.html')).toBeNull();
    const metadata = getProject(db, 'p')?.metadata as {
      keep?: string;
      _commentFiles?: CommentFileState;
    };
    expect(metadata.keep).toBe('me');
    expect(metadata._commentFiles?.files[0]).toMatchObject({
      sourceFileId: artifact.id,
      sourceFilePath: 'landing.html',
      entryPath: 'landing.html',
      resourceId: 'r1',
      versionId: 'v1',
    });
  });

  it('moves the whole subtree when a folder is renamed', () => {
    const db = fixture();
    seedComment(db, 'pages/a.html', 'cmt-a');
    seedComment(db, 'pages/deep/b.html', 'cmt-b');
    seedComment(db, 'outside.html', 'cmt-out');
    ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'pages/a.html', kind: 'html' });
    ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'pages/deep/b.html', kind: 'html' });

    const result = migrateCommentPathsForRename(db, 'p', 'pages', 'site/pages');

    expect(result.comments).toBe(2);
    expect(result.artifacts).toBe(2);
    expect(commentPaths(db).sort()).toEqual(['outside.html', 'site/pages/a.html', 'site/pages/deep/b.html'].sort());
    expect(getLiveWorkspaceArtifactByPath(db, 'p', 'site/pages/deep/b.html')).not.toBeNull();
  });

  it('keeps a retired fact\'s original path', () => {
    const db = fixture();
    const state: CommentFileState = {
      schemaVersion: 1,
      revision: 2,
      files: [{
        sourceFileId: '11111111-1111-4111-8111-111111111111',
        sourceFilePath: 'old.html',
        entryPath: 'old.html',
        resourceId: 'r1',
        versionId: 'v1',
        retired: true,
      }],
    };
    updateProject(db, 'p', { metadata: { _commentFiles: state } });

    expect(migrateCommentPathsForRename(db, 'p', 'old.html', 'new.html')).toEqual({
      comments: 0,
      artifacts: 0,
      facts: 0,
    });
    const metadata = getProject(db, 'p')?.metadata as { _commentFiles?: CommentFileState };
    expect(metadata._commentFiles?.files[0]?.sourceFilePath).toBe('old.html');
  });

  it('is a no-op when nothing references the path, and is idempotent', () => {
    const db = fixture();
    seedComment(db, 'index.html', 'cmt-1');

    expect(migrateCommentPathsForRename(db, 'p', 'missing.html', 'other.html'))
      .toEqual({ comments: 0, artifacts: 0, facts: 0 });

    migrateCommentPathsForRename(db, 'p', 'index.html', 'landing.html');
    expect(migrateCommentPathsForRename(db, 'p', 'index.html', 'landing.html'))
      .toEqual({ comments: 0, artifacts: 0, facts: 0 });
    expect(commentPaths(db)).toEqual(['landing.html']);
  });

  it('does not touch comments that only share a name prefix', () => {
    const db = fixture();
    seedComment(db, 'pages/a.html', 'cmt-a');
    seedComment(db, 'pagesx/a.html', 'cmt-x');

    migrateCommentPathsForRename(db, 'p', 'pages', 'moved');

    expect(commentPaths(db)).toEqual(['moved/a.html', 'pagesx/a.html'].sort());
  });

  it('retires a live identity already sitting on the destination', () => {
    const db = fixture();
    seedComment(db, 'index.html', 'cmt-1');
    const source = ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'index.html', kind: 'html' });
    const collision = ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'landing.html', kind: 'html' });

    migrateCommentPathsForRename(db, 'p', 'index.html', 'landing.html');

    expect(getLiveWorkspaceArtifactByPath(db, 'p', 'landing.html')?.id).toBe(source.id);
    expect(getLiveWorkspaceArtifactByPath(db, 'p', 'landing.html')?.id).not.toBe(collision.id);
  });
});
