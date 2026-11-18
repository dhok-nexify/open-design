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
    const result = await deps.runtime.reconcileProject(projectId);
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
