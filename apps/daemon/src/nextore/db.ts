import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

/**
 * Apply NexTore-only schema additions after the upstream database migration.
 *
 * Every statement is safe to replay on restart. The messages column is added
 * separately because upstream owns the base table and older databases do not
 * have it yet.
 */
export function migrateNextoreDatabase(db: SqliteDb): void {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nextore_projects (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        tree_object_id INTEGER NOT NULL UNIQUE,
        workspace_object_id INTEGER NOT NULL,
        created_by_member_id INTEGER NOT NULL,
        deleted_at INTEGER,
        missing_since INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_nextore_projects_workspace
        ON nextore_projects(workspace_object_id);
      CREATE INDEX IF NOT EXISTS idx_nextore_projects_collection
        ON nextore_projects(deleted_at, missing_since);

      CREATE TABLE IF NOT EXISTS nextore_sessions (
        sid TEXT PRIMARY KEY,
        member_id INTEGER NOT NULL,
        member_json TEXT NOT NULL,
        access_token_enc BLOB NOT NULL,
        refresh_token_enc BLOB,
        token_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        last_validated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nextore_sessions_member
        ON nextore_sessions(member_id);
      CREATE INDEX IF NOT EXISTS idx_nextore_sessions_validation
        ON nextore_sessions(last_validated_at);
      CREATE INDEX IF NOT EXISTS idx_nextore_sessions_seen
        ON nextore_sessions(last_seen_at);

      CREATE TABLE IF NOT EXISTS nextore_share_links (
        token_hash TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_by_member_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_nextore_share_links_project
        ON nextore_share_links(project_id);
      CREATE INDEX IF NOT EXISTS idx_nextore_share_links_expiry
        ON nextore_share_links(expires_at, revoked_at);

      CREATE TABLE IF NOT EXISTS nextore_share_grants (
        member_id INTEGER NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL REFERENCES nextore_share_links(token_hash) ON DELETE CASCADE,
        granted_at INTEGER NOT NULL,
        PRIMARY KEY (member_id, project_id)
      );

      CREATE INDEX IF NOT EXISTS idx_nextore_share_grants_token
        ON nextore_share_grants(token_hash);

      CREATE TABLE IF NOT EXISTS nextore_user_prefs (
        member_id INTEGER PRIMARY KEY,
        prefs_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nextore_mcp_servers (
        member_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        label TEXT,
        template_id TEXT,
        transport TEXT NOT NULL CHECK (transport IN ('http', 'sse')),
        url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        headers_enc BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (member_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_nextore_mcp_servers_member
        ON nextore_mcp_servers(member_id, created_at);

      CREATE TABLE IF NOT EXISTS nextore_project_run_lock (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        member_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL
      );
    `);

    const messageColumns = db
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name?: unknown }>;
    if (!messageColumns.some((column) => column.name === 'author_member_id')) {
      db.exec(`ALTER TABLE messages ADD COLUMN author_member_id INTEGER`);
    }
  });

  migrate();
}
