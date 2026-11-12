'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * What the Projects view is showing (NXD-D40).
 *
 * Kept deliberately separate from `workspace-context.ts`: the switcher answers
 * "where am I / where does a new project go", this answers "what am I looking
 * at". The scope lives in the URL (`/projects?ws=…`) so refresh, browser back
 * and a pasted link all land on the same list.
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

/**
 * Reads the scope from the live URL and keeps it in step with browser
 * back/forward.
 *
 * The push keeps `history.state` intact: the router tracks a monotonic
 * `odIndex` there to decide whether an in-app entry sits behind the current
 * one, and a query-only change must not disturb that ledger.
 */
export function useNextoreProjectScope(): {
  scope: NextoreProjectScope | null;
  setScope: (scope: NextoreProjectScope | null) => void;
} {
  const [scope, setScopeState] = useState<NextoreProjectScope | null>(() =>
    typeof window === 'undefined' ? null : parseProjectScope(window.location.search),
  );

  useEffect(() => {
    function sync(): void {
      setScopeState(parseProjectScope(window.location.search));
    }
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const setScope = useCallback((next: NextoreProjectScope | null) => {
    const search = applyProjectScope(window.location.search, next);
    if (search === window.location.search) {
      setScopeState(next);
      return;
    }
    const url = window.location.pathname + search + window.location.hash;
    window.history.pushState({ ...window.history.state }, '', url);
    setScopeState(next);
  }, []);

  return { scope, setScope };
}
