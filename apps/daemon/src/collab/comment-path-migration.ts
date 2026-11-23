import type Database from 'better-sqlite3';

import { getProject, updateProject } from '../db.js';
import { parseCommentFileState } from './comment-file-facts.js';

export interface CommentPathMigrationResult {
  /** Comment rows whose file path moved. */
  comments: number;
  /** Workspace artifact identities whose current path moved. */
  artifacts: number;
  /** Comment-file facts whose recorded path moved. */
  facts: number;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

/** New path for a rename, or null when this path is outside the moved subtree. */
function migratePath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return null;
}

/**
 * Move every record that names a file path along with a rename.
 *
 * A rename changes where a file lives, not which file it is, so the comment
 * thread must follow it: the artifact identity keeps its id, the comments keep
 * their ids/authors/anchors, and only the paths change. Folder renames are the
 * same problem at every depth, so matching is prefix-aware.
 *
 * The whole migration is one transaction: a partial move would leave comments
 * pointing at a path that no longer exists, which is exactly the state this is
 * meant to prevent.
 */
export function migrateCommentPathsForRename(
  db: Database.Database,
  projectId: string,
  fromPath: string,
  toPath: string,
): CommentPathMigrationResult {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  const empty: CommentPathMigrationResult = { comments: 0, artifacts: 0, facts: 0 };
  if (!projectId || !from || !to || from === to) return empty;

  const migrate = db.transaction((): CommentPathMigrationResult => {
    const now = Date.now();
    const result: CommentPathMigrationResult = { ...empty };

    const commentRows = db.prepare(
      `SELECT id, file_path FROM preview_comments
        WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)`,
    ).all(projectId, from, from + '/%') as Array<{ id: string; file_path: string }>;
    const moveComment = db.prepare(
      'UPDATE preview_comments SET file_path = ?, updated_at = ? WHERE id = ?',
    );
    for (const row of commentRows) {
      const next = migratePath(row.file_path, from, to);
      if (!next) continue;
      moveComment.run(next, now, row.id);
      result.comments += 1;
    }

    const artifactRows = db.prepare(
      `SELECT id, current_path FROM workspace_artifacts
        WHERE project_id = ? AND current_path IS NOT NULL AND deleted_at IS NULL
          AND (current_path = ? OR current_path LIKE ?)`,
    ).all(projectId, from, from + '/%') as Array<{ id: string; current_path: string }>;
    const findLiveAtPath = db.prepare(
      `SELECT id FROM workspace_artifacts
        WHERE project_id = ? AND current_path = ? AND deleted_at IS NULL AND id <> ?`,
    );
    const tombstone = db.prepare(
      'UPDATE workspace_artifacts SET current_path = NULL, deleted_at = ?, updated_at = ? WHERE id = ?',
    );
    const moveArtifact = db.prepare(
      'UPDATE workspace_artifacts SET current_path = ?, updated_at = ? WHERE id = ?',
    );
    for (const row of artifactRows) {
      const next = migratePath(row.current_path, from, to);
      if (!next) continue;
      // A live identity already sitting on the destination would violate the
      // partial unique index; retire it first, exactly like a managed rename.
      const collision = findLiveAtPath.get(projectId, next, row.id) as { id: string } | undefined;
      if (collision) tombstone.run(now, now, collision.id);
      moveArtifact.run(next, now, row.id);
      result.artifacts += 1;
    }

    const metadata = getProject(db, projectId)?.metadata as
      | (Record<string, unknown> & { _commentFiles?: unknown })
      | null
      | undefined;
    const state = parseCommentFileState(metadata?._commentFiles);
    if (state) {
      let changed = false;
      const files = state.files.map((fact) => {
        // A retired fact records where a lifetime used to live; history keeps
        // its original path.
        if (fact.retired) return fact;
        const nextSource = migratePath(fact.sourceFilePath, from, to);
        const nextEntry = migratePath(fact.entryPath, from, to);
        if (!nextSource && !nextEntry) return fact;
        changed = true;
        result.facts += 1;
        return {
          ...fact,
          sourceFilePath: nextSource ?? fact.sourceFilePath,
          entryPath: nextEntry ?? fact.entryPath,
        };
      });
      if (changed) {
        updateProject(db, projectId, {
          metadata: { ...(metadata ?? {}), _commentFiles: { ...state, files } },
        });
      }
    }

    return result;
  });

  return migrate();
}
