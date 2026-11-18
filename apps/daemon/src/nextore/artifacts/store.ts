import type Database from 'better-sqlite3';
import {
  NEXTORE_ARTIFACT_REPRESENTATIONS,
  NEXTORE_ARTIFACT_STATUSES,
  isNextoreArtifactRepresentation,
  isNextoreArtifactStatus,
  type NextoreArtifactRecord,
  type NextoreArtifactRepresentation,
  type NextoreArtifactStatus,
  type NextorePublishQueueItem,
} from '@open-design/contracts';

type SqliteDb = Database.Database;

const STATUS_SQL = NEXTORE_ARTIFACT_STATUSES.map((status) => `'${status}'`).join(', ');
const REPRESENTATION_SQL = NEXTORE_ARTIFACT_REPRESENTATIONS
  .map((representation) => `'${representation}'`)
  .join(', ');

function artifactTableSql(tableName: string, ifNotExists: boolean): string {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
      project_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      representation TEXT NOT NULL CHECK (representation IN (${REPRESENTATION_SQL})),
      relative_path TEXT NOT NULL,
      tree_object_id INTEGER NOT NULL,
      current_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${STATUS_SQL})),
      last_error TEXT,
      orphaned_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, artifact_id, representation)
    );
  `;
}

function publishQueueTableSql(tableName: string, ifNotExists: boolean): string {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      representation TEXT NOT NULL CHECK (representation IN (${REPRESENTATION_SQL})),
      relative_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      claimed_by TEXT,
      lease_until INTEGER,
      dead_letter_at INTEGER,
      last_error TEXT
    );
  `;
}

const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_nextore_artifacts_project
    ON nextore_artifacts(project_id, status);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_nextore_artifacts_tree_object
    ON nextore_artifacts(tree_object_id);

  CREATE INDEX IF NOT EXISTS idx_nextore_publish_queue_due
    ON nextore_publish_queue(dead_letter_at, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_nextore_publish_queue_project
    ON nextore_publish_queue(project_id, created_at);
`;

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`;

export const NEXTORE_ARTIFACT_MIGRATION_ID = 'p04a_artifact_representation_v1';

/**
 * Canonical DDL for a fresh database. Existing databases go through
 * `migrateNextoreArtifactSchema()` because SQLite cannot alter a primary key.
 */
export const NEXTORE_ARTIFACT_SCHEMA_SQL = [
  artifactTableSql('nextore_artifacts', true),
  publishQueueTableSql('nextore_publish_queue', true),
  INDEX_SQL,
].join('\n');

const ensuredSchemas = new WeakSet<object>();

function tableColumns(db: SqliteDb, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>)
    .map((column) => typeof column.name === 'string' ? column.name : '')
    .filter((name) => name.length > 0);
}

function hasTable(db: SqliteDb, tableName: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(tableName));
}

function migrateArtifactTable(db: SqliteDb): void {
  if (!hasTable(db, 'nextore_artifacts')) {
    db.exec(artifactTableSql('nextore_artifacts', true));
    return;
  }

  const columns = tableColumns(db, 'nextore_artifacts');
  if (columns.includes('representation')) return;

  const lastError = columns.includes('last_error') ? 'last_error' : 'NULL';
  const orphanedAt = columns.includes('orphaned_at') ? 'orphaned_at' : 'NULL';
  const updatedAt = columns.includes('updated_at') ? 'updated_at' : 'published_at';

  db.exec(`
    DROP TABLE IF EXISTS nextore_artifacts_p04a;
    ${artifactTableSql('nextore_artifacts_p04a', false)}
    INSERT INTO nextore_artifacts_p04a (
      project_id, artifact_id, representation, relative_path, tree_object_id,
      current_version, content_hash, published_at, status, last_error,
      orphaned_at, updated_at
    )
    SELECT project_id, artifact_id, 'source', relative_path, tree_object_id,
           current_version, content_hash, published_at, status, ${lastError},
           ${orphanedAt}, ${updatedAt}
      FROM nextore_artifacts;
    DROP TABLE nextore_artifacts;
    ALTER TABLE nextore_artifacts_p04a RENAME TO nextore_artifacts;
  `);
}

