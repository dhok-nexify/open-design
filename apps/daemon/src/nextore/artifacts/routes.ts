import type { Express, Response } from 'express';
import type { NextoreArtifactRepresentation } from '@open-design/contracts';

import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import type { NextoreArtifactRuntime } from './runtime.js';

export interface RegisterNextoreArtifactRoutesDeps {
  runtime: NextoreArtifactRuntime | null;
  authorizeProject: AuthorizeProjectRequest;
}

/** Daemon-side artifact status route backed by the runtime's mapping/queue view. */
export function registerNextoreArtifactRoutes(
  app: Express,
  deps: RegisterNextoreArtifactRoutesDeps,
): void {
  app.get('/api/nextore/projects/:id/artifacts/:artifactId/status', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    if (!projectId || !artifactId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project and artifact ids are required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read' })) return;
    res.json(deps.runtime.status(projectId, artifactId));
  });

  /** GET .../artifacts - the mapping rows the web UI picks its artifact from. */
  app.get('/api/nextore/projects/:id/artifacts', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project id is required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read' })) return;
    res.json({ projectId, artifacts: deps.runtime.artifacts(projectId) });
  });

  /** GET .../releases — immutable per-run manifests, newest first. */
  app.get('/api/nextore/projects/:id/releases', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project id is required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read' })) return;
    res.json({ projectId, releases: deps.runtime.releases(projectId) });
  });

  /** GET .../releases/:releaseId — one frozen manifest and its status. */
  app.get('/api/nextore/projects/:id/releases/:releaseId', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    const releaseId = String(req.params.releaseId ?? '');
    if (!projectId || !releaseId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project and release ids are required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read' })) return;
    const release = deps.runtime.release(projectId, releaseId);
    if (!release) {
      res.status(404).json({ error: 'nextore_release_not_found' });
      return;
    }
    res.json(release);
  });

  /**
   * POST .../releases/:releaseId/prepare-share — publish the Release ZIP as an
   * ordinary single-file artifact. The caller then uses the standard artifact
   * share route and dialog, so representation, preview, expiry and password
   * behave exactly like any other file share.
   */
  app.post('/api/nextore/projects/:id/releases/:releaseId/prepare-share', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    const releaseId = String(req.params.releaseId ?? '');
    if (!projectId || !releaseId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project and release ids are required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'share' })) return;
    const release = deps.runtime.release(projectId, releaseId);
    if (!release) {
      res.status(404).json({ error: 'nextore_release_not_found' });
      return;
    }
    if (release.status !== 'ready') {
      res.status(409).json({
        error: 'release_not_ready',
        status: release.status,
        message: 'A Release can only be shared after every file is published.',
      });
      return;
    }
    try {
      const artifactId = await deps.runtime.prepareReleaseArtifact(projectId, releaseId);
      if (!artifactId) {
        res.status(409).json({
          error: 'release_zip_not_ready',
          message: 'The Release ZIP is not published yet; retry in a moment.',
        });
        return;
      }
      res.json({ projectId, releaseId, artifactId, representation: 'source' });
    } catch (error) {
      res.status(502).json({
        error: 'release_zip_publish_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET .../releases/:releaseId/download — deterministic ZIP from the frozen
   * manifest. A Release is immutable, so the response is cacheable forever.
   */
  app.get('/api/nextore/projects/:id/releases/:releaseId/download', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    const releaseId = String(req.params.releaseId ?? '');
    if (!projectId || !releaseId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project and release ids are required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'read' })) return;
    const release = deps.runtime.release(projectId, releaseId);
    if (!release) {
      res.status(404).json({ error: 'nextore_release_not_found' });
      return;
    }
    if (release.status !== 'ready') {
      res.status(409).json({
        error: 'release_not_ready',
        status: release.status,
        message: 'A Release can only be downloaded after every file is published.',
      });
      return;
    }
    try {
      const zip = await deps.runtime.releaseZip(projectId, releaseId);
      if (!zip) {
        res.status(404).json({ error: 'nextore_release_zip_unavailable' });
        return;
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zip.fileName}"`);
      res.setHeader('X-Release-Sha256', zip.sha256);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(zip.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(409).json({
        error: message.startsWith('release_snapshot_drift:')
          ? 'release_snapshot_drift'
          : 'release_zip_failed',
        message,
      });
    }
  });

  /**
   * POST .../artifacts/reconcile — compare the local mapping with the module.
   * Reconciliation never tombstones on an outage; it only adopts, repairs a
   * drift, and orphans a row the module has omitted past its grace window.
   */
  app.post('/api/nextore/projects/:id/artifacts/reconcile', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    if (!projectId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project id is required' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const actor = (res.locals as { nextoreSession?: { memberId?: unknown } }).nextoreSession?.memberId;
    const result = await deps.runtime.reconcileProject(
      projectId,
      typeof actor === 'number' && Number.isInteger(actor) && actor > 0 ? actor : undefined,
    );
    if (!result) {
      res.status(409).json({
        error: 'reconcile_unavailable',
        message: 'The daemon has no member, mapping or session to reconcile this project.',
      });
      return;
    }
    res.json({ projectId, ...result });
  });

  /**
   * POST .../artifacts/:artifactId/retry — re-arm one failed representation.
   * Dead letters and browser-closed failures are only retried on an explicit
   * operator/user action, never on a timer, so a bad artifact cannot loop.
   */
  app.post('/api/nextore/projects/:id/artifacts/:artifactId/retry', async (req, res) => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    const representation = readRepresentation(req.query.representation ?? req.body?.representation);
    if (!projectId || !artifactId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'project and artifact ids are required' });
      return;
    }
    if (!representation) {
      res.status(400).json({ error: 'invalid_representation' });
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const retried = deps.runtime.retry(projectId, artifactId, representation);
    if (!retried) {
      res.status(404).json({ error: 'nextore_queue_item_not_found' });
      return;
    }
    res.status(202).json({ projectId, artifactId, representation, retried: true });
  });
}

const REPRESENTATIONS = new Set<NextoreArtifactRepresentation>(['source', 'snapshot', 'cover']);

function readRepresentation(value: unknown): NextoreArtifactRepresentation | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : 'source';
  return REPRESENTATIONS.has(text as NextoreArtifactRepresentation)
    ? (text as NextoreArtifactRepresentation)
    : null;
}
