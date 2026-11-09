import path from 'node:path';

import type { NextoreConfig } from '../config.js';
import { resolveNextoreRunProvider } from '../models/resolve-run-provider.js';

/**
 * NexTore edition memory lives under one directory per member (NXD-D19).
 *
 * The upstream store (`apps/daemon/src/memory.ts`) appends `memory/` to the
 * data directory it is handed, so a "scoped data dir" is the member root, not
 * the memory folder itself. Keeping this a pure path helper means routes, run
 * prompts, and tests agree on the layout without inspecting daemon globals.
 */
export function memoryRootFor(runtimeDataDir: string, memberId: number): string {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error('memoryRootFor requires a positive integer member id');
  }
  return path.join(runtimeDataDir, 'nextore', 'members', String(memberId));
}

/**
 * Stable, non-secret identifier used to fan memory events out per scope.
 *
 * Upstream keeps one global store, so every directory outside the edition's
 * member layout maps to `global`. The value is never used as a filesystem
 * path; it only lets an SSE listener ignore another member's extraction rows.
 */
export function memoryScopeId(dataDir: string): string {
  const marker = path.join('nextore', 'members') + path.sep;
  const normalized = String(dataDir ?? '');
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) {
    const id = normalized.slice(index + marker.length).split(/[\\/]/)[0] ?? '';
    if (/^\d+$/.test(id)) return `member:${id}`;
  }
  return 'global';
}

export interface NextoreMemorySession {
  memberId: number;
  memoryEnabled: boolean;
}

/**
 * Read the memory-relevant part of the session the edition gate attached.
 *
 * `features.memory` is the module's global `MemoryEnabled` switch. An older
 * bootstrap payload without `features` defaults to enabled, matching the
 * module's own default and keeping sessions created before this field existed
 * usable until their next five-minute revalidation.
 */
export function readNextoreMemorySession(res: unknown): NextoreMemorySession | null {
  const session = (res as {
    locals?: {
      nextoreSession?: {
        memberId?: unknown;
        member?: { features?: { memory?: unknown } | null } | null;
      };
    };
  } | null)?.locals?.nextoreSession;
  if (
    !session
    || typeof session.memberId !== 'number'
    || !Number.isInteger(session.memberId)
    || session.memberId <= 0
  ) {
    return null;
  }
  return {
    memberId: session.memberId,
    memoryEnabled: session.member?.features?.memory !== false,
  };
}

export interface NextoreFastMemoryProvider {
  kind: 'openai';
  apiKey: string;
  model: string;
  baseUrl: string;
  apiVersion: '';
  credentialSource: 'nextore';
}

/**
 * Memory extraction always uses the Fast tier (NXD-D19), never the tier the
 * chat turn chose. The module owns the model behind the tier; the daemon only
 * forwards the signed-in member's access token.
 */
export function nextoreFastMemoryProvider(
  config: NextoreConfig | null | undefined,
  accessToken: string | null | undefined,
): NextoreFastMemoryProvider | null {
  if (!config) return null;
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) return null;
  const resolved = resolveNextoreRunProvider({
    config,
    session: { accessToken: token },
    tier: 'fast',
  });
  if (!resolved.ok) return null;
  return {
    kind: 'openai',
    apiKey: resolved.byokProvider.apiKey?.trim() || token,
    model: resolved.model,
    baseUrl: resolved.byokProvider.baseUrl?.trim() || '',
    apiVersion: '',
    credentialSource: 'nextore',
  };
}
