import type {
  NextoreArtifactRecord,
  NextoreArtifactRepresentation,
  NextoreArtifactShareDescribe,
  NextoreArtifactShareRequest,
  NextoreArtifactShareResult,
  NextoreArtifactStatusResponse,
} from '@open-design/contracts';

/**
 * Web-side client for the NexTore artifact authority.
 *
 * Everything here talks to the daemon's /api/nextore routes; the daemon is the
 * only component that holds a NexTore session and the only one allowed to
 * decide ACLs. The UI must never call a module URL or read local files.
 */

export interface ArtifactEvent {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  status: 'published' | 'publish_pending' | 'failed' | 'orphaned';
  version: number | null;
  error: string | null;
}

function jsonHeaders(): HeadersInit {
  return { accept: 'application/json', 'content-type': 'application/json' };
}

export async function fetchArtifactStatus(
  projectId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<NextoreArtifactStatusResponse> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/status',
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
  );
  if (!response.ok) {
    throw new Error('artifact_status_' + response.status);
  }
  return await response.json() as NextoreArtifactStatusResponse;
}

/**
 * The project's artifact mapping rows. The UI uses this only to pick which
 * artifact to show; ACLs and content still come from the per-artifact routes.
 */
export async function fetchProjectArtifacts(
  projectId: string,
  signal?: AbortSignal,
): Promise<NextoreArtifactRecord[]> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId) + '/artifacts',
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
  );
  if (!response.ok) throw new Error('artifact_list_' + response.status);
  const payload = await response.json() as { artifacts?: NextoreArtifactRecord[] };
  return Array.isArray(payload.artifacts) ? payload.artifacts : [];
}

/** Pick the newest source representation; the project dialog's default target. */
export function primaryArtifact(records: readonly NextoreArtifactRecord[]): NextoreArtifactRecord | null {
  // Release ZIPs are shareable files, but they must never become the dialog's
  // default "current file"; the project's real source still leads.
  const sources = records.filter((row) => row.representation === 'source'
    && !row.artifactId.startsWith('release:'));
  const pool = sources.length > 0 ? sources : [...records];
  if (pool.length === 0) return null;
  return pool.reduce((best, row) => (row.updatedAt > best.updatedAt ? row : best));
}

export function artifactDownloadUrl(
  projectId: string,
  artifactId: string,
  options: { representation?: NextoreArtifactRepresentation; version?: number } = {},
): string {
  const query = new URLSearchParams();
  if (options.representation) query.set('representation', options.representation);
  if (typeof options.version === 'number') query.set('version', String(options.version));
  const suffix = query.size > 0 ? '?' + query.toString() : '';
  return '/api/nextore/projects/' + encodeURIComponent(projectId)
    + '/artifacts/' + encodeURIComponent(artifactId) + '/download' + suffix;
}

export function projectDownloadUrl(projectId: string): string {
  return '/api/nextore/projects/' + encodeURIComponent(projectId) + '/download';
}

export interface ProjectRelease {
  releaseId: string;
  version: number;
  status: 'partial' | 'ready' | 'failed';
  files: Array<{ relativePath: string; artifactId: string; mimeType: string; contentHash: string }>;
  createdAt: number;
}

export async function fetchProjectReleases(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectRelease[]> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId) + '/releases',
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
  );
  if (!response.ok) throw new Error('release_list_' + response.status);
  const payload = await response.json() as { releases?: ProjectRelease[] };
  return Array.isArray(payload.releases) ? payload.releases : [];
}

export function releaseDownloadUrl(projectId: string, releaseId: string): string {
  return '/api/nextore/projects/' + encodeURIComponent(projectId)
    + '/releases/' + encodeURIComponent(releaseId) + '/download';
}

/** Publish the immutable ZIP as a single-file artifact, then share it normally. */
export async function prepareReleaseShare(
  projectId: string,
  releaseId: string,
): Promise<{ artifactId: string; representation: 'source' }> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/releases/' + encodeURIComponent(releaseId) + '/prepare-share',
    { method: 'POST', headers: { accept: 'application/json' } },
  );
  if (!response.ok) throw await shareError(response);
  return await response.json() as { artifactId: string; representation: 'source' };
}

/**
 * Read the current link for one representation without creating one. Useful
 * when a dialog reopens: a link outlives the session that minted it.
 */
