'use client';

import type { NextoreGroupsResponse, NextoreSessionGroupSummary } from '@open-design/contracts';

/**
 * Admin-only group directory for the team-workspace dialog (NXD-D40).
 *
 * The session view only carries the caller's own groups; an admin granting a
 * team workspace usually needs other groups (ND Manager / Editor / Reader).
 */
let cached: NextoreSessionGroupSummary[] | null = null;
let inflight: Promise<NextoreSessionGroupSummary[] | null> | null = null;

export async function fetchNextoreGroups(
  force = false,
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreSessionGroupSummary[] | null> {
  if (cached && !force) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetchImpl('/api/nextore/groups', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as Partial<NextoreGroupsResponse>;
      if (!Array.isArray(body.groups)) return null;
      cached = body.groups
        .filter(
          (group): group is NextoreSessionGroupSummary =>
            typeof group === 'object'
            && group !== null
            && typeof (group as { id?: unknown }).id === 'number'
            && Number.isInteger((group as { id: number }).id)
            && (group as { id: number }).id > 0,
        )
        .map((group) => ({
          id: group.id,
          name: typeof group.name === 'string' ? group.name : '',
        }));
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test helper. */
export function resetNextoreGroups(): void {
  cached = null;
  inflight = null;
}
