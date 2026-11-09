// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { NextoreWorkspaceSidebar } from '../src/nextore/WorkspaceSidebar';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubListing(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response));
}

describe('NextoreWorkspaceSidebar', () => {
  it('groups projects by workspace and marks remote-only rows', async () => {
    stubListing({
      workspaces: [
        { id: 1, name: 'Me', type: 'personal' },
        { id: 2, name: 'Team', type: 'team' },
      ],
      projects: [
        {
          nextoreProjectId: '10',
          designerProjectId: 'local-a',
          name: 'Landing page',
          hasLocalContent: true,
          workspaceId: 1,
          workspaceName: 'Me',
          workspaceType: 'personal',
        },
        {
          nextoreProjectId: '11',
          designerProjectId: 'remote-b',
          name: 'Deck draft',
          hasLocalContent: false,
          workspaceId: 2,
          workspaceName: 'Team',
          workspaceType: 'team',
        },
      ],
      remoteWithoutLocal: ['remote-b'],
      localWithoutRemote: [],
    });
    render(<NextoreWorkspaceSidebar />);
    await waitFor(() => expect(screen.getByTestId('nextore-workspace-sidebar')).toBeTruthy());
    expect(screen.getByText('Me')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    const link = screen.getByText('Landing page').closest('a');
    expect(link?.getAttribute('href')).toBe('/projects/local-a');
    expect(screen.getByText('Deck draft').closest('a')).toBeNull();
    expect(screen.getByText('remote')).toBeTruthy();
  });

  it('renders nothing when NexTore has no projects', async () => {
    stubListing({ workspaces: [], projects: [], remoteWithoutLocal: [], localWithoutRemote: [] });
    render(<NextoreWorkspaceSidebar />);
    await waitFor(() => expect(screen.queryByTestId('nextore-workspace-sidebar')).toBeNull());
  });
});
