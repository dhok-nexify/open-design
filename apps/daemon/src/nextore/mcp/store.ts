import type Database from 'better-sqlite3';
import type { McpServerConfig } from '@open-design/contracts';

import { decryptSecret, encryptSecret, type NextoreSecrets } from '../auth/secrets.js';

type SqliteDb = Database.Database;

/** The edition only accepts remote MCP transports (DESIGN §10). */
export type NextoreMcpTransport = 'http' | 'sse';

export interface NextoreMcpServerInput {
  id: string;
  label?: string;
  templateId?: string;
  transport: NextoreMcpTransport;
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Defensive schema guard for a daemon that is upgraded without a restart of
 * the migration path. `migrateNextoreDatabase()` owns the canonical DDL; this
 * keeps the route usable if an older process already opened the database.
 */
const ensuredSchemas = new WeakSet<object>();

export function ensureNextoreMcpSchema(db: SqliteDb): void {
  if (ensuredSchemas.has(db)) return;
  db.exec(`
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
  `);
  ensuredSchemas.add(db);
}

const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_SERVERS = 32;
const MAX_HEADER_BYTES = 16 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__' || key === 'constructor') continue;
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof value !== 'string') continue;
    if (value.trim() === '') continue;
    out[key.trim()] = value;
  }
  if (Object.keys(out).length === 0) return undefined;
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_HEADER_BYTES) {
    throw new Error('MCP server headers exceed the 16 KB limit');
  }
  return out;
}

/**
 * Validate one per-user MCP server. stdio is rejected outright: it would give
 * the agent a host command to spawn, which is exactly what the edition forbids.
 */
export function sanitizeNextoreMcpServer(raw: unknown): NextoreMcpServerInput | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!SERVER_ID_PATTERN.test(id)) return null;

  const transport = typeof raw.transport === 'string' ? raw.transport.trim() : '';
  if (transport !== 'http' && transport !== 'sse') return null;

  const rawUrl = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const out: NextoreMcpServerInput = {
    id,
    transport,
    enabled: raw.enabled !== false,
    url: parsed.toString(),
  };
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim().slice(0, 80);
  if (typeof raw.templateId === 'string' && raw.templateId.trim()) {
    out.templateId = raw.templateId.trim().slice(0, 80);
  }
  const headers = sanitizeHeaders(raw.headers);
  if (headers) out.headers = headers;
  return out;
}

export function sanitizeNextoreMcpServers(raw: unknown): NextoreMcpServerInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: NextoreMcpServerInput[] = [];
  for (const entry of list) {
    if (out.length >= MAX_SERVERS) break;
    const server = sanitizeNextoreMcpServer(entry);
    if (!server || seen.has(server.id)) continue;
    seen.add(server.id);
    out.push(server);
  }
  return out;
}

interface McpServerRow {
  name: string;
  label: string | null;
  template_id: string | null;
  transport: string;
  url: string;
  enabled: number;
  headers_enc: Buffer | null;
}

function decodeHeaders(
  secrets: NextoreSecrets,
  serverName: string,
  encrypted: Buffer | null,
): Record<string, string> | undefined {
  if (!encrypted) return undefined;
  try {
    const plaintext = decryptSecret(secrets, encrypted);
    if (!plaintext) return undefined;
    const parsed: unknown = JSON.parse(plaintext);
    return sanitizeHeaders(parsed);
  } catch {
    console.warn('[nextore-mcp] could not decrypt headers for server', serverName);
    return undefined;
  }
}

export function listNextoreMcpServers(
  db: SqliteDb,
  secrets: NextoreSecrets,
  memberId: number,
): McpServerConfig[] {
  ensureNextoreMcpSchema(db);
  const rows = db
    .prepare(
      `SELECT name, label, template_id, transport, url, enabled, headers_enc
         FROM nextore_mcp_servers
        WHERE member_id = ?
        ORDER BY created_at ASC, name ASC`,
    )
    .all(memberId) as McpServerRow[];

  return rows.map((row) => {
    const headers = decodeHeaders(secrets, row.name, row.headers_enc);
    return {
      id: row.name,
      ...(row.label ? { label: row.label } : {}),
      ...(row.template_id ? { templateId: row.template_id } : {}),
      transport: row.transport === 'sse' ? 'sse' : 'http',
      enabled: row.enabled !== 0,
      // The edition has no managed OAuth: credentials travel in headers only.
      authMode: 'none',
      url: row.url,
      ...(headers ? { headers } : {}),
    } satisfies McpServerConfig;
  });
}

/**
 * Replace the member's entire server list in one transaction. This mirrors the
 * upstream PUT /api/mcp/servers contract, so the settings panel keeps its
 * save-one-list interaction while storage becomes per member.
 */
export function replaceNextoreMcpServers(
  db: SqliteDb,
  secrets: NextoreSecrets,
  memberId: number,
  rawServers: unknown,
): McpServerConfig[] {
  ensureNextoreMcpSchema(db);
  const servers = sanitizeNextoreMcpServers(rawServers);
  const now = Date.now();
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM nextore_mcp_servers WHERE member_id = ?').run(memberId);
    const insert = db.prepare(
      `INSERT INTO nextore_mcp_servers
         (member_id, name, label, template_id, transport, url, enabled,
          headers_enc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const server of servers) {
      insert.run(
        memberId,
        server.id,
        server.label ?? null,
        server.templateId ?? null,
        server.transport,
        server.url,
        server.enabled ? 1 : 0,
        server.headers
          ? encryptSecret(secrets, JSON.stringify(server.headers))
          : null,
        now,
        now,
      );
    }
  });
  replace();
  return listNextoreMcpServers(db, secrets, memberId);
}
