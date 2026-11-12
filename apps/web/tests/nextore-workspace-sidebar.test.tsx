// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { NextoreWorkspaceSidebar } from '../src/nextore/WorkspaceSidebar';
import { resetNextoreProjectListing } from '../src/nextore/listing-store';
import { resetNextoreSessionView } from '../src/nextore/session-view';
import { clearNextoreWorkspaceSelection } from '../src/nextore/workspace-selection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetNextoreProjectListing();
  resetNextoreSessionView();
  clearNextoreWorkspaceSelection();
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

  it('lists shared projects separately and offers the admin team-workspace action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).includes('/api/nextore/session')) {
        return {
          ok: true,
          json: async () => ({
            memberId: 1,
            rights: { access: true, createProject: true, admin: true, manageMcp: true },
            groups: [{ id: 4, name: 'ND Editor' }],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({
          workspaces: [{ id: 9, name: 'admin Workspace', type: 'personal', sharedOnly: true }],
          projects: [
            {
              nextoreProjectId: '10',
              designerProjectId: 'local-shared',
              name: 'Shared launch',
              hasLocalContent: true,
              workspaceId: 9,
              workspaceName: 'admin Workspace',
              workspaceType: 'personal',
            },
          ],
          remoteWithoutLocal: [],
          localWithoutRemote: [],
        }),
      } as unknown as Response;
    }));

    render(<NextoreWorkspaceSidebar />);
    await waitFor(() => expect(screen.getByText('Shared with you')).toBeTruthy());
    expect(screen.getByText('Shared launch').closest('a')?.getAttribute('href'))
      .toBe('/projects/local-shared');
    await waitFor(() => expect(screen.getByRole('button', { name: /New team workspace/i })).toBeTruthy());
  });
});
