import type { Express, Response } from 'express';
import {
  isNextoreTeamWorkspaceRole,
  resolveEdition,
  type CreateNextoreTeamWorkspaceRequest,
  type CreateNextoreTeamWorkspaceResponse,
  type NextoreGroupsResponse,
} from '@open-design/contracts';

import { NextoreClientError, type NextoreClient } from '../client.js';
import { wireArray, wireNumber, wireString } from '../wire.js';

/** Maximum grants honored on one team workspace (mirrors the module). */
export const MAX_TEAM_WORKSPACE_GRANTS = 50;
const MAX_WORKSPACE_NAME_LENGTH = 128;

export interface ParsedTeamWorkspaceRequest {
  name: string;
  grants: CreateNextoreTeamWorkspaceRequest['grants'];
}

export type TeamWorkspaceParseResult =
  | { ok: true; value: ParsedTeamWorkspaceRequest }
  | { ok: false; message: string };

/**
 * Validates the web/CLI create-team-workspace body. Pure so the acceptance
 * rules (name budget, role names, duplicate groups, grant cap) are testable
 * without an HTTP server or the module.
 *
 * The body names roles only; the module maps each role to its explicit
 * permission flags, so the role matrix lives in one place.
 */
export function parseTeamWorkspaceRequest(body: unknown): TeamWorkspaceParseResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'A workspace payload is required.' };
  }

  const record = body as { name?: unknown; grants?: unknown };
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return { ok: false, message: 'A workspace name is required.' };
  }
  if (name.length > MAX_WORKSPACE_NAME_LENGTH) {
    return { ok: false, message: `A workspace name may be at most ${MAX_WORKSPACE_NAME_LENGTH} characters.` };
  }

  if (!Array.isArray(record.grants) || record.grants.length === 0) {
    return { ok: false, message: 'At least one group and role is required.' };
  }
  if (record.grants.length > MAX_TEAM_WORKSPACE_GRANTS) {
    return { ok: false, message: `A workspace may share with at most ${MAX_TEAM_WORKSPACE_GRANTS} groups.` };
  }

  const seen = new Set<number>();
  const grants: CreateNextoreTeamWorkspaceRequest['grants'] = [];
  for (const entry of record.grants) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, message: 'Every grant needs a group id and a role.' };
    }
    const grant = entry as { groupId?: unknown; role?: unknown };
    const groupId = grant.groupId;
    if (typeof groupId !== 'number' || !Number.isInteger(groupId) || groupId <= 0) {
      return { ok: false, message: 'Every grant needs a valid group id.' };
    }
    if (!isNextoreTeamWorkspaceRole(grant.role)) {
      return { ok: false, message: 'Every grant needs a role of manager, editor or reader.' };
    }
    if (seen.has(groupId)) {
      return { ok: false, message: 'Each group may appear only once.' };
    }
    seen.add(groupId);
    grants.push({ groupId, role: grant.role });
  }

  return { ok: true, value: { name, grants } };
}

export interface RegisterNextoreWorkspaceRoutesDeps {
  client: NextoreClient;
}

interface WorkspaceSessionView {
  accessToken?: string;
  member?: { rights?: { admin?: unknown } | null } | null;
}

function readSession(res: Response): WorkspaceSessionView | null {
  const session = (res.locals as { nextoreSession?: WorkspaceSessionView }).nextoreSession;
  if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
    return null;
  }
  return session;
}

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/**
 * Team workspace creation (DESIGN §15.3, NXD-D40).
 *
 * The module owns the DesignerAdmin gate; the daemon re-checks the cached
 * bootstrap right so a non-admin gets a 403 before any module round trip and
 * the dialog can hide the entry. Roles travel as names; the module maps them
 * to its permission presets.
 */
export function registerNextoreWorkspaceRoutes(
  app: Express,
  deps: RegisterNextoreWorkspaceRoutesDeps,
): void {
  // Group directory for the team-workspace dialog. The member bootstrap only
  // lists the caller's groups, which is not enough for an admin granting
  // ND Manager / ND Editor / ND Reader.
  app.get('/api/nextore/groups', async (req, res: Response) => {
    if (resolveEdition(process.env.OD_EDITION) !== 'nextore') {
      deny(res, 404, 'FEATURE_DISABLED', 'not available in this edition');
      return;
    }

    const session = readSession(res);
    if (!session) {
      deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    if (session.member?.rights?.admin !== true) {
      deny(res, 403, 'ADMIN_REQUIRED', 'Only a NexTore Designer administrator can list groups.');
      return;
    }

    const rawQuery = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const query = rawQuery.slice(0, 128);

    try {
      const payload = await deps.client.groups<unknown>(
        session.accessToken!.trim(),
        query || undefined,
      );
      const groups = wireArray(payload, 'groups', 'Groups')
        .map((entry) => {
          const id = wireNumber(entry, 'id', 'Id');
          if (id === null || id === undefined) return null;
          return { id, name: wireString(entry, 'name', 'Name')?.trim() || '' };
        })
        .filter((group): group is { id: number; name: string } => group !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      const body: NextoreGroupsResponse = {
        groups,
        truncated: (payload as { truncated?: unknown }).truncated === true
          || (payload as { Truncated?: unknown }).Truncated === true,
      };
      res.json(body);
    } catch (error) {
      if (error instanceof NextoreClientError && error.statusCode === 403) {
        deny(res, 403, 'ADMIN_REQUIRED', 'NexTore refused to list groups for this member.');
        return;
      }
      deny(
        res,
        503,
        'NEXTORE_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post('/api/nextore/workspaces', async (req, res: Response) => {
    if (resolveEdition(process.env.OD_EDITION) !== 'nextore') {
      deny(res, 404, 'FEATURE_DISABLED', 'not available in this edition');
      return;
    }

    const session = readSession(res);
    if (!session) {
      deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    if (session.member?.rights?.admin !== true) {
      deny(res, 403, 'ADMIN_REQUIRED', 'Only a NexTore Designer administrator can create team workspaces.');
      return;
    }

    const parsed = parseTeamWorkspaceRequest(req.body);
    if (!parsed.ok) {
      deny(res, 400, 'BAD_REQUEST', parsed.message);
      return;
    }

    const accessToken = session.accessToken!.trim();
    try {
      const created = await deps.client.createWorkspace<unknown>(accessToken, parsed.value);
      const id = wireNumber(created, 'id', 'Id');
      if (id === null || id === undefined) {
        deny(res, 502, 'NEXTORE_RESPONSE_INVALID', 'NexTore created the workspace but returned no id.');
        return;
      }
      const body: CreateNextoreTeamWorkspaceResponse = {
        id,
        name: wireString(created, 'name', 'Name')?.trim() || parsed.value.name,
        type: 'team',
      };
      res.status(201).json(body);
    } catch (error) {
      if (error instanceof NextoreClientError && error.statusCode === 403) {
        deny(res, 403, 'ADMIN_REQUIRED', 'NexTore refused to create the team workspace.');
        return;
      }
      if (error instanceof NextoreClientError && error.statusCode === 400) {
        deny(res, 400, 'BAD_REQUEST', error.message);
        return;
      }
      deny(
        res,
        503,
        'NEXTORE_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
