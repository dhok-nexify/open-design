import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  API_TOKEN_SCOPES,
  apiTokenAllowsRequest,
  createApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
} from '../src/nextore/auth/api-tokens.js';
import {
  codeChallengeS256,
  issueCliCode,
  redeemCliCode,
} from '../src/nextore/auth/cli-auth.js';
import { createApiTokenGate } from '../src/nextore/auth/api-token-gate.js';

let db: Database.Database;
let server: Server | null = null;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(async () => {
  delete process.env.NEXTORE_CLI_AUTH;
  if (server) {
    const current = server;
    server = null;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
  db.close();
});

const verifier = 'v'.repeat(64);
const challenge = codeChallengeS256(verifier);

describe('P10 api tokens', () => {
  it('stores only the digest and verifies the raw token', () => {
    const issued = createApiToken(db, { memberId: 7, scopes: [...API_TOKEN_SCOPES], now: 1_000 });

    expect(issued.token.startsWith('odt_')).toBe(true);
    const stored = db.prepare('SELECT token_hash FROM nextore_api_tokens WHERE id = ?')
      .get(issued.id) as { token_hash: string };
    expect(stored.token_hash).not.toBe(issued.token);
    expect(verifyApiToken(db, issued.token, 1_001)).toMatchObject({ memberId: 7 });
  });

  it('remembers the browser session that approved the token', () => {
    const issued = createApiToken(db, {
      memberId: 7,
      scopes: ['project:read'],
      sessionSid: 'sid-approver',
      now: 1_000,
    });

    expect(verifyApiToken(db, issued.token, 1_001)?.sessionSid).toBe('sid-approver');
    expect(listApiTokens(db, 7)[0]?.sessionSid).toBe('sid-approver');
  });

  it('adds the session column to a database created before it existed', () => {
    // A daemon upgraded in place keeps its token table; the additive column must
    // appear without dropping the rows.
    db.exec(`CREATE TABLE nextore_api_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      member_id INTEGER NOT NULL,
      scopes TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER
    )`);

    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'], sessionSid: 'sid-legacy', now: 1_000 });
    expect(verifyApiToken(db, issued.token, 1_001)?.sessionSid).toBe('sid-legacy');
  });

  it('rejects an expired token', () => {
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'], now: 1_000, ttlMs: 10 });
    expect(verifyApiToken(db, issued.token, 1_005)).not.toBeNull();
    expect(verifyApiToken(db, issued.token, 1_011)).toBeNull();
  });

  it('rejects a revoked token immediately', () => {
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'], now: 1_000 });
    expect(revokeApiToken(db, 7, issued.id, 2_000)).toBe(true);
    expect(verifyApiToken(db, issued.token, 2_001)).toBeNull();
  });

  it('does not let another member revoke the token', () => {
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'], now: 1_000 });
    expect(revokeApiToken(db, 9, issued.id, 2_000)).toBe(false);
    expect(verifyApiToken(db, issued.token, 2_001)).not.toBeNull();
    expect(listApiTokens(db, 9)).toHaveLength(0);
  });

  it('refuses an unknown or admin scope at issuance', () => {
    expect(() => createApiToken(db, { memberId: 7, scopes: ['admin:settings'] }))
      .toThrow(/unknown scope/);
  });

  it('never allows the settings or admin surface', () => {
    expect(apiTokenAllowsRequest({ scopes: ['project:write', 'run:create'] }, 'GET', '/settings'))
      .toBe(false);
    expect(apiTokenAllowsRequest({ scopes: ['project:write', 'run:create'] }, 'POST', '/project/admin'))
      .toBe(false);
  });

  it('scopes writes and run creation separately', () => {
    expect(apiTokenAllowsRequest({ scopes: ['project:read'] }, 'GET', '/projects')).toBe(true);
    expect(apiTokenAllowsRequest({ scopes: ['project:read'] }, 'POST', '/projects')).toBe(false);
    expect(apiTokenAllowsRequest({ scopes: ['project:write'] }, 'POST', '/projects/p1/runs')).toBe(false);
    expect(apiTokenAllowsRequest({ scopes: ['run:create'] }, 'POST', '/projects/p1/runs')).toBe(true);
  });
});

describe('P10 PKCE codes', () => {
  it('redeems exactly once', () => {
    const issued = issueCliCode(db, { memberId: 7, sessionSid: 'sid-1', challenge, state: 'st', now: 1_000 });
    expect(redeemCliCode(db, { code: issued.code, verifier, state: 'st', now: 1_001 }))
      .toMatchObject({ memberId: 7, sessionSid: 'sid-1' });
    expect(redeemCliCode(db, { code: issued.code, verifier, state: 'st', now: 1_002 })).toBeNull();
  });

  it('rejects a mismatched state', () => {
    const issued = issueCliCode(db, { memberId: 7, sessionSid: null, challenge, state: 'st', now: 1_000 });
    expect(redeemCliCode(db, { code: issued.code, verifier, state: 'other', now: 1_001 })).toBeNull();
  });

  it('rejects a wrong verifier', () => {
    const issued = issueCliCode(db, { memberId: 7, sessionSid: null, challenge, state: 'st', now: 1_000 });
    expect(redeemCliCode(db, { code: issued.code, verifier: 'x'.repeat(64), state: 'st', now: 1_001 }))
      .toBeNull();
  });

  it('expires after two minutes', () => {
    const issued = issueCliCode(db, { memberId: 7, sessionSid: null, challenge, state: 'st', now: 1_000 });
    expect(redeemCliCode(db, { code: issued.code, verifier, state: 'st', now: 120_000 })).not.toBeNull();
    const second = issueCliCode(db, { memberId: 7, sessionSid: null, challenge, state: 'st', now: 1_000 });
    expect(redeemCliCode(db, { code: second.code, verifier, state: 'st', now: 121_001 })).toBeNull();
  });
});

describe('P10 bearer gate', () => {
  it('accepts a live token, rejects after revoke, and blocks admin paths', async () => {
    process.env.NEXTORE_CLI_AUTH = 'on';
    const issued = createApiToken(db, { memberId: 7, scopes: [...API_TOKEN_SCOPES], now: Date.now() });
    const app = express();
    const gate = createApiTokenGate(
      (_req, res) => res.status(401).json({ error: 'SESSION_REQUIRED' }),
      () => db,
    );
    app.use('/api', gate);
    app.get('/api/projects', (_req, res) => res.json({ ok: true }));
    app.post('/api/settings', (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: 'Bearer ' + issued.token };

    const ok = await fetch(base + '/api/projects', { headers: auth });
    expect(ok.status).toBe(200);

    const admin = await fetch(base + '/api/settings', { method: 'POST', headers: auth });
    expect(admin.status).toBe(403);
    expect(await admin.json()).toMatchObject({ error: 'insufficient_scope' });

    revokeApiToken(db, 7, issued.id);
    const revoked = await fetch(base + '/api/projects', { headers: auth });
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('hydrates the member credential so NexTore-backed routes can act for the caller', async () => {
    // A CLI token authenticates the member, but project routes still call the
    // module as that member. Without the hydrated token they answered 401
    // SESSION_REQUIRED even though the token was valid.
    process.env.NEXTORE_CLI_AUTH = 'on';
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'] });
    const app = express();
    app.use('/api', createApiTokenGate(
      (_req, res) => res.status(401).json({ error: 'SESSION_REQUIRED' }),
      () => db,
      { resolveAccessToken: async (memberId) => (memberId === 7 ? 'nex-access-token' : null) },
    ));
    app.get('/api/projects', (_req, res) => {
      res.json({ accessToken: res.locals.nextoreSession?.accessToken ?? null });
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const response = await fetch('http://127.0.0.1:' + port + '/api/projects', {
      headers: { authorization: 'Bearer ' + issued.token },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: 'nex-access-token' });
  });

  it('stays authenticated with an empty credential when the store has no session', async () => {
    process.env.NEXTORE_CLI_AUTH = 'on';
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'] });
    const app = express();
    app.use('/api', createApiTokenGate(
      (_req, res) => res.status(401).json({ error: 'SESSION_REQUIRED' }),
      () => db,
      { resolveAccessToken: async () => null },
    ));
    app.get('/api/projects', (_req, res) => {
      res.json({ accessToken: res.locals.nextoreSession?.accessToken ?? null });
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const response = await fetch('http://127.0.0.1:' + port + '/api/projects', {
      headers: { authorization: 'Bearer ' + issued.token },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: '' });
  });

  it('falls through to the session gate when the flag is off', async () => {
    const issued = createApiToken(db, { memberId: 7, scopes: ['project:read'] });
    const app = express();
    app.use('/api', createApiTokenGate(
      (_req, res) => res.status(401).json({ error: 'SESSION_REQUIRED' }),
      () => db,
    ));
    app.get('/api/projects', (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      headers: { authorization: 'Bearer ' + issued.token },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'SESSION_REQUIRED' });
  });
});
