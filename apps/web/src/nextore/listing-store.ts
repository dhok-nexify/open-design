'use client';

import { useEffect, useSyncExternalStore } from 'react';

import {
  fetchNextoreProjectListing,
  type NextoreProjectListing,
} from '../nextore-projects';
/**
 * One shared view of GET /api/nextore/projects.
 *
 * The sidebar renders it and the projects view filters by it, so a page load
 * fetches it once. A forced refresh runs after a team workspace is created.
 */
let snapshot: NextoreProjectListing | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getClientSnapshot(): NextoreProjectListing | null {
  return snapshot;
}

function getServerSnapshot(): NextoreProjectListing | null {
  return null;
}

async function load(force: boolean): Promise<void> {
  if (!force && snapshot) return;
  if (inflight) {
    await inflight;
    if (force) return load(true);
    return;
  }

  inflight = (async () => {
    const listing = await fetchNextoreProjectListing();
    if (listing) {
      snapshot = listing;
      emit();
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function refreshNextoreProjectListing(): Promise<void> {
  return load(true);
}

/** Test helper: drop the cached listing so the next mount refetches. */
export function resetNextoreProjectListing(): void {
  snapshot = null;
  inflight = null;
}

export function useNextoreProjectListing(enabled = true): NextoreProjectListing | null {
  const listing = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled]);
  return enabled ? listing : null;
}
