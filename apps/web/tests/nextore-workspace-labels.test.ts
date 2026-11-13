import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceLabelMap,
  countRemoteOnlyProjects,
  groupInScope,
  scopeProjectIds,
} from '../src/nextore/workspace-labels';
import type { NextoreProjectGroup } from '../src/nextore-projects';

const group = (
  workspaceId: number | null,
  workspaceName: string,
  sharedOnly: boolean,
  projects: Array<[string, boolean]>,
): NextoreProjectGroup => ({
  workspaceId,
  workspaceName,
  workspaceType: sharedOnly ? 'personal' : 'team',
  sharedOnly,
  projects: projects.map(([designerProjectId, hasLocalContent]) => ({
    nextoreProjectId: designerProjectId,
    designerProjectId,
    name: designerProjectId,
    hasLocalContent,
  })),
});

const groups = [
  group(1, 'admin Workspace', false, [['local-a', true], ['remote-b', false]]),
  group(2, 'Content Team', false, [['local-c', true]]),
  group(9, 'alice Workspace', true, [['shared-d', true], ['shared-e', false]]),
];

describe('groupInScope', () => {
  it('splits all, workspace and shared scopes', () => {
    expect(groups.filter((entry) => groupInScope(entry, { kind: 'all' }))).toHaveLength(3);
    expect(groups.filter((entry) => groupInScope(entry, { kind: 'workspace', id: 2 })))
      .toEqual([groups[1]]);
    expect(groups.filter((entry) => groupInScope(entry, { kind: 'shared' })))
      .toEqual([groups[2]]);
  });
});

describe('scopeProjectIds', () => {
  it('collects only the scoped ids', () => {
    expect([...scopeProjectIds(groups, { kind: 'workspace', id: 1 })])
      .toEqual(['local-a', 'remote-b']);
    expect([...scopeProjectIds(groups, { kind: 'shared' })])
      .toEqual(['shared-d', 'shared-e']);
  });
});

describe('buildWorkspaceLabelMap', () => {
  it('labels every project with its workspace, including shared ones', () => {
    const labels = buildWorkspaceLabelMap(groups);
    expect(labels.get('local-a')).toBe('admin Workspace');
    expect(labels.get('shared-d')).toBe('alice Workspace');
  });

  it('skips a group without a name', () => {
    expect(buildWorkspaceLabelMap([group(4, '', false, [['x', true]])]).size).toBe(0);
  });
});

describe('countRemoteOnlyProjects', () => {
  it('counts the scoped projects without local content', () => {
    expect(countRemoteOnlyProjects(groups, { kind: 'all' })).toBe(2);
    expect(countRemoteOnlyProjects(groups, { kind: 'workspace', id: 1 })).toBe(1);
    expect(countRemoteOnlyProjects(groups, { kind: 'shared' })).toBe(1);
  });
});
