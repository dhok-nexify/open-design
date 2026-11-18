import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceCollabContext } from '@open-design/contracts';
import { amrBalanceGateScopeForWorkspaceContext } from '../../src/runtime/amr-balance-gate';

import {
  amrBillingWorkspaceAuthority,
  amrBillingWorkspaceAuthorityForContext,
} from '../../src/runtime/amr-billing-authority';
import type { WorkspaceContextState } from '../../src/collab/useWorkspaceContext';
import {
  noteWorkspaceDirectorySupport,
  resetWorkspaceDirectorySupport,
} from '../../src/collab/workspace-directory-support';

afterEach(() => {
  resetWorkspaceDirectorySupport();
});

const context = {
  workspaceId: 'ws-1',
  workspaceType: 'team',
  workspaceMemberId: 'member-1',
  role: 'owner',
  memberStatus: 'active',
  lifecycleState: 'active',
  billingState: 'active',
  planId: null,
  providerMode: 'platform_credits',
  seatSummary: { seatLimit: 5, usedSeats: 2 },
  permissions: {},
} as unknown as WorkspaceCollabContext;

function state(overrides: Partial<WorkspaceContextState> = {}): WorkspaceContextState {
  return {
    context,
    loading: false,
    failure: null,
    ...overrides,
  } as unknown as WorkspaceContextState;
}

describe('AMR billing workspace authority (P11)', () => {
  it('answers identically for the Home state and the ProjectView context', () => {
    noteWorkspaceDirectorySupport('supported');

    const home = amrBillingWorkspaceAuthority(state());
    const project = amrBillingWorkspaceAuthorityForContext(context);

    expect(home).not.toBeNull();
    expect(project).not.toBeNull();
    expect(project).toEqual(home);
  });

  it('both fall back to the account wallet when the directory is unsupported', () => {
    noteWorkspaceDirectorySupport('unsupported');

    expect(amrBillingWorkspaceAuthority(state())).toBeNull();
    expect(amrBillingWorkspaceAuthorityForContext(context)).toBeNull();
  });

  it('both fall back for a missing context', () => {
    noteWorkspaceDirectorySupport('supported');

    expect(amrBillingWorkspaceAuthority(state({ context: null }))).toBeNull();
    expect(amrBillingWorkspaceAuthorityForContext(null)).toBeNull();
  });

  it('both produce no billable scope for a blank workspace identity', () => {
    noteWorkspaceDirectorySupport('supported');

    const blank = { ...context, workspaceId: '  ', workspaceMemberId: ' ' } as WorkspaceCollabContext;
    const homeScope = amrBalanceGateScopeForWorkspaceContext(
      amrBillingWorkspaceAuthority(state({ context: blank })),
    );
    const projectScope = amrBalanceGateScopeForWorkspaceContext(
      amrBillingWorkspaceAuthorityForContext(blank),
    );

    expect(homeScope).toBeUndefined();
    expect(projectScope).toBe(homeScope);
  });

  it('stays on the account wallet after an unsupported verdict is cleared by a reset', () => {
    noteWorkspaceDirectorySupport('unsupported');
    expect(amrBillingWorkspaceAuthorityForContext(context)).toBeNull();

    resetWorkspaceDirectorySupport();
    expect(amrBillingWorkspaceAuthorityForContext(context)).not.toBeNull();
  });
});
