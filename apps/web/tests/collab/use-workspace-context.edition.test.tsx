// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class StubEventSource {
  addEventListener() {}
  close() {}
}

/**
 * The NexTore edition has no OpenDesign Cloud workspaces: identity is the
 * NexTore member session and projects are local. Every mounted consumer of
 * `useWorkspaceContext` used to poll `/api/workspace/directory` on its own
 * timer against an endpoint the edition can never answer, re-publishing state
 * on every tick. The hook must settle once and issue no request at all.
 */
describe('useWorkspaceContext in the NexTore edition', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    globalThis.EventSource = StubEventSource as unknown as typeof EventSource;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('the edition must not read Cloud workspace endpoints');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  });

  it('settles on an unscoped state without touching the workspace API', async () => {
    const { useWorkspaceContext } = await import('../../src/collab/useWorkspaceContext');
    const { result } = renderHook(() => useWorkspaceContext());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // `unsupported` is the branch every consumer already treats as the legal
    // pre-workspace / unscoped case, so nothing has to invent an edition shape.
    expect(result.current.context).toBeNull();
    expect(result.current.failure).toBe('unsupported');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps the team catalog settled and empty instead of polling it', async () => {
    const { useTeamProjects } = await import('../../src/collab/useWorkspaceContext');
    const { result } = renderHook(() => useTeamProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
