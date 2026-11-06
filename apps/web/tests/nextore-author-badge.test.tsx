// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { NextoreAuthorBadge } from '../src/components/NextoreAuthorBadge';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!key) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => routes[key] } as unknown as Response;
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

describe('NextoreAuthorBadge', () => {
  it("shows the other member's name", async () => {
    stubFetch({
      '/api/nextore/session': { memberId: 7 },
      '/api/nextore/members': { members: [{ id: 42, fullName: 'Ada Lovelace' }] },
    } as never);
    render(<NextoreAuthorBadge authorMemberId={42} />);
    await waitFor(() => expect(screen.getByTestId('nextore-author-badge').textContent).toBe('Ada Lovelace'));
  });

  it('stays hidden for your own messages', async () => {
    stubFetch({ '/api/nextore/session': { memberId: 7 } } as never);
    render(<NextoreAuthorBadge authorMemberId={7} />);
    await waitFor(() => expect(screen.queryByTestId('nextore-author-badge')).toBeNull());
  });

  it('stays hidden without an author', () => {
    stubFetch({} as never);
    render(<NextoreAuthorBadge authorMemberId={null} />);
    expect(screen.queryByTestId('nextore-author-badge')).toBeNull();
  });
});
