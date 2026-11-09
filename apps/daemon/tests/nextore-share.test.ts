import Database from 'better-sqlite3';
import http from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_SHARE_LINK_DAYS,
  createShareLink,
  hasValidShareGrant,
  listShareLinks,
  resolveShareExpiry,
  resolveShareLink,
  revokeShareLink,
} from '../src/nextore/share/service.js';
import { createNextoreProjectAuthorizer } from '../src/nextore/acl/authorize-project.js';
import { registerNextoreShareRoutes } from '../src/nextore/share/routes.js';
import { createProjectAccessCache } from '../src/nextore/acl/access-cache.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE nextore_share_links (
      token_hash TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_by_member_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER
    );
    CREATE TABLE nextore_share_grants (
      member_id INTEGER NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL REFERENCES nextore_share_links(token_hash) ON DELETE CASCADE,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (member_id, project_id)
    );
    INSERT INTO projects (id) VALUES ('proj-1'), ('proj-2');
  `);
});

afterEach(() => {
  db.close();
});

describe('share-link service', () => {
  it('creates a hashed link and returns the raw URL once', () => {
    const link = createShareLink(db, {
      projectId: 'proj-1',
      createdByMemberId: 7,
      expiresAt: Date.now() + 86_400_000,
      baseUrl: 'https://designer.test/',
    });
    expect(link.url).toBe('https://designer.test/s/' + encodeURIComponent(link.token));
    expect(link.id).toHaveLength(64);
    const row = db.prepare('SELECT token_hash, project_id FROM nextore_share_links').get() as {
      token_hash: string;
      project_id: string;
    };
    expect(row.token_hash).toBe(link.id);
    expect(row.token_hash).not.toContain(link.token);
    expect(listShareLinks(db, 'proj-1')).toHaveLength(1);
  });

  it('redeems a link into a live grant and rejects another member without one', () => {
    const link = createShareLink(db, {
      projectId: 'proj-1',
      createdByMemberId: 7,
      expiresAt: null,
      baseUrl: 'https://designer.test',
    });
    expect(resolveShareLink(db, { token: link.token, memberId: 11 }))
      .toEqual({ projectId: 'proj-1' });
    expect(hasValidShareGrant(db, 11, 'proj-1')).toBe(true);
    expect(hasValidShareGrant(db, 12, 'proj-1')).toBe(false);
    expect(hasValidShareGrant(db, 11, 'proj-2')).toBe(false);
  });

  it('revocation and expiry invalidate the grant immediately', () => {
    const link = createShareLink(db, {
      projectId: 'proj-1',
      createdByMemberId: 7,
      expiresAt: null,
      baseUrl: 'https://designer.test',
    });
    resolveShareLink(db, { token: link.token, memberId: 11 });
    expect(hasValidShareGrant(db, 11, 'proj-1')).toBe(true);

    expect(revokeShareLink(db, 'proj-1', link.id)).toBe(true);
    expect(hasValidShareGrant(db, 11, 'proj-1')).toBe(false);
    expect(resolveShareLink(db, { token: link.token, memberId: 11 })).toBeNull();

    const short = createShareLink(db, {
      projectId: 'proj-2',
      createdByMemberId: 7,
      expiresAt: Date.now() + 1_000,
      baseUrl: 'https://designer.test',
    });
    resolveShareLink(db, { token: short.token, memberId: 11 });
    expect(hasValidShareGrant(db, 11, 'proj-2', Date.now() + 2_000)).toBe(false);
    expect(resolveShareLink(db, {
      token: short.token,
      memberId: 11,
      now: Date.now() + 2_000,
    })).toBeNull();
  });

  it('caps expiry at the local policy window', () => {
    const now = 1_700_000_000_000;
    expect(resolveShareExpiry(now - 1, now)).toMatchObject({ ok: false });
    expect(resolveShareExpiry(now + (MAX_SHARE_LINK_DAYS + 1) * 86_400_000, now))
      .toMatchObject({ ok: false });
    expect(resolveShareExpiry(now + 86_400_000, now))
      .toEqual({ ok: true, expiresAt: now + 86_400_000 });
    expect(resolveShareExpiry(null, now)).toEqual({ ok: true, expiresAt: null });
  });
});

describe('share grant in the project authorizer', () => {
  it('allows read and comment but not download, conversation or share', async () => {
    const link = createShareLink(db, {
      projectId: 'proj-1',
      createdByMemberId: 7,
      expiresAt: null,
      baseUrl: 'https://designer.test',
    });
    resolveShareLink(db, { token: link.token, memberId: 11 });

    let moduleLoads = 0;
    const denied: Array<{ status: number; code: string }> = [];
    const authorize = createNextoreProjectAuthorizer(
      async () => true,
      {
        edition: 'nextore',
        cache: createProjectAccessCache(),
        load: async () => {
          moduleLoads += 1;
          return {
            exists: true,
            canRead: false,
            canEdit: false,
            canDelete: false,
            canManage: false,
            canDownload: false,
          };
        },
        readSession: () => ({ accessToken: 'token', memberId: 11 }),
        readProjectMapping: () => 'nxt-1',
        readShareGrant: (memberId, projectId) => hasValidShareGrant(db, memberId, projectId),
        deny: (_res, status, code) => {
          denied.push({ status, code });
        },
      },
    );

    await expect(authorize({}, {} as never, 'proj-1', { mode: 'read' })).resolves.toBe(true);
    await expect(
      authorize({}, {} as never, 'proj-1', { mode: 'write', capability: 'comment' }),
    ).resolves.toBe(true);
    expect(moduleLoads).toBe(0);

    await expect(
      authorize({}, {} as never, 'proj-1', { mode: 'read', capability: 'download' }),
    ).resolves.toBe(false);
    await expect(
      authorize({}, {} as never, 'proj-1', { mode: 'read', readKind: 'conversation' }),
    ).resolves.toBe(false);
    await expect(
      authorize({}, {} as never, 'proj-1', { mode: 'read', capability: 'share' }),
    ).resolves.toBe(false);
    // Reads share the project-access cache, so the first non-grant read loads
    // the module once and the rest reuse it.
    expect(moduleLoads).toBe(1);
    expect(denied.map((entry) => entry.code)).toEqual([
      'PROJECT_FORBIDDEN',
      'PROJECT_FORBIDDEN',
      'PROJECT_FORBIDDEN',
    ]);
  });
});

describe('share-link routes', () => {
  it('creates, lists, resolves and revokes through HTTP', async () => {
    let manageAllowed = true;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const member = req.header('x-test-member');
      if (member) {
        res.locals.nextoreSession = {
          memberId: Number(member),
          accessToken: 'access-token',
          member: {
            features: { shareLinks: req.header('x-test-share-links') !== '0' },
          },
        };
      }
      next();
    });
    registerNextoreShareRoutes(app, {
      db,
      config: {
        baseUrl: 'https://nextore.test',
        oauthClientId: 'client',
        designerBaseUrl: 'https://designer.test',
        secretFile: '/unused',
        trustProxy: null,
      },
      authorizeProject: async (_req, res, _projectId, options) => {
        if (options.capability === 'share' && !manageAllowed) {
          res.status(403).json({ error: { code: 'PROJECT_FORBIDDEN' } });
          return false;
        }
        return true;
      },
      readProjectMapping: () => 'nxt-1',
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const request = async (path: string, init: RequestInit = {}) => {
        const response = await fetch(base + path, {
          ...init,
          headers: {
            'content-type': 'application/json',
            'x-test-member': '7',
            ...(init.headers as Record<string, string> | undefined),
          },
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
      };

      manageAllowed = false;
      const forbidden = await request('/api/nextore/projects/proj-1/share-links', {
        method: 'POST',
        body: JSON.stringify({ expiresAt: null }),
      });
      expect(forbidden.status).toBe(403);

      manageAllowed = true;
      const disabled = await request('/api/nextore/projects/proj-1/share-links', {
        method: 'POST',
        headers: { 'x-test-share-links': '0' },
        body: JSON.stringify({ expiresAt: null }),
      });
      expect(disabled.status).toBe(403);
      expect(disabled.body.error.code).toBe('SHARE_LINKS_DISABLED');

      const created = await request('/api/nextore/projects/proj-1/share-links', {
        method: 'POST',
        body: JSON.stringify({ expiresAt: null }),
      });
      expect(created.status).toBe(200);
      const url = created.body.link.url as string;
      const token = decodeURIComponent(url.split('/s/')[1]!);

      const listed = await request('/api/nextore/projects/proj-1/share-links');
      expect(listed.body.links).toHaveLength(1);

      const resolved = await request('/api/nextore/share-links/resolve', {
        method: 'POST',
        headers: { 'x-test-member': '11' },
        body: JSON.stringify({ token }),
      });
      expect(resolved.status).toBe(200);
      expect(resolved.body.projectId).toBe('proj-1');
      expect(hasValidShareGrant(db, 11, 'proj-1')).toBe(true);

      const revoked = await request(
        '/api/nextore/projects/proj-1/share-links/' + encodeURIComponent(created.body.link.id),
        { method: 'DELETE' },
      );
      expect(revoked.status).toBe(200);
      expect(hasValidShareGrant(db, 11, 'proj-1')).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});
