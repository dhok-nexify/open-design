import type Database from 'better-sqlite3';
import type { Express, Response } from 'express';

import {
  API_TOKEN_SCOPES,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from './api-tokens.js';
import { issueCliCode, redeemCliCode } from './cli-auth.js';

type SqliteDb = Database.Database;

export interface RegisterCliAuthRoutesDeps {
  db: () => SqliteDb;
  /** NXD-P10 feature flag; default off in every environment. */
  enabled: boolean;
  now?: () => number;
}

function sessionMemberId(res: Response): number | null {
  const session = (res.locals as { nextoreSession?: { memberId?: unknown; sid?: unknown } })
    .nextoreSession;
  const id = session?.memberId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * NXD-P10 CLI authorization.
 *
 * The browser proves the human with its NexTore session; the CLI proves the
 * channel with PKCE + state over a loopback redirect, then receives a scoped
 * bearer token that is stored only as a SHA-256 digest.
 */
export function registerCliAuthRoutes(app: Express, deps: RegisterCliAuthRoutesDeps): void {
  if (!deps.enabled) {
    app.use('/api/auth/cli', (_req, res) => {
      res.status(404).json({ error: 'feature_disabled' });
    });
    return;
  }
  const now = deps.now ?? Date.now;

  app.post('/api/auth/cli/session', (req, res) => {
    const memberId = sessionMemberId(res);
    if (!memberId) {
      res.status(401).json({ error: 'SESSION_REQUIRED', message: 'Sign in through NexTore first.' });
      return;
    }
    const body = req.body && typeof req.body === 'object'
      ? req.body as { challenge?: unknown; state?: unknown }
      : {};
    const challenge = typeof body.challenge === 'string' ? body.challenge : '';
    const state = typeof body.state === 'string' ? body.state : '';
    try {
      const issued = issueCliCode(deps.db(), {
        memberId,
        sessionSid: typeof (res.locals as { nextoreSession?: { sid?: unknown } })
          .nextoreSession?.sid === 'string'
          ? String((res.locals as { nextoreSession?: { sid?: unknown } }).nextoreSession!.sid)
          : null,
        challenge,
        state,
        now: now(),
      });
      res.json({ code: issued.code, expiresAt: issued.expiresAt });
    } catch {
      res.status(400).json({ error: 'invalid_request', message: 'challenge and state are required.' });
    }
  });

  app.post('/api/auth/cli/token', (req, res) => {
    const body = req.body && typeof req.body === 'object'
      ? req.body as { code?: unknown; verifier?: unknown; state?: unknown; label?: unknown }
      : {};
    const code = typeof body.code === 'string' ? body.code : '';
    const verifier = typeof body.verifier === 'string' ? body.verifier : '';
    const state = typeof body.state === 'string' ? body.state : '';
    const redeemed = redeemCliCode(deps.db(), { code, verifier, state, now: now() });
    if (!redeemed) {
      // One shape for every failure: unknown code, replay, expiry, bad state and
      // a wrong verifier must not be distinguishable to a caller.
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const issued = createApiToken(deps.db(), {
      memberId: redeemed.memberId,
      scopes: [...API_TOKEN_SCOPES],
      label: typeof body.label === 'string' ? body.label.slice(0, 120) : 'od CLI',
      // Remember which browser session approved this token: the NexTore-bound
      // routes act as that session, never as a shared account and never as an
      // unrelated session of the same member.
      sessionSid: redeemed.sessionSid,
      now: now(),
    });
    res.json({
      token: issued.token,
      tokenId: issued.id,
      memberId: redeemed.memberId,
      scopes: issued.scopes,
      expiresAt: issued.expiresAt,
    });
  });

  app.delete('/api/auth/cli/token', (req, res) => {
    const session = (res.locals as { nextoreSession?: { sid?: unknown; memberId?: unknown } })
      .nextoreSession;
    const sid = typeof session?.sid === 'string' ? session.sid : '';
    if (!sid.startsWith('api-token:')) {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    const id = sid.slice('api-token:'.length);
    const memberId = typeof session?.memberId === 'number' ? session.memberId : 0;
    res.json({ revoked: revokeApiToken(deps.db(), memberId, id, now()) });
  });
  app.get('/api/auth/cli/tokens', (req, res) => {
    const memberId = sessionMemberId(res);
    if (!memberId) {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    res.json({ tokens: listApiTokens(deps.db(), memberId) });
  });

  app.delete('/api/auth/cli/tokens/:id', (req, res) => {
    const memberId = sessionMemberId(res);
    if (!memberId) {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    const revoked = revokeApiToken(deps.db(), memberId, String(req.params.id ?? ''), now());
    if (!revoked) {
      res.status(404).json({ error: 'token_not_found' });
      return;
    }
    res.json({ revoked: true });
  });
}
