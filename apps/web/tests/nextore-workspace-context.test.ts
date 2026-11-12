import { describe, expect, it } from 'vitest';

import { resolveWorkspaceContext } from '../src/nextore/workspace-context';
import type { NextoreProjectGroup } from '../src/nextore-projects';

const group = (
  workspaceId: number | null,
  workspaceName: string,
  workspaceType: string,
  sharedOnly = false,
): NextoreProjectGroup => ({
  workspaceId,
  workspaceName,
  workspaceType,
  sharedOnly,
  projects: [],
});

describe('resolveWorkspaceContext', () => {
  const groups = [
    group(1, 'admin Workspace', 'personal'),
    group(2, 'Content Team', 'team'),
    group(9, 'alice Workspace', 'personal', true),
  ];

  it('prefers the personal workspace when nothing is stored', () => {
    expect(resolveWorkspaceContext({ memberId: 7, groups, stored: null }))
      .toEqual({ memberId: 7, workspaceId: 1, name: 'admin Workspace' });
  });

  it('keeps a stored team workspace', () => {
    const stored = { memberId: 7, workspaceId: 2, name: 'Content Team' };
    expect(resolveWorkspaceContext({ memberId: 7, groups, stored }))
      .toEqual({ memberId: 7, workspaceId: 2, name: 'Content Team' });
  });

  it('falls back when the stored workspace is gone or belongs to another member', () => {
    expect(resolveWorkspaceContext({
      memberId: 7,
      groups,
      stored: { memberId: 7, workspaceId: 999, name: 'Deleted' },
    })).toEqual({ memberId: 7, workspaceId: 1, name: 'admin Workspace' });

    expect(resolveWorkspaceContext({
      memberId: 8,
      groups,
      stored: { memberId: 7, workspaceId: 2, name: 'Content Team' },
    })).toEqual({ memberId: 8, workspaceId: 1, name: 'admin Workspace' });
  });

  it('never lands on a shared-only workspace', () => {
    expect(resolveWorkspaceContext({
      memberId: 7,
      groups,
      stored: { memberId: 7, workspaceId: 9, name: 'alice Workspace' },
    })).toEqual({ memberId: 7, workspaceId: 1, name: 'admin Workspace' });
  });

  it('needs a member before it resolves anything', () => {
    expect(resolveWorkspaceContext({ memberId: null, groups, stored: null })).toBeNull();
    expect(resolveWorkspaceContext({ memberId: 7, groups: [], stored: null })).toBeNull();
  });
});
