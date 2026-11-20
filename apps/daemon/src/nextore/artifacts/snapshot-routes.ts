import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

import type { Express, Response } from 'express';

import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import { SnapshotRenderError, renderHtmlToPdf, type ChromiumRenderOptions, type RenderedPdf } from './snapshot-renderer.js';
import type { NextoreArtifactRuntime } from './runtime.js';

export interface RegisterNextoreSnapshotRoutesDeps {
  runtime: NextoreArtifactRuntime | null;
  authorizeProject: AuthorizeProjectRequest;
  /** Test seam; production uses the Chromium renderer. */
  render?: (htmlPath: string, options?: ChromiumRenderOptions) => Promise<RenderedPdf>;
}

const SNAPSHOT_DIR = '.od-snapshots';

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

/** A file-system-safe name for the rendered PDF. */
function pdfNameFor(artifactId: string): string {
  const base = basename(artifactId).replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'artifact';
  return safe + '.pdf';
}

/**
 * P04-S snapshot representation.
 *
 * Renders the published source HTML to PDF with the daemon-side Chromium
 * renderer and queues it as `representation=snapshot`. The daemon owns the
 * render because the platform converters return an empty stream for HTML and
 * the desktop renderer is unavailable in a headless deployment.
 */
export function registerNextoreSnapshotRoutes(
  app: Express,
  deps: RegisterNextoreSnapshotRoutesDeps,
): void {
  const render = deps.render ?? renderHtmlToPdf;

  app.post('/api/nextore/projects/:id/artifacts/:artifactId/snapshot', async (req, res) => {
    const runtime = deps.runtime;
    if (!runtime) {
      fail(res, 404, 'feature_disabled', 'Snapshot rendering requires the NexTore edition.');
      return;
    }
    const projectId = String(req.params.id ?? '');
    const artifactId = String(req.params.artifactId ?? '');
    if (!projectId || !artifactId) {
      fail(res, 400, 'BAD_REQUEST', 'project and artifact ids are required');
      return;
    }
    if (!await deps.authorizeProject(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const memberId = sessionMemberId(res);
    if (!memberId) {
      fail(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return;
    }

    const source = runtime.artifactRecord(projectId, artifactId, 'source');
    if (!source || source.status !== 'published') {
      fail(res, 409, 'snapshot_source_not_ready',
        source ? 'The source representation is ' + source.status + '.' : 'The source representation has not been published.');
      return;
    }
    const root = runtime.projectRoot(projectId);
    if (!root) {
      fail(res, 409, 'project_root_missing', 'The project folder is not available.');
      return;
    }
    const sourcePath = resolve(root, source.relativePath);
    if (!sourcePath.startsWith(resolve(root) + sep)) {
      fail(res, 400, 'invalid_request', 'The artifact path escapes the project root.');
      return;
    }

    let rendered: RenderedPdf;
    try {
      rendered = await render(sourcePath);
    } catch (error) {
      if (error instanceof SnapshotRenderError) {
        const status = error.code === 'chromium_missing' ? 501
          : error.code === 'render_timeout' ? 503
          : error.code === 'render_failed' ? 502
          : 409;
        fail(res, status, error.code, error.message);
        return;
      }
      fail(res, 500, 'snapshot_failed', error instanceof Error ? error.message : undefined);
      return;
    }

    const name = pdfNameFor(artifactId);
    const relativePath = SNAPSHOT_DIR + '/' + name;
    const destination = join(root, SNAPSHOT_DIR, name);
    try {
      await mkdir(join(root, SNAPSHOT_DIR), { recursive: true });
      await copyFile(rendered.path, destination);
    } catch (error) {
      await rm(rendered.workDir, { recursive: true, force: true }).catch(() => {});
      fail(res, 500, 'snapshot_failed', error instanceof Error ? error.message : undefined);
      return;
    } finally {
      await rm(rendered.workDir, { recursive: true, force: true }).catch(() => {});
    }

    runtime.queueSnapshot({
      projectId,
      artifactId,
      memberId,
      relativePath,
      sourcePath: destination,
      name,
      mimeType: 'application/pdf',
    });

    res.status(202).json({
      projectId,
      artifactId,
      representation: 'snapshot',
      queued: true,
      pdfBytes: rendered.bytes,
    });
  });
}
