'use client';

import { useSyncExternalStore } from 'react';

import type { NextoreProjectGroup } from '../nextore-projects';

/**
 * The member's current NexTore workspace (NXD-D40).
 *
 * This is the rail switcher's state and it means exactly one thing: **where I
 * am, and where a new project will be created**. What the main area is showing
 * is a separate concern (see `project-scope.ts`), so switching workspaces can
 * never silently change or empty the list the user is reading.
 */
export interface NextoreWorkspaceContext {
  memberId: number;
  workspaceId: number;
  name: string;
}

const STORAGE_KEY = 'nxd:workspace-context';

type StoredShape = { memberId?: unknown; workspaceId?: unknown; name?: unknown };

function readStored(): NextoreWorkspaceContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredShape | null;
    if (!value || typeof value !== 'object') return null;
    const { memberId, workspaceId } = value;
    if (
      typeof memberId !== 'number' || !Number.isInteger(memberId) || memberId <= 0
      || typeof workspaceId !== 'number' || !Number.isInteger(workspaceId) || workspaceId <= 0
    ) {
      return null;
    }
    return {
      memberId,
      workspaceId,
      name: typeof value.name === 'string' ? value.name : '',
    };
  } catch {
    return null;
  }
}

let snapshot: NextoreWorkspaceContext | null = readStored();
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

function getSnapshot(): NextoreWorkspaceContext | null {
  return snapshot;
}

function getServerSnapshot(): NextoreWorkspaceContext | null {
  return null;
}

export function getNextoreWorkspaceContext(): NextoreWorkspaceContext | null {
  return snapshot;
}

export function setNextoreWorkspaceContext(next: NextoreWorkspaceContext | null): void {
  snapshot = next;
  if (typeof window === 'undefined') return;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage-less browsers still keep the context for this page load.
  }
  emit();
}

export function useNextoreWorkspaceContext(): NextoreWorkspaceContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Resolves the workspace the member is standing in.
 *
 * Pure so the fallback order is testable: a stored context only survives when
 * it belongs to this member AND that workspace is still visible to them;
 * otherwise the personal workspace wins, then the first owned workspace.
 * `sharedOnly` groups never qualify — a shared-out project does not make the
 * other member's personal workspace a place you can be.
 */
export function resolveWorkspaceContext(input: {
  memberId: number | null | undefined;
  groups: readonly NextoreProjectGroup[];
  stored: NextoreWorkspaceContext | null;
}): NextoreWorkspaceContext | null {
  const { memberId, groups, stored } = input;
  if (typeof memberId !== 'number' || memberId <= 0) return null;

  const owned = groups.filter(
    (group) => !group.sharedOnly && typeof group.workspaceId === 'number' && group.workspaceId > 0,
  );
  if (owned.length === 0) return null;

  if (stored && stored.memberId === memberId) {
    const match = owned.find((group) => group.workspaceId === stored.workspaceId);
    if (match) {
      return {
        memberId,
        workspaceId: match.workspaceId as number,
        name: match.workspaceName || stored.name,
      };
    }
  }

  const personal = owned.find((group) => group.workspaceType === 'personal') ?? owned[0]!;
  return {
    memberId,
    workspaceId: personal.workspaceId as number,
    name: personal.workspaceName,
  };
}

/** Test helper. */
export function resetNextoreWorkspaceContext(): void {
  snapshot = null;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: the in-memory reset already applied.
  }
}
