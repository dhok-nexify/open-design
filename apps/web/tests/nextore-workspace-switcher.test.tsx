// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NextoreWorkspaceSwitcher } from '../src/nextore/WorkspaceSwitcher';
import { resetNextoreProjectListing } from '../src/nextore/listing-store';
import { resetNextoreSessionView } from '../src/nextore/session-view';
import { resetNextoreWorkspaceContext } from '../src/nextore/workspace-context';

const listing = {
  workspaces: [
    { id: 1, name: 'admin Workspace', type: 'personal' },
    { id: 2, name: 'Content Team', type: 'team' },
    { id: 9, name: 'alice Workspace', type: 'personal', sharedOnly: true },
  ],
  projects: [
    {
      nextoreProjectId: '10',
      designerProjectId: 'local-a',
      name: 'Landing page',
      hasLocalContent: true,
      workspaceId: 1,
      workspaceName: 'admin Workspace',
      workspaceType: 'personal',
    },
    {
      nextoreProjectId: '11',
      designerProjectId: 'local-shared',
      name: 'Shared launch',
      hasLocalContent: true,
      workspaceId: 9,
      workspaceName: 'alice Workspace',
      workspaceType: 'personal',
    },
  ],
  remoteWithoutLocal: [],
  localWithoutRemote: [],
};

function stubFetch(admin: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (String(input).includes('/api/nextore/session')) {
      return {
        ok: true,
        json: async () => ({
          memberId: 7,
          rights: { access: true, createProject: true, admin, manageMcp: true },
          groups: [{ id: 4, name: 'ND Editor' }],
        }),
      } as unknown as Response;
    }
    return { ok: true, json: async () => listing } as unknown as Response;
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetNextoreProjectListing();
  resetNextoreSessionView();
  resetNextoreWorkspaceContext();
});

describe('NextoreWorkspaceSwitcher', () => {
  it('shows only the current workspace and never lists projects in the rail', async () => {
    stubFetch(true);
    render(<NextoreWorkspaceSwitcher />);

    const trigger = await screen.findByTestId('nextore-workspace-switcher');
    // The personal workspace wins as the default standing point.
    expect(trigger.textContent).toContain('admin Workspace');
    expect(screen.queryByText('Landing page')).toBeNull();
    expect(screen.queryByText('Shared launch')).toBeNull();
  });

  it('switches workspace from the menu and marks the current one', async () => {
    stubFetch(true);
    render(<NextoreWorkspaceSwitcher />);

    const trigger = await screen.findByTestId('nextore-workspace-switcher');
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.textContent).toContain('My workspaces');
    expect(menu.textContent).toContain('Team workspaces');

    const current = menu.querySelector('[role="menuitemradio"][aria-checked="true"]');
    expect(current?.textContent).toContain('admin Workspace');

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Content Team/ }));

    await waitFor(() => expect(trigger.textContent).toContain('Content Team'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    stubFetch(true);
    render(<NextoreWorkspaceSwitcher />);

    const trigger = await screen.findByTestId('nextore-workspace-switcher');
    fireEvent.click(trigger);
    await screen.findByRole('menu');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('offers the team-workspace dialog only to admins', async () => {
    stubFetch(false);
    render(<NextoreWorkspaceSwitcher />);

    const trigger = await screen.findByTestId('nextore-workspace-switcher');
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /New team workspace/ })).toBeNull();

    cleanup();
    resetNextoreProjectListing();
    resetNextoreSessionView();
    resetNextoreWorkspaceContext();
    stubFetch(true);
    render(<NextoreWorkspaceSwitcher />);

    const adminTrigger = await screen.findByTestId('nextore-workspace-switcher');
    fireEvent.click(adminTrigger);
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: /New team workspace/ })).toBeTruthy();
  });
});