function migratePublishQueueTable(db: SqliteDb): void {
  if (!hasTable(db, 'nextore_publish_queue')) {
    db.exec(publishQueueTableSql('nextore_publish_queue', true));
    return;
  }

  const columns = tableColumns(db, 'nextore_publish_queue');
  if (columns.includes('representation')) return;

  const claimedBy = columns.includes('claimed_by') ? 'claimed_by' : 'NULL';
  const leaseUntil = columns.includes('lease_until') ? 'lease_until' : 'NULL';
  const deadLetterAt = columns.includes('dead_letter_at') ? 'dead_letter_at' : 'NULL';
  const lastError = columns.includes('last_error') ? 'last_error' : 'NULL';

  db.exec(`
    DROP TABLE IF EXISTS nextore_publish_queue_p04a;
    ${publishQueueTableSql('nextore_publish_queue_p04a', false)}
    INSERT OR REPLACE INTO nextore_publish_queue_p04a (
      id, project_id, artifact_id, representation, relative_path, reason, attempts,
      next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at, last_error
    )
    SELECT project_id || '::' || artifact_id || '::' || 'source',
           project_id, artifact_id, 'source', relative_path, reason, attempts,
           next_attempt_at, created_at, ${claimedBy}, ${leaseUntil}, ${deadLetterAt}, ${lastError}
      FROM nextore_publish_queue;
    DROP TABLE nextore_publish_queue;
    ALTER TABLE nextore_publish_queue_p04a RENAME TO nextore_publish_queue;
  `);
}

/**
 * Add `representation` to the artifact and queue tables exactly once. Existing
 * rows are preserved as the `source` representation; the old queue id is
 * rewritten to include the representation segment.
 */
export function migrateNextoreArtifactSchema(db: SqliteDb): void {
  const migrate = db.transaction(() => {
    db.exec(MIGRATION_TABLE_SQL);
    const applied = db.prepare(
      `SELECT 1 AS applied FROM nextore_schema_migrations WHERE id = ?`,
    ).get(NEXTORE_ARTIFACT_MIGRATION_ID) as { applied: number } | undefined;

    if (!applied) {
      migrateArtifactTable(db);
      migratePublishQueueTable(db);
      db.prepare(
        `INSERT INTO nextore_schema_migrations (id, applied_at) VALUES (?, ?)`,
      ).run(NEXTORE_ARTIFACT_MIGRATION_ID, Date.now());
    }

    db.exec(INDEX_SQL);
  });
  migrate();
}

export function ensureNextoreArtifactSchema(db: SqliteDb): void {
  if (ensuredSchemas.has(db)) return;
  migrateNextoreArtifactSchema(db);
  ensuredSchemas.add(db);
}

interface ArtifactRow {
  project_id: string;
  artifact_id: string;
  representation: string;
  relative_path: string;
  tree_object_id: number;
  current_version: number;
  content_hash: string;
  published_at: number;
  status: string;
  last_error: string | null;
  orphaned_at: number | null;
  updated_at: number;
}

interface QueueRow {
  id: string;
  project_id: string;
  artifact_id: string;
  representation: string;
  relative_path: string;
  reason: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  claimed_by: string | null;
  lease_until: number | null;
  dead_letter_at: number | null;
  last_error: string | null;
}

