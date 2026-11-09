import type Database from 'better-sqlite3';
import type { Express, Request, Response } from 'express';

import type { NextoreConfig } from '../config.js';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import {
  createShareLink,
  listShareLinks,
  resolveShareExpiry,
  resolveShareLink,
  revokeShareLink,
} from './service.js';

type SqliteDb = Database.Database;

export interface RegisterNextoreShareRoutesDeps {
  db: SqliteDb;
  config: NextoreConfig;
  authorizeProject: AuthorizeProjectRequest;
  /** NexTore project id a local project maps to, or null when unmapped. */
  readProjectMapping: (localProjectId: string) => string | null;
}

interface ShareSessionView {
  memberId: number;
  shareLinksEnabled: boolean;
}

function readSession(res: Response): ShareSessionView | null {
  const session = (res.locals as {
    nextoreSession?: {
      memberId?: unknown;
      member?: { features?: { shareLinks?: unknown } | null } | null;
    };
  }).nextoreSession;
  if (
    !session
    || typeof session.memberId !== 'number'
    || !Number.isInteger(session.memberId)
    || session.memberId <= 0
  ) {
    return null;
  }
  return {
    memberId: session.memberId,
    shareLinksEnabled: session.member?.features?.shareLinks !== false,
  };
}

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/**
 * Share links (DESIGN §11.1, NXD-D20).
 *
 * Only a member with project CanManage can mint or revoke a link. The raw
 * token is returned once at creation; the database keeps only its SHA-256.
 * Opening a link grants that member read + comment on that one project, and
 * the central authorizer re-checks the live link on every request.
 */
export function registerNextoreShareRoutes(
  app: Express,
  deps: RegisterNextoreShareRoutesDeps,
): void {
  const requireSession = (res: Response): ShareSessionView | null => {
    const session = readSession(res);
    if (!session) {
      deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return null;
    }
    if (!session.shareLinksEnabled) {
      deny(res, 403, 'SHARE_LINKS_DISABLED', 'Share links are disabled by the NexTore administrator.');
      return null;
    }
    return session;
  };

  app.post('/api/nextore/projects/:id/share-links', async (req, res) => {
    const session = requireSession(res);
    if (!session) return;
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      deny(res, 400, 'BAD_REQUEST', 'project id is required');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) {
      return;
    }
    if (!deps.readProjectMapping(projectId)) {
      deny(res, 409, 'PROJECT_NOT_MAPPED', 'This project is not linked to NexTore yet.');
      return;
    }

    const body = req.body && typeof req.body === 'object'
      ? (req.body as { expiresAt?: unknown })
      : {};
    const expiry = resolveShareExpiry(body.expiresAt);
    if (!expiry.ok) {
      deny(res, 400, 'SHARE_EXPIRY_INVALID', expiry.message);
      return;
    }

    try {
      const link = createShareLink(deps.db, {
        projectId,
        createdByMemberId: session.memberId,
        expiresAt: expiry.expiresAt,
        baseUrl: deps.config.designerBaseUrl,
      });
      res.json({
        link: {
          id: link.id,
          url: link.url,
          expiresAt: link.expiresAt,
        },
      });
    } catch (error) {
      deny(res, 500, 'SHARE_LINK_CREATE_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/api/nextore/projects/:id/share-links', async (req, res) => {
    const session = requireSession(res);
    if (!session) return;
    const projectId = String(req.params.id ?? '');
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read', capability: 'share' })) {
      return;
    }
    res.json({ links: listShareLinks(deps.db, projectId) });
  });

  app.delete('/api/nextore/projects/:id/share-links/:linkId', async (req, res) => {
    const session = requireSession(res);
    if (!session) return;
    const projectId = String(req.params.id ?? '');
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) {
      return;
    }
    const revoked = revokeShareLink(deps.db, projectId, String(req.params.linkId ?? ''));
    if (!revoked) {
      deny(res, 404, 'SHARE_LINK_NOT_FOUND', 'No active share link with that id.');
      return;
    }
    res.json({ ok: true });
  });

  // Opening a link does not require DesignerAccess: any authenticated NexTore
  // member may redeem it. It does require the module's global share switch.
  app.post('/api/nextore/share-links/resolve', (req, res) => {
    const session = requireSession(res);
    if (!session) return;
    const body = req.body && typeof req.body === 'object'
      ? (req.body as { token?: unknown })
      : {};
    const resolved = resolveShareLink(deps.db, {
      token: typeof body.token === 'string' ? body.token : '',
      memberId: session.memberId,
    });
    if (!resolved) {
      deny(res, 404, 'SHARE_LINK_INVALID', 'This share link is invalid, revoked, or expired.');
      return;
    }
    res.json({ projectId: resolved.projectId });
  });
}