export async function describeArtifactShare(
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
): Promise<NextoreArtifactShareDescribe | null> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/share?representation='
      + encodeURIComponent(representation),
    { headers: { accept: 'application/json' } },
  );
  // No NexTore mapping means nothing can be shared from here yet.
  if (response.status === 409) return null;
  if (!response.ok) throw await shareError(response);
  return await response.json() as NextoreArtifactShareDescribe;
}

export async function shareArtifact(
  projectId: string,
  artifactId: string,
  body: NextoreArtifactShareRequest,
): Promise<NextoreArtifactShareResult> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/share',
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) },
  );
  if (!response.ok) throw await shareError(response);
  return await response.json() as NextoreArtifactShareResult;
}

/**
 * Ask the daemon to render the published source HTML to PDF and queue it as the
 * snapshot representation. Slow (headless Chromium), so the caller waits for the
 * queue to publish before retrying a share.
 */
export async function renderSnapshot(
  projectId: string,
  artifactId: string,
): Promise<{ queued: boolean; pdfBytes: number }> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/snapshot',
    { method: 'POST', headers: { accept: 'application/json' } },
  );
  if (!response.ok) throw await shareError(response);
  return await response.json() as { queued: boolean; pdfBytes: number };
}

/** Wait until the snapshot representation is published (or give up). */
export async function waitForSnapshot(
  projectId: string,
  artifactId: string,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await fetchArtifactStatus(projectId, artifactId);
      const row = status.representations.find((entry) => entry.representation === 'snapshot');
      if (row?.artifact.status === 'published') return true;
      if (row?.artifact.status === 'failed') return false;
    } catch {
      // Keep waiting: a status hiccup is not a failed render.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return false;
}

export async function revokeArtifactShare(
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
): Promise<void> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/share?representation='
      + encodeURIComponent(representation),
    { method: 'DELETE', headers: { accept: 'application/json' } },
  );
  if (!response.ok) throw await shareError(response);
}

export async function retryArtifact(
  projectId: string,
  artifactId: string,
  representation: NextoreArtifactRepresentation,
): Promise<void> {
  const response = await fetch(
    '/api/nextore/projects/' + encodeURIComponent(projectId)
      + '/artifacts/' + encodeURIComponent(artifactId) + '/retry?representation='
      + encodeURIComponent(representation),
    { method: 'POST', headers: { accept: 'application/json' } },
  );
  if (!response.ok) throw await shareError(response);
}

async function shareError(response: Response): Promise<Error> {
  let code = 'artifact_request_' + response.status;
  try {
    const body = await response.json() as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string') code = body.error;
    else if (body.error && typeof body.error === 'object') {
      const nested = (body.error as { code?: unknown }).code;
      if (typeof nested === 'string') code = nested;
    }
  } catch {
    // Keep the status-shaped code when the body is not JSON.
  }
  return new Error(code);
}

/**
 * Subscribe to the project event stream and surface only the artifact events.
 *
 * Events are hints; the status API stays the source of truth, so a dropped
 * connection just triggers one refetch instead of a local state machine.
 */
export function subscribeArtifactEvents(
  projectId: string,
  onEvent: (event: ArtifactEvent) => void,
  onReconnect: () => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource('/api/projects/' + encodeURIComponent(projectId) + '/events');
  const handler = (raw: MessageEvent) => {
    try {
      const payload = JSON.parse(String(raw.data)) as ArtifactEvent;
      if (!payload || typeof payload.artifactId !== 'string') return;
      onEvent(payload);
    } catch {
      // Ignore malformed frames; the next status read recovers.
    }
  };
  source.addEventListener('nextore-artifact', handler as EventListener);
  source.addEventListener('error', () => {
    // EventSource reconnects on its own; refetch because events may have been
    // missed while the connection was down.
    onReconnect();
  });
  return () => {
    source.removeEventListener('nextore-artifact', handler as EventListener);
    source.close();
  };
}

/** Stable UI buckets for the codes a user can act on. */
export function describeArtifactError(code: string | null | undefined): string {
  switch (code) {
    case 'auth_required':
    case 'SESSION_REQUIRED':
      return 'auth_required';
    case 'snapshot_renderer_unavailable':
    case 'snapshot_not_ready':
      return 'snapshot_unavailable';
    case 'versioning_required':
      return 'versioning_required';
    case 'share_forbidden':
      return 'share_forbidden';
    case 'folder_share_forbidden':
      return 'folder_share_forbidden';
    case 'nextore_unavailable':
      return 'nextore_unavailable';
    case 'pin_version_unsupported':
      return 'pin_version_unsupported';
    default:
      return code ? 'generic' : 'none';
  }
}