function toArtifactRecord(row: ArtifactRow): NextoreArtifactRecord {
  if (!isNextoreArtifactStatus(row.status)) {
    throw new Error(`Unknown nextore artifact status: ${row.status}`);
  }
  if (!isNextoreArtifactRepresentation(row.representation)) {
    throw new Error(`Unknown nextore artifact representation: ${row.representation}`);
  }
  return {
    projectId: row.project_id,
    artifactId: row.artifact_id,
    representation: row.representation,
    relativePath: row.relative_path,
    treeObjectId: row.tree_object_id,
    currentVersion: row.current_version,
    contentHash: row.content_hash,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    orphanedAt: row.orphaned_at,
    lastError: row.last_error,
  };
}

function toQueueItem(row: QueueRow): NextorePublishQueueItem {
  if (!isNextoreArtifactRepresentation(row.representation)) {
    throw new Error(`Unknown nextore queue representation: ${row.representation}`);
  }
  return {
    id: row.id,
    projectId: row.project_id,
    artifactId: row.artifact_id,
    representation: row.representation,
    relativePath: row.relative_path,
    reason: row.reason,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    claimedBy: row.claimed_by,
    leaseUntil: row.lease_until,
    deadLetteredAt: row.dead_letter_at,
    lastError: row.last_error,
  };
}

export interface UpsertNextoreArtifactInput {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  treeObjectId: number;
  currentVersion: number;
  contentHash: string;
  status: NextoreArtifactStatus;
  publishedAt: number;
  lastError?: string | null;
  orphanedAt?: number | null;
  updatedAt?: number;
}

/**
 * Insert or update one representation of one artifact. A rename updates the
 * path on the same row; source, snapshot, and cover coexist independently.
 */
export function upsertNextoreArtifact(
  db: SqliteDb,
  input: UpsertNextoreArtifactInput,
): NextoreArtifactRecord {
  ensureNextoreArtifactSchema(db);
  const updatedAt = input.updatedAt ?? Date.now();
  db.prepare(`
    INSERT INTO nextore_artifacts (
      project_id, artifact_id, representation, relative_path, tree_object_id,
      current_version, content_hash, published_at, status, last_error,
      orphaned_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, artifact_id, representation) DO UPDATE SET
      relative_path = excluded.relative_path,
      tree_object_id = excluded.tree_object_id,
      current_version = excluded.current_version,
      content_hash = excluded.content_hash,
      published_at = excluded.published_at,
      status = excluded.status,
      last_error = excluded.last_error,
      orphaned_at = excluded.orphaned_at,
      updated_at = excluded.updated_at
  `).run(
    input.projectId,
    input.artifactId,
    input.representation,
    input.relativePath,
    input.treeObjectId,
    input.currentVersion,
    input.contentHash,
    input.publishedAt,
    input.status,
    input.lastError ?? null,
    input.orphanedAt ?? null,
    updatedAt,
  );

  const record = getNextoreArtifact(
    db,
    input.projectId,
    input.artifactId,
    input.representation,
  );
  if (!record) throw new Error('nextore artifact row disappeared after upsert');
  return record;
}

export function getNextoreArtifact(
  db: SqliteDb,
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
): NextoreArtifactRecord | null {
  ensureNextoreArtifactSchema(db);
  const row = db.prepare(`
    SELECT project_id, artifact_id, representation, relative_path, tree_object_id,
           current_version, content_hash, published_at, status, last_error,
           orphaned_at, updated_at
      FROM nextore_artifacts
     WHERE project_id = ? AND artifact_id = ? AND representation = ?
  `).get(projectId, artifactId, representation) as ArtifactRow | undefined;
  return row ? toArtifactRecord(row) : null;
}

export function listNextoreArtifacts(
  db: SqliteDb,
  projectId: string,
  artifactId?: string,
): NextoreArtifactRecord[] {
  ensureNextoreArtifactSchema(db);
  const rows = artifactId
    ? db.prepare(`
        SELECT project_id, artifact_id, representation, relative_path, tree_object_id,
               current_version, content_hash, published_at, status, last_error,
               orphaned_at, updated_at
          FROM nextore_artifacts
         WHERE project_id = ? AND artifact_id = ?
         ORDER BY representation ASC
      `).all(projectId, artifactId) as ArtifactRow[]
    : db.prepare(`
        SELECT project_id, artifact_id, representation, relative_path, tree_object_id,
               current_version, content_hash, published_at, status, last_error,
               orphaned_at, updated_at
          FROM nextore_artifacts
         WHERE project_id = ?
         ORDER BY relative_path ASC, artifact_id ASC, representation ASC
      `).all(projectId) as ArtifactRow[];
  return rows.map(toArtifactRecord);
}

