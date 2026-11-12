import { describe, expect, it, vi } from 'vitest';

import {
  fetchNextoreProjectListing,
  groupProjectsByWorkspace,
  remoteOnlyProjects,
} from '../src/nextore-projects';

const listing = {
  projects: [
    { nextoreProjectId: '1', designerProjectId: 'local-a', name: 'Landing page', hasLocalContent: true },
    { nextoreProjectId: '2', designerProjectId: 'local-b', name: 'Deck draft', hasLocalContent: false },
    { nextoreProjectId: '3', designerProjectId: 'local-c', name: '', hasLocalContent: false },
  ],
  remoteWithoutLocal: ['local-b'],
  localWithoutRemote: [],
};

describe('remoteOnlyProjects', () => {
  it('keeps only projects without local content and with a name', () => {
    expect(remoteOnlyProjects(listing).map((p) => p.designerProjectId)).toEqual(['local-b']);
  });

  it('tolerates a missing listing', () => {
    expect(remoteOnlyProjects(null)).toEqual([]);
  });
});

describe('groupProjectsByWorkspace', () => {
  it('groups projects under the workspaces the server returned, in order', () => {
    const groups = groupProjectsByWorkspace({
      workspaces: [
        { id: 1, name: 'Me', type: 'personal' },
        { id: 2, name: 'admin Workspace', type: 'personal', sharedOnly: true },
      ],
      projects: [
        {
          nextoreProjectId: '10',
          designerProjectId: 'local-a',
          name: 'Landing page',
          workspaceId: 1,
          workspaceName: 'Me',
          workspaceType: 'personal',
        },
        {
          nextoreProjectId: '11',
          designerProjectId: 'remote-b',
          name: 'Deck draft',
          workspaceId: 2,
          workspaceName: 'Team',
          workspaceType: 'team',
        },
      ],
      remoteWithoutLocal: ['remote-b'],
      localWithoutRemote: [],
    });
    expect(groups.map((group) => group.workspaceId)).toEqual([1, 2]);
    expect(groups.map((group) => group.sharedOnly)).toEqual([false, true]);
    expect(groups.map((group) => group.projects.map((p) => p.designerProjectId)))
      .toEqual([['local-a'], ['remote-b']]);
  });

  it('keeps empty workspaces and adds unassigned projects once', () => {
    const groups = groupProjectsByWorkspace({
      workspaces: [{ id: 1, name: 'Me', type: 'personal' }],
      projects: [
        { nextoreProjectId: '10', designerProjectId: 'local-a', name: 'Legacy' },
        { nextoreProjectId: '10', designerProjectId: 'local-a', name: 'Legacy' },
      ],
      remoteWithoutLocal: [],
      localWithoutRemote: [],
    });
    expect(groups.map((group) => group.workspaceId)).toEqual([1, null]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.projects).toEqual([]);
    expect(groups[1]?.workspaceName).toBe('');
    expect(groups[1]?.projects).toHaveLength(1);
  });

  it('tolerates a missing listing', () => {
    expect(groupProjectsByWorkspace(null)).toEqual([]);
  });
});

describe('fetchNextoreProjectListing', () => {
  it('normalises the payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projects: [{ nextoreProjectId: '1' }],
        workspaces: [{ id: 9, name: 'admin Workspace', type: 'personal', sharedOnly: true }],
      }),
    } as unknown as Response);
    const result = await fetchNextoreProjectListing(fetchImpl as never);
    expect(result?.projects).toHaveLength(1);
    expect(result?.workspaces).toEqual([
      { id: 9, name: 'admin Workspace', type: 'personal', sharedOnly: true },
    ]);
    expect(result?.remoteWithoutLocal).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/nextore/projects', expect.anything());
  });

  it('returns null on failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);
    await expect(fetchNextoreProjectListing(fetchImpl as never)).resolves.toBeNull();
  });
});
