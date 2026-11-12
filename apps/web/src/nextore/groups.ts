'use client';

import type { NextoreGroupsResponse, NextoreSessionGroupSummary } from '@open-design/contracts';

/**
 * Admin-only group directory for the team-workspace dialog (NXD-D40).
 *
 * The module caps one response and searches server-side, so the dialog can
 * offer a search box instead of downloading thousands of groups.
 */
export interface NextoreGroupsResult {
  groups: NextoreSessionGroupSummary[];
  truncated: boolean;
}

const cache = new Map<string, NextoreGroupsResult>();
const inflight = new Map<string, Promise<NextoreGroupsResult | null>>();

export async function fetchNextoreGroups(
  query = '',
  force = false,
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreGroupsResult | null> {
  const key = query.trim();
  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const suffix = key ? '?query=' + encodeURIComponent(key) : '';
      const response = await fetchImpl('/api/nextore/groups' + suffix, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as Partial<NextoreGroupsResponse>;
      if (!Array.isArray(body.groups)) return null;
      const result: NextoreGroupsResult = {
        groups: body.groups
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
          })),
        truncated: body.truncated === true,
      };
      cache.set(key, result);
      return result;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

/** Test helper. */
export function resetNextoreGroups(): void {
  cache.clear();
  inflight.clear();
}