export interface UpdateNextoreArtifactStatusInput {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  status: NextoreArtifactStatus;
  lastError?: string | null;
  orphanedAt?: number | null;
  updatedAt?: number;
}

export function updateNextoreArtifactStatus(
  db: SqliteDb,
  input: UpdateNextoreArtifactStatusInput,
): boolean {
  ensureNextoreArtifactSchema(db);
  const result = db.prepare(`
    UPDATE nextore_artifacts
       SET status = ?, last_error = ?, orphaned_at = ?, updated_at = ?
     WHERE project_id = ? AND artifact_id = ? AND representation = ?
  `).run(
    input.status,
    input.lastError ?? null,
    input.orphanedAt ?? null,
    input.updatedAt ?? Date.now(),
    input.projectId,
    input.artifactId,
    input.representation,
  );
  return result.changes > 0;
}

export function markNextoreArtifactOrphaned(
  db: SqliteDb,
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
  now = Date.now(),
): boolean {
  return updateNextoreArtifactStatus(db, {
    projectId,
    artifactId,
    representation,
    status: 'orphaned',
    lastError: null,
    orphanedAt: now,
    updatedAt: now,
  });
}

export function nextorePublishQueueId(
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
): string {
  return `${projectId}::${artifactId}::${representation}`;
}

export interface EnqueueNextorePublishInput {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  reason: string;
  now?: number;
}

/**
 * Enqueue one publish job per artifact representation. Re-enqueueing keeps the
 * earliest due time and leaves a dead-lettered row parked until an explicit
 * retry resets it.
 */
export function enqueueNextorePublish(
  db: SqliteDb,
  input: EnqueueNextorePublishInput,
): NextorePublishQueueItem {
  ensureNextoreArtifactSchema(db);
  const now = input.now ?? Date.now();
  const id = nextorePublishQueueId(input.projectId, input.artifactId, input.representation);
  db.prepare(`
    INSERT INTO nextore_publish_queue (
      id, project_id, artifact_id, representation, relative_path, reason, attempts,
      next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      representation = excluded.representation,
      relative_path = excluded.relative_path,
      reason = excluded.reason,
      next_attempt_at = MIN(nextore_publish_queue.next_attempt_at, excluded.next_attempt_at),
      last_error = CASE
        WHEN nextore_publish_queue.dead_letter_at IS NULL THEN NULL
        ELSE nextore_publish_queue.last_error
      END
  `).run(
    id,
    input.projectId,
    input.artifactId,
    input.representation,
    input.relativePath,
    input.reason,
    now,
    now,
  );
  const item = getNextorePublishQueueItem(db, id);
  if (!item) throw new Error('nextore publish queue row disappeared after enqueue');
  return item;
}

export function getNextorePublishQueueItem(
  db: SqliteDb,
  id: string,
): NextorePublishQueueItem | null {
  ensureNextoreArtifactSchema(db);
  const row = db.prepare(`
    SELECT id, project_id, artifact_id, representation, relative_path, reason, attempts,
           next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at,
           last_error
      FROM nextore_publish_queue
     WHERE id = ?
  `).get(id) as QueueRow | undefined;
  return row ? toQueueItem(row) : null;
}

