/**
 * NexTore edition: published-artifact contracts shared by the daemon, the web
 * shell, and the NexToreDesignerModule boundary.
 *
 * NexTore owns the published document, its versions, its ACL, and its share
 * object. These shapes only carry the identifiers and state the daemon needs
 * to keep its local mapping in sync.
 */

/** Lifecycle state of one artifact's NexTore publication. */
export type NextoreArtifactStatus =
  | 'published'
  | 'publishing'
  | 'publish_pending'
  | 'failed'
  | 'orphaned';

export const NEXTORE_ARTIFACT_STATUSES: readonly NextoreArtifactStatus[] = [
  'published',
  'publishing',
  'publish_pending',
  'failed',
  'orphaned',
];

export function isNextoreArtifactStatus(value: unknown): value is NextoreArtifactStatus {
  return typeof value === 'string'
    && (NEXTORE_ARTIFACT_STATUSES as readonly string[]).includes(value);
}

/** A stored publication of one artifact. */
export type NextoreArtifactRepresentation = 'source' | 'snapshot' | 'cover';

export const NEXTORE_ARTIFACT_REPRESENTATIONS: readonly NextoreArtifactRepresentation[] = [
  'source',
  'snapshot',
  'cover',
];

export function isNextoreArtifactRepresentation(
  value: unknown,
): value is NextoreArtifactRepresentation {
  return typeof value === 'string'
    && (NEXTORE_ARTIFACT_REPRESENTATIONS as readonly string[]).includes(value);
}

/**
 * Which representation a share link points at.
 *
 * External shares default to the rendered snapshot; the HTML source is only
 * shared inside the site or downloaded as an attachment.
 */
export type NextoreArtifactShareRepresentation = 'snapshot' | 'source';

export const NEXTORE_ARTIFACT_SHARE_REPRESENTATIONS: readonly NextoreArtifactShareRepresentation[] = [
  'snapshot',
  'source',
];

export function isNextoreArtifactShareRepresentation(
  value: unknown,
): value is NextoreArtifactShareRepresentation {
  return value === 'snapshot' || value === 'source';
}

/**
 * One daemon-side mapping row. The artifact id is the stable identity; the
 * relative path may change when a member renames or moves the artifact.
 */
export interface NextoreArtifactRecord {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  treeObjectId: number;
  currentVersion: number;
  contentHash: string;
  status: NextoreArtifactStatus;
  publishedAt: number;
  updatedAt: number;
  orphanedAt: number | null;
  lastError: string | null;
}

/** POST /api/nextore/projects/:id/artifacts/:artifactId/publish request. */
export interface NextoreArtifactPublishRequest {
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  name?: string;
  mimeType?: string;
  contentHash: string;
  idempotencyKey: string;
  runId?: string | null;
  tier?: 'fast' | 'expert' | null;
  savedAt?: string | null;
}

/** Successful publish result returned by the module and the daemon. */
export interface NextoreArtifactPublishResult {
  representation: NextoreArtifactRepresentation;
  treeObjectId: number;
  version: number;
  versionLabel: string | null;
  auditId: string;
}

/** One pending item in the daemon's publish queue. */
export interface NextorePublishQueueItem {
  id: string;
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  memberId: number;
  runId: string | null;
  tier: 'fast' | 'expert' | null;
  relativePath: string;
  sourcePath: string;
  name: string;
  mimeType: string;
  reason: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  claimedBy: string | null;
  leaseUntil: number | null;
  deadLetteredAt: number | null;
  lastError: string | null;
}

/** POST /api/nextore/projects/:id/artifacts/:artifactId/share request. */
export interface NextoreArtifactShareRequest {
  expiresAt?: string | null;
  password?: string | null;
  previewOnly?: boolean;
  representation?: NextoreArtifactShareRepresentation;
  pinVersion?: boolean;
  restrictToDomain?: boolean;
  allowedDomains?: string[];
  allowedMemberIds?: number[];
  allowedGroupIds?: number[];
}

/** Native NexTore share link returned to the caller. */
export interface NextoreArtifactShareResult {
  url: string;
  representation: NextoreArtifactShareRepresentation;
  previewOnly: boolean;
  pinnedVersion: number | null;
  expiresAt: string | null;
  hasPassword: boolean;
}

/** Per-representation status for one artifact. */
export interface NextoreArtifactRepresentationStatus {
  representation: NextoreArtifactRepresentation;
  artifact: NextoreArtifactRecord;
  queue: {
    pending: boolean;
    attempts: number;
    nextAttemptAt: number | null;
    deadLettered: boolean;
    lastError: string | null;
  };
  share: NextoreArtifactShareResult | null;
}

/** GET /api/nextore/projects/:id/artifacts/:artifactId/status response. */
export interface NextoreArtifactStatusResponse {
  projectId: string;
  artifactId: string;
  representations: NextoreArtifactRepresentationStatus[];
}

/**
 * Stable codes the daemon and module use for artifact publish, download, and
 * share failures. Keep this list additive; frontends switch on the code, not
 * on backend prose.
 */
export type NextoreArtifactErrorCode =
  | 'invalid_name'
  | 'invalid_mime'
  | 'invalid_representation'
  | 'artifact_too_large'
  | 'artifact_hidden'
  | 'artifact_not_published'
  | 'versioning_required'
  | 'snapshot_renderer_unavailable'
  | 'snapshot_not_ready'
  | 'share_unavailable'
  | 'share_domain_unconfigured'
  | 'share_not_ready'
  | 'share_forbidden'
  | 'folder_share_forbidden'
  | 'name_conflict'
  | 'name_conflict_foreign'
  | 'name_conflict_race'
  | 'idempotency_conflict'
  | 'storage_profile_unavailable'
  | 'content_hash_mismatch'
  | 'designer_access_required'
  | 'project_forbidden'
  | 'project_not_mapped'
  | 'project_not_found'
  | 'nextore_unavailable';

export const NEXTORE_ARTIFACT_ERROR_CODES: readonly NextoreArtifactErrorCode[] = [
  'invalid_name',
  'invalid_mime',
  'invalid_representation',
  'artifact_too_large',
  'artifact_hidden',
  'artifact_not_published',
  'versioning_required',
  'snapshot_renderer_unavailable',
  'snapshot_not_ready',
  'share_unavailable',
  'share_domain_unconfigured',
  'share_not_ready',
  'share_forbidden',
  'folder_share_forbidden',
  'name_conflict',
  'name_conflict_foreign',
  'name_conflict_race',
  'idempotency_conflict',
  'storage_profile_unavailable',
  'content_hash_mismatch',
  'designer_access_required',
  'project_forbidden',
  'project_not_mapped',
  'project_not_found',
  'nextore_unavailable',
];

export function isNextoreArtifactErrorCode(value: unknown): value is NextoreArtifactErrorCode {
  return typeof value === 'string'
    && (NEXTORE_ARTIFACT_ERROR_CODES as readonly string[]).includes(value);
}
