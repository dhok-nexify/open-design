import http from 'node:http';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextoreClientError, type NextoreClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';
import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  createNextoreAuth,
  safeReturnTo,
  SESSION_COOKIE,
} from '../src/nextore/auth/routes.js';
import {
  deriveNextoreSecrets,
  signPayload,
  type NextoreSecrets,
} from '../src/nextore/auth/secrets.js';
import {
  createNextoreSessionStore,
  type NextoreSessionStore,
} from '../src/nextore/auth/session-store.js';

const nativeFetch = globalThis.fetch.bind(globalThis);

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'designer-client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/unused',
  trustProxy: null,
};

const member = {
  id: 7,
  login: 'admin',
  fullName: 'Site Admin',
  email: 'admin@example.test',
  language: 'zh-TW',
  profileObjectId: 70,
};

let db: Database.Database;
let store: NextoreSessionStore;
let secrets: NextoreSecrets;
let server: http.Server | undefined;
let baseUrl = '';
let clock = Date.now();

function listen(app: express.Express): Promise<void> {
  server = http.createServer(app);
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
      baseUrl = 'http://127.0.0.1:' + address.port;
      resolve();
    });
  });
}

async function closeServer(): Promise<void> {
  if (!server) return;
  const current = server;
  server = undefined;
  if (!current.listening) return;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
}

function client(overrides: { bootstrap?: (token: string) => Promise<unknown> } = {}): NextoreClient {
  return {
    health: async () => ({ moduleVersion: '1.0.0' }),
    branding: async () => ({
      siteTitle: 'NexTore Designer',
      brandName: 'NexTore Designer',
      primaryColor: '#4F46E5',
      version: 1,
    }),
    bootstrap: (overrides.bootstrap ?? (async () => ({ member }))) as NextoreClient['bootstrap'],
    projectAccess: async <T>() => ({} as T),
    projectPermissionUrl: async <T>() => ({} as T),
    workspaces: async <T>() => ({} as T),
    workspaceProjects: async <T>() => ({} as T),
    createProject: async <T>() => ({} as T),
    deleteProject: async <T>() => ({} as T),
  };
}

function buildApp(nextoreClient: NextoreClient = client()): express.Express {
  const app = express();
  const auth = createNextoreAuth({
    config,
    client: nextoreClient,
    store,
    secrets: () => secrets,
    now: () => clock,
  });
  auth.registerRoutes(app);
  app.use('/api', auth.gate);
  app.all('/api/probe', (req, res) => {
    res.json({
      appUserId: req.headers['x-od-app-user-id'] ?? null,
      workspaceId: req.headers['x-od-workspace-id'] ?? null,
      queryWorkspaceId: req.query.workspaceId ?? null,
    });
  });
  return app;
}

function sessionCookie(sid: string, issuedAt = clock): string {
  return SESSION_COOKIE + '=' + encodeURIComponent(signPayload(secrets, { sid, issuedAt }));
}

function responseCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(setCookies: string[], name: string): string {
  const match = setCookies
    .map((value) => value.split(';', 1)[0] ?? '')
    .find((value) => value.startsWith(name + '='));
  if (!match) throw new Error('Missing cookie ' + name);
  return match.slice(name.length + 1);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE messages (id TEXT PRIMARY KEY);');
  migrateNextoreDatabase(db);
  secrets = deriveNextoreSecrets('designer-test-secret-'.repeat(3));
  store = createNextoreSessionStore(() => db, () => secrets);
  clock = Date.now();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeServer();
  db.close();
});

describe('safeReturnTo', () => {
  it('keeps same-origin paths and rejects protocol-relative or backslash redirects', () => {
    expect(safeReturnTo('/projects?view=grid#top')).toBe('/projects?view=grid#top');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('/ok\u0000')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
  });
});

describe('Nextore session store', () => {
  it('stores both tokens encrypted and can still read them back', () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'access-plaintext',
      refreshToken: 'refresh-plaintext',
      tokenExpiresAt: clock + 60 * 60 * 1000,
    });

    const row = db.prepare(
      'SELECT access_token_enc, refresh_token_enc FROM nextore_sessions WHERE sid = ?',
    ).get(session.sid) as { access_token_enc: Buffer; refresh_token_enc: Buffer };
    expect(row.access_token_enc.toString('utf8')).not.toContain('access-plaintext');
    expect(row.refresh_token_enc.toString('utf8')).not.toContain('refresh-plaintext');
    expect(store.find(session.sid)).toMatchObject({
      accessToken: 'access-plaintext',
      refreshToken: 'refresh-plaintext',
    });
  });

  it('prunes rows whose last activity has left the session window', () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiresAt: null,
    });
    db.prepare('UPDATE nextore_sessions SET last_seen_at = ? WHERE sid = ?')
      .run(clock - 9 * 60 * 60 * 1000, session.sid);

    expect(store.pruneExpired(clock - 8 * 60 * 60 * 1000)).toBe(1);
    expect(store.find(session.sid)).toBeNull();
  });
});

