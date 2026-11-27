import path from 'node:path';
import type {
  NextoreArtifactRepresentation,
  NextoreTier,
} from '@open-design/contracts';

/** The deliverable shape produced by the run finalizer. */
export interface NextoreDeliverableSnapshot {
  valid: boolean;
  entryFile: string | null;
  artifactKind: string | null;
  linkedPage: string | null;
}

export interface ResolvePublishableArtifactsInput {
  projectId: string;
  artifactId: string;
  runId: string | null;
  tier: NextoreTier | null;
  deliverable: NextoreDeliverableSnapshot;
  /** Explicit export files produced by the run; never a workspace scan. */
  exportedFiles?: readonly string[];
}

/** One file the daemon should publish for this run. */
export interface NextorePublishableArtifact {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  name: string;
  mimeType: string;
  sourcePath: string;
  runId: string | null;
  tier: NextoreTier | null;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

function normalizeRelativePath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return null;
  const trimmed = raw.replaceAll('\\', '/');
  if (!trimmed || trimmed.includes('\u0000')) return null;
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

export function mimeTypeFor(relativePath: string): string {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function toArtifact(
  input: ResolvePublishableArtifactsInput,
  artifactId: string,
  relativePath: string,
): NextorePublishableArtifact {
  return {
    projectId: input.projectId,
    artifactId,
    representation: 'source',
    relativePath,
    name: path.posix.basename(relativePath),
    mimeType: mimeTypeFor(relativePath),
    sourcePath: relativePath,
    runId: input.runId,
    tier: input.tier,
  };
}

const BLOCKED_DIRECTORY_SEGMENTS = new Set([
  'node_modules', 'cache', 'tmp', 'temp', 'sessions', 'secrets',
]);

/**
 * The single whitelist shared by run publication and watcher adoption.
 * Deliverables and their static dependencies are publishable; hidden files,
 * caches, temporary files, session data and secrets are not.
 */
export function isPublishableNextorePath(value: string | null | undefined): boolean {
  const relative = normalizeRelativePath(value);
  if (!relative || relative.length > 512) return false;
  const segments = relative.split('/');
  if (segments.some((segment) => segment.startsWith('.') || BLOCKED_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) {
    return false;
  }
  const name = segments[segments.length - 1] ?? '';
  if (name.endsWith('~') || /\.(tmp|bak)$/iu.test(name)) return false;
  return Object.hasOwn(MIME_BY_EXTENSION, path.posix.extname(name).toLowerCase());
}

/** Stable, collision-free artifact id for a non-entry file. */
export function nextoreExportArtifactId(entryArtifactId: string, relativePath: string): string {
  return `${entryArtifactId}::export::${relativePath.replaceAll('/', '__')}`;
}

/**
 * Resolve the publishable deliverables for one successful run.
 *
 * The run declares its produced files through `exportedFiles`; the daemon never
 * scans the workspace. The entry file and every whitelisted produced file are
 * published, so a first run is complete without waiting for a later edit.
 */
export function resolvePublishableArtifacts(
  input: ResolvePublishableArtifactsInput,
): NextorePublishableArtifact[] {
  if (!input.deliverable.valid) return [];
  const entry = normalizeRelativePath(input.deliverable.entryFile);
  if (!entry) return [];

  const result: NextorePublishableArtifact[] = [
    toArtifact(input, input.artifactId, entry),
  ];

  const seen = new Set([entry]);
  for (const raw of input.exportedFiles ?? []) {
    if (!isPublishableNextorePath(raw)) continue;
    const relative = normalizeRelativePath(raw);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    result.push(toArtifact(
      input,
      nextoreExportArtifactId(input.artifactId, relative),
      relative,
    ));
  }

  return result;
}
