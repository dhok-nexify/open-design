import { classifySunsetBucket } from './sunset-notices.js';
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
  /**
   * P04e: once NexTore ShareObject is the share authority, the custom token
   * surface stops minting new links. Existing links keep resolving until the
   * sunset below.
   */
  legacyWriteDisabled?: boolean;
  /** ISO timestamp of the announced legacy sunset, echoed on resolve. */
  legacySunsetAt?: string | null;
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
    if (deps.legacyWriteDisabled) {
      deny(res, 410, 'legacy_share_retired', 'Use the NexTore share endpoint; custom share links are retired.');
      return;
    }
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
    if (deps.legacyWriteDisabled) {
      deny(res, 410, 'legacy_share_retired', 'Custom share links are retired.');
      return;
    }
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
  /**
   * P04h sunset report: the caller's own active legacy links, bucketed by how
   * soon they expire. Creator-scoped on purpose — a global view would leak
   * other members' link metadata. A notification job consumes this; nothing is
   * sent from here.
   */
  app.get('/api/nextore/share-links/sunset-report', (req, res) => {
    const session = requireSession(res);
    if (!session) return;
    const now = Date.now();
    const rows = deps.db.prepare(`
      SELECT token_hash, project_id, expires_at
        FROM nextore_share_links
       WHERE created_by_member_id = ? AND revoked_at IS NULL
       ORDER BY expires_at IS NULL DESC, expires_at ASC
    `).all(session.memberId) as Array<{
      token_hash: string;
      project_id: string;
      expires_at: number | null;
    }>;
    const items = rows.map((row) => {
      const expiresAt = row.expires_at;
      // One bucketing rule, shared with the sunset sweep, so the report and the
      // notifier can never disagree about which window a link is in.
      const bucket = classifySunsetBucket(expiresAt, now);
      return { linkId: row.token_hash, projectId: row.project_id, expiresAt, bucket };
    });
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.bucket] = (acc[item.bucket] ?? 0) + 1;
      return acc;
    }, {});
    res.json({
      generatedAt: now,
      sunsetAt: deps.legacySunsetAt ?? null,
      counts,
      items,
    });
  });

  app.post('/api/nextore/share-links/resolve', (req, res) => {
    if (deps.legacySunsetAt) {
      res.setHeader('X-NexTore-Legacy-Share', `sunset-at=${deps.legacySunsetAt}`);
    }
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
