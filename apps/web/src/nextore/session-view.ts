'use client';

import { useEffect, useState } from 'react';
import type { NextoreSessionView } from '@open-design/contracts';

/**
 * The member's own NexTore session view: cached rights plus the groups a
 * team-workspace dialog may offer. Fetched once per page load.
 */
let cached: NextoreSessionView | null = null;
let inflight: Promise<NextoreSessionView | null> | null = null;

export async function fetchNextoreSessionView(
  force = false,
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreSessionView | null> {
  if (cached && !force) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetchImpl('/api/nextore/session', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as Partial<NextoreSessionView>;
      if (typeof body.memberId !== 'number') return null;
      cached = {
        memberId: body.memberId,
        rights: {
          access: body.rights?.access === true,
          createProject: body.rights?.createProject === true,
          admin: body.rights?.admin === true,
          manageMcp: body.rights?.manageMcp === true,
        },
        groups: Array.isArray(body.groups)
          ? body.groups.filter(
              (group): group is { id: number; name: string } =>
                typeof group?.id === 'number' && Number.isInteger(group.id) && group.id > 0,
            )
          : [],
      };
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test helper: drop the cached session view so the next mount refetches. */
export function resetNextoreSessionView(): void {
  cached = null;
  inflight = null;
}

export function useNextoreSessionView(enabled = true): NextoreSessionView | null {
  const [view, setView] = useState<NextoreSessionView | null>(enabled ? cached : null);
  useEffect(() => {
    if (!enabled) {
      setView(null);
      return undefined;
    }
    let cancelled = false;
    void fetchNextoreSessionView().then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? view : null;
}
