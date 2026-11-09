import type Database from 'better-sqlite3';
import type { Express, Response } from 'express';
import type { McpServersResponse } from '@open-design/contracts';

import type { NextoreSecrets } from '../auth/secrets.js';
import { MCP_TEMPLATES } from '../../mcp-config.js';
import {
  listNextoreMcpServers,
  replaceNextoreMcpServers,
} from './store.js';

type SqliteDb = Database.Database;

export interface RegisterNextoreMcpRoutesDeps {
  db: SqliteDb;
  /** Lazy loader; the daemon must boot even when the secret file is absent. */
  secrets: () => NextoreSecrets;
}

interface McpSessionView {
  memberId: number;
  mcpEnabled: boolean;
  manageMcp: boolean;
}

function readSession(res: Response): McpSessionView | null {
  const session = (res.locals as {
    nextoreSession?: {
      memberId?: unknown;
      member?: {
        features?: { mcp?: unknown } | null;
        rights?: { manageMcp?: unknown } | null;
      } | null;
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
    mcpEnabled: session.member?.features?.mcp !== false,
    // Rights are security-sensitive: a session written before rights were
    // cached must not inherit MCP access. The next bootstrap refresh fills it.
    manageMcp: session.member?.rights?.manageMcp === true,
  };
}

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/**
 * Per-user external MCP configuration (DESIGN §10, NXD-D21).
 *
 * The edition never reads the upstream global `mcp-config.json` and has no
 * managed OAuth flow: each member stores remote HTTP/SSE servers with their
 * own headers, encrypted under the deployment secret. stdio is rejected by
 * the store, so no row can turn into a host-command spawn.
 */
export function registerNextoreMcpRoutes(
  app: Express,
  deps: RegisterNextoreMcpRoutesDeps,
): void {
  const remoteTemplates = MCP_TEMPLATES.filter(
    (template) => template.transport === 'http' || template.transport === 'sse',
  );

  const accessible = (res: Response): McpSessionView | null => {
    const session = readSession(res);
    if (!session) {
      deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return null;
    }
    if (!session.mcpEnabled) {
      deny(res, 403, 'MCP_DISABLED', 'MCP is disabled by the NexTore administrator.');
      return null;
    }
    if (!session.manageMcp) {
      deny(res, 403, 'MCP_FORBIDDEN', 'You do not have the DesignerManageMcp right.');
      return null;
    }
    return session;
  };

  app.get('/api/nextore/mcp/access', (_req, res: Response) => {
    const session = readSession(res);
    if (!session) {
      deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    res.json({
      enabled: session.mcpEnabled,
      allowed: session.mcpEnabled && session.manageMcp,
    });
  });

  app.get('/api/nextore/mcp/servers', (_req, res: Response) => {
    const session = accessible(res);
    if (!session) return;
    const payload: McpServersResponse = {
      servers: listNextoreMcpServers(deps.db, deps.secrets(), session.memberId),
      templates: remoteTemplates,
    };
    res.json(payload);
  });

  app.put('/api/nextore/mcp/servers', (req, res: Response) => {
    const session = accessible(res);
    if (!session) return;
    try {
      const body = req.body && typeof req.body === 'object'
        ? (req.body as { servers?: unknown })
        : {};
      const servers = replaceNextoreMcpServers(
        deps.db,
        deps.secrets(),
        session.memberId,
        body.servers,
      );
      const payload: McpServersResponse = { servers, templates: remoteTemplates };
      res.json(payload);
    } catch (error) {
      deny(
        res,
        400,
        'MCP_CONFIG_INVALID',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
