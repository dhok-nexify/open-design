// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { NextoreRemoteProjects } from '../src/components/NextoreRemoteProjects';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubListing(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response));
}

describe('NextoreRemoteProjects', () => {
  it('lists projects that only exist in NexTore', async () => {
    stubListing({
      projects: [
        { nextoreProjectId: '1', designerProjectId: 'local-a', name: 'Landing page', hasLocalContent: true },
        { nextoreProjectId: '2', designerProjectId: 'local-b', name: 'Deck draft', hasLocalContent: false },
      ],
      remoteWithoutLocal: ['local-b'],
      localWithoutRemote: [],
    });
    render(<NextoreRemoteProjects />);
    await waitFor(() => expect(screen.getByTestId('nextore-remote-projects')).toBeTruthy());
    expect(screen.getByText('Deck draft')).toBeTruthy();
    expect(screen.queryByText('Landing page')).toBeNull();
  });

  it('renders nothing when every project is local', async () => {
    stubListing({
      projects: [{ nextoreProjectId: '1', designerProjectId: 'local-a', name: 'Landing page', hasLocalContent: true }],
      remoteWithoutLocal: [],
      localWithoutRemote: [],
    });
    render(<NextoreRemoteProjects />);
    await waitFor(() => expect(screen.queryByTestId('nextore-remote-projects')).toBeNull());
  });
});