export function listNextorePublishQueue(
  db: SqliteDb,
  projectId?: string,
  representation?: NextoreArtifactRepresentation,
): NextorePublishQueueItem[] {
  ensureNextoreArtifactSchema(db);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (projectId) {
    conditions.push('project_id = ?');
    params.push(projectId);
  }
  if (representation) {
    conditions.push('representation = ?');
    params.push(representation);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, project_id, artifact_id, representation, relative_path, reason, attempts,
           next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at,
           last_error
      FROM nextore_publish_queue
      ${where}
     ORDER BY created_at ASC, id ASC
  `).all(...params) as QueueRow[];
  return rows.map(toQueueItem);
}

export interface ClaimNextorePublishInput {
  workerId: string;
  now?: number;
  leaseMs?: number;
}

export function claimNextNextorePublish(
  db: SqliteDb,
  input: ClaimNextorePublishInput,
): NextorePublishQueueItem | null {
  ensureNextoreArtifactSchema(db);
  const now = input.now ?? Date.now();
  const leaseMs = input.leaseMs ?? 60_000;
  const claim = db.transaction(() => {
    const row = db.prepare(`
      SELECT id, project_id, artifact_id, representation, relative_path, reason, attempts,
             next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at,
             last_error
        FROM nextore_publish_queue
       WHERE dead_letter_at IS NULL
         AND next_attempt_at <= ?
         AND (claimed_by IS NULL OR lease_until IS NULL OR lease_until <= ?)
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT 1
    `).get(now, now) as QueueRow | undefined;
    if (!row) return null;

    const result = db.prepare(`
      UPDATE nextore_publish_queue
         SET claimed_by = ?, lease_until = ?, attempts = attempts + 1
       WHERE id = ?
         AND dead_letter_at IS NULL
         AND (claimed_by IS NULL OR lease_until IS NULL OR lease_until <= ?)
    `).run(input.workerId, now + leaseMs, row.id, now);
    if (result.changes === 0) return null;

    return getNextorePublishQueueItem(db, row.id);
  });
  return claim();
}

export function completeNextorePublish(
  db: SqliteDb,
  id: string,
  workerId: string,
): boolean {
  ensureNextoreArtifactSchema(db);
  const result = db.prepare(`
    DELETE FROM nextore_publish_queue
     WHERE id = ? AND claimed_by = ?
  `).run(id, workerId);
  return result.changes > 0;
}

export interface FailNextorePublishInput {
  id: string;
  workerId: string;
  error: string;
  retryAt?: number | null;
  deadLetter?: boolean;
  now?: number;
}

export function failNextorePublish(
  db: SqliteDb,
  input: FailNextorePublishInput,
): boolean {
  ensureNextoreArtifactSchema(db);
  if (input.deadLetter) {
    const result = db.prepare(`
      UPDATE nextore_publish_queue
         SET claimed_by = NULL,
             lease_until = NULL,
             dead_letter_at = ?,
             last_error = ?
       WHERE id = ? AND claimed_by = ?
    `).run(input.now ?? Date.now(), input.error, input.id, input.workerId);
    return result.changes > 0;
  }

  if (input.retryAt == null) {
    throw new Error('retryAt is required when a publish failure is retryable');
  }
  const result = db.prepare(`
    UPDATE nextore_publish_queue
       SET claimed_by = NULL,
           lease_until = NULL,
           next_attempt_at = ?,
           last_error = ?
     WHERE id = ? AND claimed_by = ?
  `).run(input.retryAt, input.error, input.id, input.workerId);
  return result.changes > 0;
}

export function retryNextorePublish(
  db: SqliteDb,
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
  now = Date.now(),
): boolean {
  ensureNextoreArtifactSchema(db);
  const id = nextorePublishQueueId(projectId, artifactId, representation);
  const result = db.prepare(`
    UPDATE nextore_publish_queue
       SET attempts = 0,
           next_attempt_at = ?,
           dead_letter_at = NULL,
           last_error = NULL,
           claimed_by = NULL,
           lease_until = NULL
     WHERE id = ?
  `).run(now, id);
  return result.changes > 0;
}
