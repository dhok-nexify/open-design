import { beforeEach, describe, expect, it } from 'vitest';

import {
  noteWorkspaceDirectorySupport,
  resetWorkspaceDirectorySupport,
} from '../../src/collab/workspace-directory-support';
import { amrBillingWorkspaceAuthority } from '../../src/runtime/amr-billing-authority';
import type { WorkspaceContextState } from '../../src/collab/useWorkspaceContext';

const team = {
  workspaceId: 'workspace-a',
  workspaceType: 'team',
  workspaceMemberId: 'member-a',
};

function state(overrides: Record<string, unknown> = {}): WorkspaceContextState {
  return {
    context: team,
    loading: false,
    ...overrides,
  } as unknown as WorkspaceContextState;
}

/**
 * One derivation for the pre-submit gate and the post-gate identity re-check.
 * If the two ever disagree, every submit on an old daemon is dropped as a
 * stale identity, so the demotion rules live here and are asserted here.
 */
describe('amrBillingWorkspaceAuthority', () => {
  beforeEach(() => resetWorkspaceDirectorySupport());

  it('keeps the workspace authority while the daemon answers both endpoints', () => {
    expect(amrBillingWorkspaceAuthority(state())).toBe(team);
  });

  it('demotes when the context endpoint does not exist', () => {
    expect(amrBillingWorkspaceAuthority(state({ failure: 'unsupported' }))).toBeNull();
  });

  it('demotes when the directory endpoint does not exist', () => {
    noteWorkspaceDirectorySupport('unsupported');
    expect(amrBillingWorkspaceAuthority(state())).toBeNull();
  });

  it('does not demote on a transient directory failure', () => {
    noteWorkspaceDirectorySupport('unknown');
    expect(amrBillingWorkspaceAuthority(state())).toBe(team);
  });

  it('demotes when there is no workspace at all', () => {
    expect(amrBillingWorkspaceAuthority(state({ context: null }))).toBeNull();
  });
});
