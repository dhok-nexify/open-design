// Bridge between EntryShell (the owner of the entry nav-rail open state) and
// chrome that lives in a sibling React tree — the pinned Home tab's sidebar
// toggle in WorkspaceTabsBar. Kept in a leaf module so the tabs bar can share
// this contract without importing the whole EntryShell module graph.

// Persisted entry nav-rail open/collapsed state. EntryShell owns the writes;
// outside chrome only reads it to seed the pinned toggle's `aria-expanded`
// before the first state event arrives.
export const RAIL_OPEN_STORAGE_KEY = 'od.entry.railOpen';

// Window event dispatched by chrome outside the entry tree (the pinned Home
// tab's sidebar toggle in WorkspaceTabsBar) to expand/collapse the entry rail.
export const ENTRY_RAIL_TOGGLE_EVENT = 'od:entry-rail-toggle';

// Window event dispatched by chrome outside the entry tree (the search button
// that now sits in the chrome row beside the rail toggle) to open the ⌘K
// project search palette, which EntryShell owns.
export const ENTRY_SEARCH_OPEN_EVENT = 'od:entry-search-open';

// Window event dispatched by EntryShell whenever the rail open state changes,
// with `detail: { open: boolean }`, so outside chrome can mirror the state
// (the pinned toggle's `aria-expanded`).
export const ENTRY_RAIL_STATE_EVENT = 'od:entry-rail-state';

/**
 * The persisted rail state, or `null` when this person has never chosen one.
 * The distinction matters: a collapsed rail is the intended default for a
 * clean, full-width entry, but it must not be confused with someone who
 * deliberately collapsed it — only the never-chosen case may be re-defaulted.
 */
export function readStoredRailOpen(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(RAIL_OPEN_STORAGE_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}
