import type { Express } from 'express';

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
}
