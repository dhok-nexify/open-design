import { Readable } from 'node:stream';
import type { Express, Response } from 'express';
import type { NextoreArtifactRepresentation } from '@open-design/contracts';

import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import { NextoreClientError, type NextoreArtifactClient } from '../client.js';
import type { NextoreArtifactRuntime } from './runtime.js';

const REPRESENTATIONS = new Set<NextoreArtifactRepresentation>(['source', 'snapshot', 'cover']);

export interface RegisterNextoreArtifactDownloadRoutesDeps {
  runtime: NextoreArtifactRuntime | null;
  client: NextoreArtifactClient | null;
  authorizeProject: AuthorizeProjectRequest;
  /** Project display name used for the ZIP attachment; defaults to the local id. */
  readProjectName?: (projectId: string) => string | null;
}

function fail(res: Response, status: number, code: string, message?: string): void {
  const body: Record<string, unknown> = { error: code };
  if (message) body.message = message;
  res.status(status).json(body);
}

function sessionMemberId(res: Response): number | null {
  const session = (res.locals as { nextoreSession?: { memberId?: unknown } }).nextoreSession;
  const id = session?.memberId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

function parseRepresentation(value: unknown): NextoreArtifactRepresentation | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return REPRESENTATIONS.has(text as NextoreArtifactRepresentation)
    ? (text as NextoreArtifactRepresentation)
    : null;
}

/** null = not requested; undefined = requested but invalid. */
function parseVersion(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readRange(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** RFC 6266 / RFC 5987: ASCII fallback plus the UTF-8 filename. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function fileNameFromPath(relativePath: string, fallback: string): string {
  const base = relativePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return base && base.trim() ? base : fallback;
}

/**
 * Relay the module response without buffering. A module that ignores Range and
 * answers 200 must not advertise byte ranges, so `Accept-Ranges` comes from the
 * upstream response rather than being assumed.
 */
function relay(res: Response, upstream: globalThis.Response, filename: string): void {
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const length = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  res.status(upstream.status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.setHeader('Accept-Ranges', acceptRanges ?? (upstream.status === 206 ? 'bytes' : 'none'));
  res.setHeader('Cache-Control', 'private, no-store');
  if (length) res.setHeader('Content-Length', length);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (!upstream.body) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(upstream.body as never);
  body.on('error', () => res.destroy());
  res.on('close', () => body.destroy());
  body.pipe(res);
}

function relayClientError(res: Response, error: unknown): void {
  if (error instanceof NextoreClientError) {
    if (error.code === 'nextore_timeout' || error.code === 'nextore_unreachable') {
      res.setHeader('Retry-After', '5');
      fail(res, 503, 'nextore_unavailable', error.message);
      return;
    }
    const status = error.statusCode;
    if (status === 401) {
      fail(res, 401, 'auth_required', error.message);
      return;
    }
    if (status === 403) {
      fail(res, 403, error.upstreamCode ?? 'artifact_forbidden', error.message);
      return;
    }
    if (status === 404) {
      fail(res, 404, error.upstreamCode ?? 'artifact_not_found', error.message);
      return;
    }
    if (typeof status === 'number' && status >= 500) {
      res.setHeader('Retry-After', '5');
      fail(res, 503, 'nextore_unavailable', error.message);
      return;
    }
    fail(res, 502, error.upstreamCode ?? 'nextore_http_error', error.message);
    return;
  }
  fail(res, 500, 'internal_server_error', error instanceof Error ? error.message : undefined);
}

/**
 * P04d download authority. The daemon never reads its own copy of a published
 * artifact: it resolves the published record, then streams NexTore's response so
 * the module stays the system of record for content and CanDownload.
 */
export function registerNextoreArtifactDownloadRoutes(
  app: Express,
  deps: RegisterNextoreArtifactDownloadRoutesDeps,
): void {
  const unavailable = (res: Response): boolean => {
    if (deps.runtime && deps.client) return false;
    fail(res, 404, 'feature_disabled', 'Artifact downloads require the NexTore edition.');
    return true;
  };

  app.get('/api/nextore/projects/:id/artifacts/:artifactId/download', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    const representation = parseRepresentation(req.query.representation ?? 'source');
    if (!representation) {
      fail(res, 400, 'invalid_representation', 'representation must be source, snapshot or cover.');
      return;
    }
    const version = parseVersion(req.query.version);
    if (version === undefined) {
      fail(res, 400, 'invalid_request', 'version must be a positive integer.');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read', capability: 'download' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const record = runtime.artifactRecord(projectId, artifactId, representation);
    if (!record || record.status !== 'published') {
      fail(res, 409, 'artifact_not_published', record
        ? `The artifact is ${record.status}; retry after the publisher catches up.`
        : 'The artifact has not been published to NexTore yet.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_unmapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const range = readRange(req.headers.range);
      const upstream = await client.downloadArtifact(accessToken, nextoreProjectId, artifactId, {
        representation,
        ...(version === null ? {} : { version }),
        ...(range ? { range } : {}),
      }, abort.signal);
      relay(res, upstream, fileNameFromPath(record.relativePath, artifactId));
    } catch (error) {
      relayClientError(res, error);
    }
  });

  app.get('/api/nextore/projects/:id/download', async (req, res) => {
    if (unavailable(res)) return;
    const runtime = deps.runtime!;
    const client = deps.client!;
    const projectId = String(req.params.id ?? '');
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read', capability: 'download' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }
    const nextoreProjectId = runtime.nextoreProjectId(projectId);
    if (!nextoreProjectId) {
      fail(res, 409, 'project_unmapped', 'The project is not linked to a NexTore project.');
      return;
    }
    const accessToken = await runtime.accessTokenFor(memberId);
    if (!accessToken) {
      fail(res, 401, 'auth_required', 'The NexTore session has expired; sign in again.');
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const range = readRange(req.headers.range);
      const upstream = await client.downloadProject(accessToken, nextoreProjectId, {
        ...(range ? { range } : {}),
      }, abort.signal);
      const name = deps.readProjectName?.(projectId)?.trim() || projectId;
      relay(res, upstream, `${name}.zip`);
    } catch (error) {
      relayClientError(res, error);
    }
  });
}
