'use client';

import { useSyncExternalStore } from 'react';

export interface NextoreWorkspaceSelection {
  id: number;
  name: string;
  sharedOnly: boolean;
}

const STORAGE_KEY = 'nxd:workspace-selection';

function readStored(): NextoreWorkspaceSelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<NextoreWorkspaceSelection> | null;
    if (!value || typeof value.id !== 'number' || !Number.isInteger(value.id) || value.id <= 0) {
      return null;
    }
    return {
      id: value.id,
      name: typeof value.name === 'string' ? value.name : '',
      sharedOnly: value.sharedOnly === true,
    };
  } catch {
    return null;
  }
}

let snapshot: NextoreWorkspaceSelection | null = readStored();
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

function getSnapshot(): NextoreWorkspaceSelection | null {
  return snapshot;
}

function getServerSnapshot(): NextoreWorkspaceSelection | null {
  return null;
}

export function getNextoreWorkspaceSelection(): NextoreWorkspaceSelection | null {
  return snapshot;
}

export function selectNextoreWorkspace(selection: NextoreWorkspaceSelection): void {
  snapshot = { ...selection };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode without storage still filters for this page load.
  }
  emit();
}

export function clearNextoreWorkspaceSelection(): void {
  snapshot = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: the in-memory reset still applies.
  }
  emit();
}

export function useNextoreWorkspaceSelection(): NextoreWorkspaceSelection | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
