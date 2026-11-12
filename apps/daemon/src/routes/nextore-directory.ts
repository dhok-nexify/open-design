import type { Express, Response } from 'express';
import { resolveEdition } from '@open-design/contracts';

import type { NextoreSessionView } from '@open-design/contracts';
import { readNextoreConfig } from '../nextore/config.js';
import { normalizeMember, wireArray } from '../nextore/wire.js';

export interface NextoreDirectoryDeps {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface SessionView {
  accessToken?: string;
  memberId?: number;
  member?: {
    rights?: {
      access?: unknown;
      createProject?: unknown;
      admin?: unknown;
      manageMcp?: unknown;
    } | null;
    groups?: unknown;
  } | null;
}

function readSession(res: Response): SessionView | null {
  const session = (res.locals as { nextoreSession?: SessionView }).nextoreSession;
  if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
    return null;
  }
  return session;
}

/**
 * Member directory for the NexTore edition (NXD-D11).
 *
 * Messages store an author id; the transcript needs a name to show it. The
 * module owns the directory, so the daemon only forwards the lookup with the
 * caller's own session key — no shared service credential.
 */
export function registerNextoreDirectoryRoutes(
  app: Express,
  deps: NextoreDirectoryDeps = {},
): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  // The browser needs to know which member it is, so it can hide the author
  // chip on its own messages.
  app.get('/api/nextore/session', (_req, res: Response) => {
    const session = readSession(res);
    if (!session || typeof session.memberId !== 'number') {
      res.status(401).json({
        error: { code: 'SESSION_REQUIRED', message: 'A NexTore session is required.' },
      });
      return;
    }

    const rights = session.member?.rights;
    const body: NextoreSessionView = {
      memberId: session.memberId,
      // Fails closed: a session without cached rights cannot create team
      // workspaces until the next bootstrap revalidation fills them.
      rights: {
        access: rights?.access === true,
        createProject: rights?.createProject === true,
        admin: rights?.admin === true,
        manageMcp: rights?.manageMcp === true,
      },
      groups: Array.isArray(session.member?.groups)
        ? (session.member.groups as NextoreSessionView['groups'])
        : [],
    };
    res.json(body);
  });

  app.get('/api/nextore/members', async (req, res: Response) => {
    const session = readSession(res);
    if (!session) {
      res.status(401).json({
        error: { code: 'SESSION_REQUIRED', message: 'A NexTore session is required.' },
      });
      return;
    }

    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 100);
    if (ids.length === 0) {
      res.json({ members: [] });
      return;
    }

    const config = readNextoreConfig(process.env, resolveEdition(process.env.OD_EDITION));
    if (!config) {
      res.status(503).json({
        error: { code: 'NEXTORE_UNAVAILABLE', message: 'NexTore is not configured.' },
      });
      return;
    }

    try {
      const upstream = await fetchImpl(
        config.baseUrl + '/api/designer/members?ids=' + ids.join(','),
        {
          headers: {
            accept: 'application/json',
            APIkey: String(session.accessToken),
          },
        },
      );
      const payload = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        res.status(upstream.status === 403 ? 403 : 503).json({
          error: {
            code: upstream.status === 403 ? 'PROJECT_FORBIDDEN' : 'NEXTORE_UNAVAILABLE',
            message: 'NexTore could not return the member directory.',
          },
        });
        return;
      }
      const members = wireArray(payload, 'members', 'Members')
        .map(normalizeMember)
        .filter((member): member is NonNullable<ReturnType<typeof normalizeMember>> => member !== null);
      res.json({ members });
    } catch (error) {
      res.status(503).json({
        error: {
          code: 'NEXTORE_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}
