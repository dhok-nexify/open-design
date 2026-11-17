// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/nextore/features', () => ({
  NEXTORE_WEB_EDITION: 'nextore',
  isFeatureEnabled: () => false,
}));

import { EntryTopRightCluster } from '../../src/components/EntryNavRail';
import { WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID } from '../../src/components/workspaceChromeActions';
import { I18nProvider } from '../../src/i18n';

const context = {
  workspaceId: 'ws-team',
  workspaceType: 'team',
  workspaceMemberId: 'wm-1',
  role: 'owner',
  memberStatus: 'active',
  lifecycleState: 'active',
  billingState: 'active',
  planId: 'team_plus',
  displayName: 'Leaf',
  seatSummary: { seatLimit: 5, usedSeats: 1, availableSeats: 4, isSeatFull: false },
  permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
} as unknown as WorkspaceCollabContext;

let accountHost: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/messages?')) {
      return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
    }
    return Response.json({ items: [] });
  }));
  const chrome = document.createElement('header');
  chrome.className = 'workspace-tabs-chrome';
  const clusterHost = document.createElement('div');
  clusterHost.id = WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID;
  chrome.append(clusterHost);
  accountHost = document.createElement('div');
  document.body.append(chrome, accountHost);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('.workspace-tabs-chrome')?.remove();
  accountHost.remove();
});

describe('NexTore home chrome', () => {
  it('drops the upstream GitHub chip and community links', async () => {
    render(
      <I18nProvider initial="en">
        <EntryTopRightCluster page="home" context={context} accountHost={accountHost} />
      </I18nProvider>,
    );
    await act(async () => {});

    expect(screen.queryByTestId('entry-top-right-github')).toBeNull();
    expect(screen.queryByTestId('entry-nav-rail-social')).toBeNull();

    fireEvent.click(screen.getByTestId('entry-nav-account'));
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
  });
});