describe('Nextore OAuth routes', () => {
  it('completes code + PKCE sign-in and reads the camelCase bootstrap member', async () => {
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'mcp:tools',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', tokenFetch);

    const bootstrap = vi.fn(async (token: string) => {
      expect(token).toBe('access-1');
      return { member };
    });
    await listen(buildApp(client({ bootstrap })));

    const start = await nativeFetch(baseUrl + '/auth/start?return=' + encodeURIComponent('/projects?view=grid'), {
      redirect: 'manual',
    });
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(authorize.origin).toBe('http://nextore.test');
    expect(authorize.pathname).toBe('/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('designer-client');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://designer.test/auth/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorize.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThan(20);

    const pending = cookieValue(responseCookies(start), 'nxd_oauth');
    const callback = await nativeFetch(
      baseUrl + '/auth/callback?code=code-1&state=' + encodeURIComponent(state),
      { headers: { cookie: 'nxd_oauth=' + pending }, redirect: 'manual' },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/projects?view=grid');

    const session = cookieValue(responseCookies(callback), SESSION_COOKIE);
    const me = await nativeFetch(baseUrl + '/auth/me', {
      headers: { cookie: SESSION_COOKIE + '=' + session },
    });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      signedIn: true,
      member: { id: 7, login: 'admin', language: 'zh-TW' },
    });
    expect(bootstrap).toHaveBeenCalledWith('access-1');
  });

  it('strips client-supplied workspace identity and binds the member id', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock + 60 * 60 * 1000,
    });
    await listen(buildApp());

    const response = await nativeFetch(
      baseUrl + '/api/probe?workspaceId=spoofed-workspace&workspaceMemberId=999',
      {
        method: 'POST',
        headers: {
          cookie: sessionCookie(session.sid),
          origin: config.designerBaseUrl,
          'x-od-workspace-id': 'spoofed-workspace',
          'x-od-workspace-member-id': '999',
          'x-od-app-user-id': 'attacker',
        },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      appUserId: '7',
      workspaceId: null,
      queryWorkspaceId: null,
    });
  });

  it('rejects a state-changing request from another origin', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock + 60 * 60 * 1000,
    });
    await listen(buildApp());

    const response = await nativeFetch(baseUrl + '/api/probe', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(session.sid),
        origin: 'http://evil.test',
      },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_REJECTED' } });
  });

  it('persists profile changes returned by periodic revalidation', async () => {
    const session = store.create({
      memberId: member.id,
      member: { ...member, fullName: 'Old Name' },
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock + 60 * 60 * 1000,
    });
    db.prepare('UPDATE nextore_sessions SET last_validated_at = ? WHERE sid = ?')
      .run(clock - 10 * 60 * 1000, session.sid);
    await listen(buildApp(client({
      bootstrap: async () => ({ member: { ...member, fullName: 'New Name' } }),
    })));

    const response = await nativeFetch(baseUrl + '/auth/me', {
      headers: { cookie: sessionCookie(session.sid) },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      member: { fullName: 'New Name' },
    });
    expect(store.find(session.sid)?.member.fullName).toBe('New Name');
  });

  it('refreshes once when parallel requests find an expired access token', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock - 1000,
    });
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', tokenFetch);

    await listen(buildApp(client({
      bootstrap: async (token: string) => {
        expect(token).toBe('fresh-access');
        return { member };
      },
    })));

    const reply = await Promise.all([
      nativeFetch(baseUrl + '/auth/me', { headers: { cookie: sessionCookie(session.sid) } }),
      nativeFetch(baseUrl + '/auth/me', { headers: { cookie: sessionCookie(session.sid) } }),
    ]);
    expect(reply.map((response) => response.status)).toEqual([200, 200]);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    expect(store.find(session.sid)?.refreshToken).toBe('refresh-2');
  });

  it('keeps the session when a refresh fails transiently', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock - 1000,
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));
    await listen(buildApp());

    const response = await nativeFetch(baseUrl + '/auth/me', {
      headers: { cookie: sessionCookie(session.sid) },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NEXTORE_UNAVAILABLE' } });
    expect(store.find(session.sid)).not.toBeNull();
  });

  it('deletes the session when the refreshed credential is still unauthorized', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock - 1000,
    });
    db.prepare('UPDATE nextore_sessions SET last_validated_at = ? WHERE sid = ?')
      .run(clock - 10 * 60 * 1000, session.sid);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await listen(buildApp(client({
      bootstrap: async () => {
        throw new NextoreClientError('nextore_http_error', 'unauthorized', 401);
      },
    })));

    const response = await nativeFetch(baseUrl + '/auth/me', {
      headers: { cookie: sessionCookie(session.sid) },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
    expect(store.find(session.sid)).toBeNull();
  });

  it('deletes the session when the refresh token is permanently refused', async () => {
    const session = store.create({
      memberId: member.id,
      member,
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      tokenExpiresAt: clock - 1000,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'The refresh token was already replaced.',
    }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await listen(buildApp());

    const response = await nativeFetch(baseUrl + '/auth/me', {
      headers: { cookie: sessionCookie(session.sid) },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
    expect(store.find(session.sid)).toBeNull();
  });
});
