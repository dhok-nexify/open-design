'use client';

import { useSyncExternalStore } from 'react';

/**
 * What the Projects view is showing (NXD-D40).
 *
 * Kept deliberately separate from `workspace-context.ts`: the switcher answers
 * "which workspace am I in, and where does a new project go", this answers
 * "what am I looking at". `null` means "follow the switcher".
 *
 * The scope lives in the URL (`/projects?ws=…`) so refresh, browser back and a
 * pasted link all land on the same list. It is a module store rather than
 * component state because two surfaces write it: the Projects segmented control
 * sets it, and choosing a workspace in the switcher clears it so the list
 * follows the new identity instead of staying pinned to the old one.
 */
export type NextoreProjectScope =
  | { kind: 'all' }
  | { kind: 'shared' }
  | { kind: 'workspace'; id: number };

export const PROJECT_SCOPE_PARAM = 'ws';

export function parseProjectScope(search: string): NextoreProjectScope | null {
  const raw = new URLSearchParams(search).get(PROJECT_SCOPE_PARAM);
  if (!raw) return null;
  if (raw === 'all') return { kind: 'all' };
  if (raw === 'shared') return { kind: 'shared' };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: 'workspace', id };
}

export function scopeToParam(scope: NextoreProjectScope): string {
  if (scope.kind === 'all') return 'all';
  if (scope.kind === 'shared') return 'shared';
  return String(scope.id);
}

/**
 * Rewrites only the scope parameter of a search string. Everything else in the
 * query survives, so a caller cannot drop a parameter it does not own.
 */
export function applyProjectScope(search: string, scope: NextoreProjectScope | null): string {
  const params = new URLSearchParams(search);
  if (scope) params.set(PROJECT_SCOPE_PARAM, scopeToParam(scope));
  else params.delete(PROJECT_SCOPE_PARAM);
  const next = params.toString();
  return next ? '?' + next : '';
}

function readFromLocation(): NextoreProjectScope | null {
  if (typeof window === 'undefined') return null;
  return parseProjectScope(window.location.search);
}

let snapshot: NextoreProjectScope | null = readFromLocation();
const listeners = new Set<() => void>();
let popstateBound = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function writeUrl(scope: NextoreProjectScope | null, mode: 'push' | 'replace'): void {
  const search = applyProjectScope(window.location.search, scope);
  if (search === window.location.search) return;
  const url = window.location.pathname + search + window.location.hash;
  // The history entry keeps whatever `odIndex` the router stored: a query-only
  // change must not disturb the router's back/forward ledger. Anything that is
  // not a plain object is passed through untouched rather than spread into an
  // index-shaped mess.
  const previous = window.history.state;
  const state = previous && typeof previous === 'object' ? { ...previous } : previous;
  if (mode === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}

function bindPopstate(): void {
  if (popstateBound || typeof window === 'undefined') return;
  popstateBound = true;
  window.addEventListener('popstate', () => {
    snapshot = readFromLocation();
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  bindPopstate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NextoreProjectScope | null {
  return snapshot;
}

function getServerSnapshot(): NextoreProjectScope | null {
  return null;
}

export function setProjectScope(scope: NextoreProjectScope | null): void {
  snapshot = scope;
  if (typeof window !== 'undefined') writeUrl(scope, 'push');
  emit();
}

/**
 * Clears the scope without adding a history entry: choosing a workspace is one
 * user intent, and a back press must land on the previous page, not on the
 * previous URL spelling of the same page.
 */
export function clearProjectScope(): void {
  snapshot = null;
  if (typeof window !== 'undefined') writeUrl(null, 'replace');
  emit();
}

export function useNextoreProjectScope(): NextoreProjectScope | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
