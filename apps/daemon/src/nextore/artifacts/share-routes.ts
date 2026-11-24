import type { Express, Response } from 'express';
import type {
  NextoreArtifactShareDescribe,
  NextoreArtifactShareRequest,
  NextoreArtifactShareResult,
} from '@open-design/contracts';

import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import { NextoreClientError, type NextoreArtifactClient } from '../client.js';
import type { NextoreArtifactRuntime } from './runtime.js';

export interface RegisterNextoreArtifactShareRoutesDeps {
  runtime: NextoreArtifactRuntime | null;
  client: NextoreArtifactClient | null;
  authorizeProject: AuthorizeProjectRequest;
}

const SHARE_REPRESENTATIONS = new Set(['source', 'snapshot']);

function fail(
  res: Response,
  status: number,
  code: string,
  message?: string,
  extra?: Record<string, unknown>,
): void {
  const body: Record<string, unknown> = { error: code };
  if (message) body.message = message;
  if (extra) Object.assign(body, extra);
  res.status(status).json(body);
}

function sessionMemberId(res: Response): number | null {
  const session = (res.locals as { nextoreSession?: { memberId?: unknown } }).nextoreSession;
  const id = session?.memberId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

// The copy button must hand out the branded page, not the platform URL, while
// keeping the platform link one step away for password and restricted shares.
function brandedShareUrl(
  req: { protocol: string; get(name: string): string | undefined },
  url: string,
): string {
  try {
    const key = new URL(url).searchParams.get('key');
    const host = req.get('host');
    if (!key || !host) return url;
    return req.protocol + '://' + host + '/share?key=' + encodeURIComponent(key);
  } catch {
    return url;
  }
}

function readBody(value: unknown): NextoreArtifactShareRequest {
  return value && typeof value === 'object' ? value as NextoreArtifactShareRequest : {};
}

function mapClientError(res: Response, error: unknown, fallbackCode: string): void {
  if (error instanceof NextoreClientError) {
    const status = error.statusCode;
    if (status === 401) {
      fail(res, 401, 'auth_required', error.message);
      return;
    }
    if (status === 403) {
      fail(res, 403, error.upstreamCode ?? 'share_forbidden', error.message);
      return;
    }
    if (status === 404) {
      fail(res, 404, error.upstreamCode ?? 'artifact_not_found', error.message);
      return;
    }
    if (status === 409) {
      fail(res, 409, error.upstreamCode ?? fallbackCode, error.message);
      return;
    }
    if (status === 400) {
      fail(res, 400, error.upstreamCode ?? 'invalid_request', error.message);
      return;
    }
    if (typeof status === 'number' && status >= 500) {
      res.setHeader('Retry-After', '5');
      fail(res, 503, 'nextore_unavailable', error.message);
      return;
    }
    fail(res, 502, error.upstreamCode ?? fallbackCode, error.message);
    return;
  }
  fail(res, 500, 'internal_server_error', error instanceof Error ? error.message : undefined);
}

/**
 * P04e share authority. New links are NexTore ShareObjects; the daemon never
 * mints its own token here. The legacy /s/<token> surface stays read-only for
 * existing links until its sunset (P04h).
 */
export function registerNextoreArtifactShareRoutes(
  app: Express,
  deps: RegisterNextoreArtifactShareRoutesDeps,
): void {
  const unavailable = (res: Response): boolean => {
    if (deps.runtime && deps.client) return false;
    fail(res, 404, 'feature_disabled', 'Artifact sharing requires the NexTore edition.');
    return true;
  };

  app.post('/api/nextore/projects/:id/artifacts/:artifactId/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    const body = readBody(req.body);
    if (!projectId || !artifactId) {
      fail(res, 400, 'BAD_REQUEST', 'project and artifact ids are required');
      return;
    }
    if (body.pinVersion === true) {
      // ShareObject always follows the live object. Pinning needs a per-version
      // copy, which this phase does not create; refuse instead of pretending.
      fail(res, 409, 'pin_version_unsupported', 'Pinned share links are not available yet.');
      return;
    }
    const representation = (body.representation ?? 'snapshot') as 'source' | 'snapshot';
    if (!SHARE_REPRESENTATIONS.has(representation)) {
      fail(res, 400, 'invalid_representation', 'representation must be snapshot or source.');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const record = runtime.artifactRecord(projectId, artifactId, representation);
    if (!record || record.status !== 'published') {
      fail(res, 409, 'share_not_ready', record
        ? `The ${representation} representation is ${record.status}.`
        : 'The representation has not been published to NexTore yet.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      const result = await client.shareArtifact<NextoreArtifactShareResult | Record<string, unknown>>(
        accessToken,
        nextoreProjectId,
        artifactId,
        { ...body, representation, previewOnly: body.previewOnly !== false },
      );
      const url = typeof (result as { url?: unknown }).url === 'string'
        ? (result as { url: string }).url
        : null;
      if (!url) {
        fail(res, 502, 'share_failed', 'NexTore did not return a share URL.');
        return;
      }
      const payload: NextoreArtifactShareResult = {
        url: brandedShareUrl(req, url),
        representation,
        previewOnly: body.previewOnly !== false,
        pinnedVersion: null,
        expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
        hasPassword: Boolean(body.password),
      };
      res.json(payload);
    } catch (error) {
      mapClientError(res, error, 'share_failed');
    }
  });

  app.delete('/api/nextore/projects/:id/artifacts/:artifactId/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    const raw = typeof req.query.representation === 'string' ? req.query.representation : 'snapshot';
    if (!SHARE_REPRESENTATIONS.has(raw)) {
      fail(res, 400, 'invalid_representation', 'representation must be snapshot or source.');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      await client.revokeArtifactShare(accessToken, nextoreProjectId, artifactId, raw);
      res.json({ projectId, artifactId, representation: raw, revoked: true });
    } catch (error) {
      mapClientError(res, error, 'share_failed');
    }
  });

  /**
   * GET .../artifacts/:artifactId/share — the current file link, if any.
   * Reading must not depend on the local publish row: a link created earlier
   * stays reachable (and revocable) even if this daemon never saw the publish.
   */
  app.get('/api/nextore/projects/:id/artifacts/:artifactId/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    const raw = typeof req.query.representation === 'string' ? req.query.representation : 'snapshot';
    if (!SHARE_REPRESENTATIONS.has(raw)) {
      fail(res, 400, 'invalid_representation', 'representation must be snapshot or source.');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      const result = await client.describeArtifactShare<{ url?: unknown }>(
        accessToken, nextoreProjectId, artifactId, raw,
      );
      const moduleUrl = typeof result?.url === 'string' ? result.url : null;
      const url = moduleUrl ? brandedShareUrl(req, moduleUrl) : null;
      const payload: NextoreArtifactShareDescribe = {
        projectId, artifactId, representation: raw as 'source' | 'snapshot',
        shared: Boolean(url), url,
      };
      res.json(payload);
    } catch (error) {
      mapClientError(res, error, 'share_failed');
    }
  });

  /** GET /api/nextore/projects/:id/share — the current folder link, if any. */
  app.get('/api/nextore/projects/:id/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      fail(res, 400, 'BAD_REQUEST', 'project id is required');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      const result = await client.projectShare<{ shared?: unknown; url?: unknown }>(
        accessToken,
        nextoreProjectId,
      );
      const url = typeof result?.url === 'string' && result.url ? result.url : null;
      res.json({ projectId, shared: result?.shared === true && url !== null, url });
    } catch (error) {
      mapClientError(res, error, 'share_status_failed');
    }
  });

  /**
   * DELETE /api/nextore/projects/:id/share — revoke the folder link.
   *
   * Repeat deletes are a normal outcome of a refresh-then-click race, so an
   * already-absent link answers { revoked: false } instead of an error.
   */
  app.delete('/api/nextore/projects/:id/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      fail(res, 400, 'BAD_REQUEST', 'project id is required');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      const result = await client.unshareProject<{ revoked?: unknown }>(
        accessToken,
        nextoreProjectId,
      );
      res.json({ projectId, revoked: result?.revoked !== false });
    } catch (error) {
      if (error instanceof NextoreClientError && error.statusCode === 404) {
        res.json({ projectId, revoked: false });
        return;
      }
      mapClientError(res, error, 'share_revoke_failed');
    }
  });

  app.post('/api/nextore/projects/:id/share', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    const body = readBody(req.body);
    if (!projectId) {
      fail(res, 400, 'BAD_REQUEST', 'project id is required');
      return;
    }
    if (body.pinVersion === true) {
      fail(res, 409, 'pin_version_unsupported', 'Pinned share links are not available yet.');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_not_mapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    try {
      const result = await client.shareProject<Record<string, unknown>>(
        accessToken,
        nextoreProjectId,
        body,
      );
      const url = typeof result?.url === 'string' ? result.url : null;
      if (!url) {
        fail(res, 502, 'share_failed', 'NexTore did not return a share URL.');
        return;
      }
      res.json({
        url,
        scope: 'project',
        previewOnly: body.previewOnly !== false,
        expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
        hasPassword: Boolean(body.password),
      });
    } catch (error) {
      mapClientError(res, error, 'share_failed');
    }
  });
}
