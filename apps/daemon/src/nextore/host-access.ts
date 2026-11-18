// NexTore access host: one mount point for the edition's authentication gate,
// the DesignerAccess check, and the route kill switch.
//
// This code used to sit inline in `startServer`, so every upstream change
// around the middleware stack became a merge conflict. The host now takes its
// dependencies explicitly and returns the two pieces the server still needs:
// the auth object (for route registration) and the lazy secret loader.

import type { Express, NextFunction, Request, Response } from 'express';

import { createEditionRouteKillSwitch, type Edition } from '../edition/index.js';
import { createNextoreAuth, type NextoreAuth } from './auth/routes.js';
import { createApiTokenGate } from './auth/api-token-gate.js';
import { lazyNextoreSecrets, type NextoreSecrets } from './auth/secrets.js';
import { createNextoreSessionStore } from './auth/session-store.js';
import type { NextoreClient } from './client.js';
import type { NextoreConfig } from './config.js';
import { registerNextoreMcpRoutes } from './mcp/routes.js';
import { registerNextoreRoutes } from './routes.js';
import { registerNextoreWorkspaceRoutes } from './workspaces/routes.js';
import { registerNextoreDirectoryRoutes } from '../routes/nextore-directory.js';

type SessionDb = ReturnType<Parameters<typeof createNextoreSessionStore>[0]>;

export type NextoreAccessOptions = {
  app: Express;
  edition: Edition;
  config: NextoreConfig | null;
  client: NextoreClient | null;
  /** Sessions open the database lazily, on the first authenticated request. */
  getDb: () => SessionDb;
  /** Run-scoped export tools authenticate with their own signed token. */
  isRunScopedExportRequest: (req: Request) => boolean;
};

export type NextoreAccess = {
  auth: NextoreAuth | null;
  /** Lazy loader; secrets are read on first use, never at boot. */
  secrets: (() => NextoreSecrets) | null;
};

/**
 * Mount edition authentication.
 *
 * The edition signs the browser in through the site's OAuthServerModule
 * (code + PKCE) and keeps the resulting API key in an encrypted session row;
 * upstream keeps its API-token gate untouched. One lazy secret loader is
 * shared by sessions, per-user MCP headers, and anything else that needs
 * at-rest encryption in the edition.
 */
export function mountNextoreAccess(options: NextoreAccessOptions): NextoreAccess {
  const { app, edition, config, client, getDb, isRunScopedExportRequest } = options;

  const secrets = config ? lazyNextoreSecrets(config.secretFile) : null;
  const auth = config && client && secrets
    ? createNextoreAuth({
        config,
        client,
        secrets,
        store: createNextoreSessionStore(getDb, secrets),
        allowRequest: isRunScopedExportRequest,
      })
    : null;

  // Disabled product surfaces fail closed before body parsers and route
  // registrars, while an unset OD_EDITION leaves upstream behavior intact.
  app.use(createEditionRouteKillSwitch(edition));

  if (auth) {
    // Authenticate before the large body parsers below: an anonymous caller
    // must not be able to make the daemon buffer a 128 MB clipper capture.
    // The gate also verifies the browser Origin before it resolves a session,
    // so a cross-site request cannot trigger a token refresh or touch a row.
    app.use('/api', createApiTokenGate(auth.gate, getDb));
    app.use('/artifacts', auth.gate);
    app.use('/frames', auth.gate);

    if (edition === 'nextore') {
      // The session row can outlive a revoked DesignerAccess right. Reject
      // those requests before any business route runs, including stale rows
      // created before the callback enforced the bootstrap right.
      const requireDesignerAccess = (_req: Request, res: Response, next: NextFunction) => {
        const locals = res.locals as {
          nextoreSession?: { member?: { rights?: { access?: unknown } } };
          /** Set by the auth gate for probes that describe their own state. */
          nextoreDiagnostic?: boolean;
        };
        // The self-test reports "session ok, DesignerAccess missing" itself;
        // a bare 403 here would hide the diagnosis the caller asked for.
        if (locals.nextoreDiagnostic === true) return next();
        const session = locals.nextoreSession;
        if (!session?.member?.rights) return next();
        if (session.member.rights.access === true) return next();
        res.status(403).json({
          error: {
            code: 'DESIGNER_ACCESS_REQUIRED',
            message: 'Your NexTore account does not have access to Designer.',
          },
        });
      };
      app.use('/api', requireDesignerAccess);
      app.use('/artifacts', requireDesignerAccess);
      app.use('/frames', requireDesignerAccess);
      // '/auth/me' is outside the /api gate. Anonymous callers must keep the
      // route's 200 { signedIn: false } contract, so only invoke the session
      // gate when a session cookie is actually present.
      app.use('/auth/me', (req, res, next) => {
        if (!req.headers.cookie?.includes('nxd_session=')) return next();
        return auth.gate(req, res, next);
      });
      app.use('/auth/me', requireDesignerAccess);
    }
  }

  return { auth, secrets };
}

export type NextoreApiRouteOptions = {
  app: Express;
  client: NextoreClient | null;
  /** Route registration runs after the database is open, so it is never null here. */
  db: NonNullable<SessionDb>;
  secrets: (() => NextoreSecrets) | null;
};

/**
 * Register the edition's API surface once the auth host is mounted. Kept out of
 * `startServer` so upstream route changes do not collide with this wiring.
 */
export function registerNextoreApiRoutes(options: NextoreApiRouteOptions): void {
  const { app, client, db, secrets } = options;
  if (!client || !secrets) return;

  registerNextoreRoutes(app, { client });
  // Member directory for the transcript's author chips (NXD-D11).
  registerNextoreDirectoryRoutes(app);
  // Team workspace creation for Designer admins (NXD-D40).
  registerNextoreWorkspaceRoutes(app, { client });
  // Per-user external MCP servers (NXD-D21). The upstream global
  // `mcp-config.json` surface stays closed in the edition.
  registerNextoreMcpRoutes(app, { db, secrets });
}
