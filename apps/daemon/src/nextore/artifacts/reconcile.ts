import { existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { NextoreArtifactRepresentation } from '@open-design/contracts';

import type { NextoreArtifactClient } from '../client.js';
import { mimeTypeFor } from './registry.js';
import { hashFileSha256 } from './publisher.js';
import {
  enqueueNextorePublish,
  listNextoreArtifacts,
  markNextoreArtifactOrphaned,
  updateNextoreArtifactStatus,
  upsertNextoreArtifact,
} from './store.js';

type SqliteDb = Database.Database;

/** One representation reported by the module. */
export interface RemoteArtifact {
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  treeObjectId: number;
  version: number;
  contentHash: string | null;
  name: string;
  status: string;
}

export interface ReconcileProjectInput {
  db: SqliteDb;
  client: Pick<NextoreArtifactClient, 'listArtifacts'>;
  projectId: string;
  /** NexTore project folder id. */
  nextoreProjectId: string;
  accessToken: string;
  /** Absolute project root, used to confirm a candidate file exists. */
  projectRoot: string;
  /** Member that owns the reconciliation call; used for any requeue. */
  memberId: number;
  now?: () => number;
  /**
   * How long a local row may stay missing from the module before it is marked
   * orphaned. A short module outage must never tombstone a published artifact.
   */
  missingGraceMs?: number;
}

export interface ReconcileProjectResult {
  /** Rows the module reported that the daemon did not know about. */
  adopted: number;
  /** Rows whose module version/hash drifted from the local mapping. */
  requeued: number;
  /** Rows confirmed missing long enough to tombstone. */
  orphaned: number;
  /** Module-reported rows that could not be adopted safely. */
  skipped: number;
  /** True when the module was unreachable; no local state was changed. */
  unavailable: boolean;
  /**
   * True when the project has nothing to reconcile (no NexTore mapping, or no
   * project root). A backfill must treat this as finished, not as a retry.
   */
  notApplicable?: boolean;
}

const REPRESENTATIONS = new Set<NextoreArtifactRepresentation>(['source', 'snapshot', 'cover']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function wireValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function wireString(row: Record<string, unknown>, ...keys: string[]): string | null {
  const value = wireValue(row, ...keys);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function wireNumber(row: Record<string, unknown>, ...keys: string[]): number | null {
  const value = wireValue(row, ...keys);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Normalise the module list payload; unknown shapes are ignored, not trusted. */
export function normalizeRemoteArtifacts(payload: unknown): RemoteArtifact[] {
  const raw = Array.isArray(payload)
    ? payload
    : (Array.isArray((asRecord(payload) ?? {}).artifacts)
      ? (asRecord(payload)!.artifacts as unknown[])
      : null);
  if (!raw) return [];
  const result: RemoteArtifact[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const artifactId = wireString(row, 'artifactId', 'ArtifactId');
    const representation = (wireString(row, 'representation', 'Representation') ?? '').toLowerCase();
    const treeObjectId = wireNumber(row, 'treeObjectId', 'TreeObjectId');
    const version = wireNumber(row, 'version', 'Version');
    if (!artifactId || !REPRESENTATIONS.has(representation as NextoreArtifactRepresentation)) continue;
    if (treeObjectId == null || version == null) continue;
    result.push({
      artifactId,
      representation: representation as NextoreArtifactRepresentation,
      treeObjectId,
      version,
      contentHash: wireString(row, 'contentHash', 'ContentHash'),
      name: wireString(row, 'name', 'Name') ?? artifactId,
      status: wireString(row, 'status', 'Status') ?? 'published',
    });
  }
  return result;
}

function artifactKey(artifactId: string, representation: string): string {
  return artifactId + '::' + representation;
}

/**
 * Reconcile one project's local mapping against the module.
 *
 * The module is authoritative about what exists. The daemon only tombstones a
 * row the module explicitly omits, and only after a grace window; an outage
 * leaves every row untouched.
 */
export async function reconcileProjectArtifacts(
  input: ReconcileProjectInput,
): Promise<ReconcileProjectResult> {
  const now = input.now ?? Date.now;
  const graceMs = input.missingGraceMs ?? 24 * 60 * 60 * 1000;
  const empty: ReconcileProjectResult = {
    adopted: 0, requeued: 0, orphaned: 0, skipped: 0, unavailable: false,
  };

  let payload: unknown;
  try {
    payload = await input.client.listArtifacts<unknown>(input.accessToken, input.nextoreProjectId);
  } catch {
    return { ...empty, unavailable: true };
  }

  const remote = normalizeRemoteArtifacts(payload);
  const remaining = new Map(remote.map((row) => [artifactKey(row.artifactId, row.representation), row]));
  const at = now();
  const result: ReconcileProjectResult = { ...empty };

  for (const local of listNextoreArtifacts(input.db, input.projectId)) {
    const key = artifactKey(local.artifactId, local.representation);
    const match = remaining.get(key);
    if (!match) {
      if (at - local.updatedAt > graceMs) {
        markNextoreArtifactOrphaned(input.db, input.projectId, local.artifactId, local.representation, at);
        result.orphaned += 1;
      }
      continue;
    }
    remaining.delete(key);

    const drifted = (match.contentHash && match.contentHash !== local.contentHash)
      || match.version > local.currentVersion
      || match.treeObjectId !== local.treeObjectId;
    if (drifted) {
      // The publisher re-hashes the local file before upload, so an unchanged
      // file is a no-op and a missing file is orphaned there instead of here.
      const sourcePath = path.resolve(input.projectRoot, local.relativePath);
      if (!sourcePath.startsWith(path.resolve(input.projectRoot) + path.sep) || !existsSync(sourcePath)) {
        result.skipped += 1;
        continue;
      }
      const contentHash = await hashFileSha256(sourcePath).catch(() => local.contentHash);
      enqueueNextorePublish(input.db, {
        projectId: local.projectId,
        artifactId: local.artifactId,
        representation: local.representation,
        memberId: input.memberId,
        runId: null,
        tier: null,
        relativePath: local.relativePath,
        sourcePath,
        name: path.posix.basename(local.relativePath),
        mimeType: mimeTypeFor(local.relativePath),
        reason: 'reconcile',
        now: at,
        contentHash,
      });
      result.requeued += 1;
      upsertNextoreArtifact(input.db, {
        projectId: local.projectId,
        artifactId: local.artifactId,
        representation: local.representation,
        relativePath: local.relativePath,
        treeObjectId: match.treeObjectId,
        currentVersion: match.version,
        contentHash: local.contentHash,
        status: 'publish_pending',
        publishedAt: local.publishedAt,
        lastError: 'reconcile_drift',
        orphanedAt: null,
        updatedAt: at,
      });
      continue;
    }

    updateNextoreArtifactStatus(input.db, {
      projectId: local.projectId,
      artifactId: local.artifactId,
      representation: local.representation,
      status: 'published',
      lastError: null,
      updatedAt: at,
    });
  }

  for (const extra of remaining.values()) {
    const candidate = path.resolve(input.projectRoot, extra.name);
    if (!candidate.startsWith(path.resolve(input.projectRoot) + path.sep) || !existsSync(candidate)) {
      result.skipped += 1;
      continue;
    }
    upsertNextoreArtifact(input.db, {
      projectId: input.projectId,
      artifactId: extra.artifactId,
      representation: extra.representation,
      relativePath: extra.name.replaceAll('\\', '/'),
      treeObjectId: extra.treeObjectId,
      currentVersion: extra.version,
      contentHash: extra.contentHash ?? '',
      status: 'published',
      publishedAt: at,
      lastError: null,
      orphanedAt: null,
      updatedAt: at,
    });
    result.adopted += 1;
  }

  return result;
}
