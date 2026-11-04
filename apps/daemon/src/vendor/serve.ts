import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { findVendorAsset, type VendorAsset } from './manifest.js';

export type VendorResolutionReason = 'not_found' | 'unsafe_path' | 'missing_file';

export interface VendorResolution {
  status: 200 | 404 | 503;
  asset?: VendorAsset;
  absolutePath?: string;
  reason?: VendorResolutionReason;
}

const MAX_RELATIVE_PATH_LENGTH = 512;

/**
 * Whether a decoded path relative to /vendor/ is a plain relative path. Rejects NUL, any
 * backslash (a Windows separator), absolute paths, dot segments, empty segments and traversal.
 * This is the first gate; the manifest match is the second.
 */
export function isSafeVendorRelativePath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RELATIVE_PATH_LENGTH) {
    return false;
  }
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || value.startsWith('.')) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolves a /vendor/ request to a manifest entry inside rootDir. Only manifest paths resolve;
 * the resolved path is additionally pinned inside rootDir so a future manifest mistake cannot
 * escape the directory.
 */
export function resolveVendorRequest(rootDir: string, relativePath: string): VendorResolution {
  if (!isSafeVendorRelativePath(relativePath)) {
    return { status: 404, reason: 'unsafe_path' };
  }

  const asset = findVendorAsset(relativePath);
  if (!asset) {
    return { status: 404, reason: 'not_found' };
  }

  const absolutePath = path.resolve(rootDir, ...relativePath.split('/'));
  if (!isWithin(rootDir, absolutePath)) {
    return { status: 404, reason: 'unsafe_path' };
  }
  if (!existsSync(absolutePath)) {
    return { status: 503, reason: 'missing_file' };
  }

  return { status: 200, asset, absolutePath };
}

interface IntegrityEntry {
  mtimeMs: number;
  size: number;
  ok: boolean;
}

const integrityCache = new Map<string, IntegrityEntry>();

/**
 * Verifies the bytes on disk against the manifest hash. Results are cached per file identity
 * (mtime + size) so a hot path does not re-hash a megabyte on every request; touching the file
 * invalidates its entry.
 */
export function verifyVendorAsset(absolutePath: string, asset: VendorAsset): boolean {
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    return false;
  }

  const cached = integrityCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.ok;
  }

  let ok = false;
  try {
    const bytes = readFileSync(absolutePath);
    ok =
      bytes.length === asset.bytes &&
      createHash('sha256').update(bytes).digest('hex') === asset.sha256;
  } catch {
    ok = false;
  }

  integrityCache.set(absolutePath, { mtimeMs: stat.mtimeMs, size: stat.size, ok });
  return ok;
}

/** Test seam: forget cached integrity results. */
export function resetVendorIntegrityCache(): void {
  integrityCache.clear();
}
