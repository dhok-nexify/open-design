import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateNextoreDatabase } from '../src/nextore/db.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
});

afterEach(() => {
  db.close();
});

function tableNames(): string[] {
  return (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

function columnNames(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

describe('migrateNextoreDatabase', () => {
  it('creates the edition tables and author column', () => {
    migrateNextoreDatabase(db);

    expect(tableNames()).toEqual(expect.arrayContaining([
      'nextore_project_run_lock',
      'nextore_projects',
      'nextore_sessions',
      'nextore_share_grants',
      'nextore_share_links',
      'nextore_user_prefs',
    ]));
    expect(columnNames('messages')).toContain('author_member_id');
  });

  it('is idempotent across daemon restarts', () => {
    migrateNextoreDatabase(db);
    expect(() => migrateNextoreDatabase(db)).not.toThrow();

    expect(columnNames('messages').filter((name) => name === 'author_member_id'))
      .toHaveLength(1);
  });

  it('keeps project-bound edition rows tied to upstream project deletion', () => {
    migrateNextoreDatabase(db);
    db.prepare(`INSERT INTO projects (id) VALUES ('project-1')`).run();
    db.prepare(`
      INSERT INTO nextore_projects (
        project_id, tree_object_id, workspace_object_id, created_by_member_id
      ) VALUES (?, ?, ?, ?)
    `).run('project-1', 100, 200, 300);

    db.prepare(`DELETE FROM projects WHERE id = ?`).run('project-1');

    expect(db.prepare(`SELECT COUNT(*) AS count FROM nextore_projects`).get())
      .toEqual({ count: 0 });
  });
});
