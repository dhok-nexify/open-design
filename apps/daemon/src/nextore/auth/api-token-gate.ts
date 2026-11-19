import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type Database from 'better-sqlite3';

import { API_TOKEN_PREFIX, apiTokenAllowsRequest, verifyApiToken } from './api-tokens.js';

type SqliteDb = Database.Database;

/**
 * NXD-P10 bearer gate.
 *
 * A CLI token is verified against the token table on every request, so a
 * logout or admin revoke takes effect immediately. Requests without a CLI token
 * fall through to the browser-session gate unchanged.
 */
export interface ApiTokenGateOptions {
  /**
   * Resolve the member's NexTore access token from the daemon's own session
   * store. A CLI token proves the member, but the module-backed project routes
   * still call NexTore as that member and read the credential off the resolved
   * session. Without this the caller is authenticated and then refused with
   * SESSION_REQUIRED one layer down.
   */
  resolveAccessToken?: (memberId: number) => Promise<string | null>;
}

export function createApiTokenGate(
  sessionGate: RequestHandler,
  getDb: () => SqliteDb | null,
  options: ApiTokenGateOptions = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NEXTORE_CLI_AUTH !== 'on') {
      sessionGate(req, res, next);
      return;
    }
    const authorization = req.get('authorization') ?? '';
    const raw = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!raw.startsWith(API_TOKEN_PREFIX)) {
      sessionGate(req, res, next);
      return;
    }
    let row = null;
    try {
      const db = getDb();
      row = db ? verifyApiToken(db, raw) : null;
    } catch {
      row = null;
    }
    if (!row) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    if (!apiTokenAllowsRequest(row, req.method, req.path)) {
      res.status(403).json({ error: 'insufficient_scope' });
      return;
    }
    const at = Date.now();
    const attach = (accessToken: string): void => {
      res.locals.nextoreSession = {
        sid: 'api-token:' + row!.id,
        memberId: row!.memberId,
        member: {
          id: row!.memberId,
          login: '',
          fullName: '',
          email: '',
          language: 'en',
          profileObjectId: 0,
        },
        accessToken,
        refreshToken: null,
        tokenExpiresAt: row!.expiresAt,
        createdAt: row!.createdAt,
        lastSeenAt: at,
        lastValidatedAt: at,
        apiTokenScopes: row!.scopes,
      };
      next();
    };
    if (!options.resolveAccessToken) {
      attach('');
      return;
    }
    // A missing store row is not an auth failure: the caller stays authenticated
    // and the route that needs NexTore answers with its own SESSION_REQUIRED.
    void options.resolveAccessToken(row.memberId).then(
      (token) => attach(token ?? ''),
      () => attach(''),
    );
  };
}
