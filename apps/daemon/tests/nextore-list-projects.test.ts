import { describe, expect, it, vi } from 'vitest';

import type { NextoreClient } from '../src/nextore/client.js';
import { listNextoreProjects } from '../src/nextore/projects/list-projects.js';

function client(overrides: Partial<NextoreClient> = {}): NextoreClient {
  return {
    health: vi.fn(),
    branding: vi.fn(),
    bootstrap: vi.fn(),
    projectAccess: vi.fn(),
    projectPermissionUrl: vi.fn(),
    workspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
    workspaceProjects: vi.fn().mockResolvedValue({ projects: [] }),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    ...overrides,
  } as unknown as NextoreClient;
}

const summary = (id: number, designerProjectId: string, name = 'P' + id) => ({
  id,
  name,
  designerProjectId,
  designSystemId: 'nextore',
  skillId: '',
  status: 'active',
});

describe('listNextoreProjects', () => {
  it('lists projects across workspaces and marks local content', async () => {
    const workspaces = vi.fn().mockResolvedValue({
      workspaces: [
        { id: 1, name: 'Me', type: 'personal' },
        { id: 2, name: 'Team', type: 'team' },
      ],
    });
    const workspaceProjects = vi.fn()
      .mockResolvedValueOnce({ projects: [summary(10, 'local-a')] })
      .mockResolvedValueOnce({ projects: [summary(11, 'remote-b')] });

    const listing = await listNextoreProjects({
      client: client({ workspaces, workspaceProjects }),
      accessToken: 'token',
      localProjectIds: ['local-a', 'local-c'],
    });

    expect(listing.projects.map((p) => p.designerProjectId)).toEqual(['local-a', 'remote-b']);
    expect(listing.projects[0]).toMatchObject({
      hasLocalContent: true,
      nextoreProjectId: '10',
      workspaceId: 1,
      workspaceName: 'Me',
      workspaceType: 'personal',
    });
    expect(listing.projects[1]).toMatchObject({
      hasLocalContent: false,
      skillId: null,
      workspaceId: 2,
      workspaceName: 'Team',
    });
    expect(listing.workspaces).toEqual([
      { id: 1, name: 'Me', type: 'personal', readable: true, projectIds: ['local-a'] },
      { id: 2, name: 'Team', type: 'team', readable: true, projectIds: ['remote-b'] },
    ]);
    expect(listing.remoteWithoutLocal).toEqual(['remote-b']);
    expect(listing.localWithoutRemote).toEqual(['local-c']);
    expect(workspaceProjects).toHaveBeenCalledWith('token', 1);
    expect(workspaceProjects).toHaveBeenCalledWith('token', 2);
  });

  it('dedupes a project that appears in more than one workspace', async () => {
    const workspaceProjects = vi.fn()
      .mockResolvedValue({ projects: [summary(10, 'local-a')] });
    const listing = await listNextoreProjects({
      client: client({
        workspaces: vi.fn().mockResolvedValue({
          workspaces: [{ id: 1, name: 'Me', type: 'personal' }, { id: 2, name: 'Team', type: 'team' }],
        }),
        workspaceProjects,
      }),
      accessToken: 'token',
      localProjectIds: ['local-a'],
    });
    expect(listing.projects).toHaveLength(1);
    expect(listing.localWithoutRemote).toEqual([]);
  });

  it('keeps listing the workspaces it can read when one fails', async () => {
    const workspaceProjects = vi.fn()
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce({ projects: [summary(11, 'remote-b')] });
    const listing = await listNextoreProjects({
      client: client({
        workspaces: vi.fn().mockResolvedValue({
          workspaces: [{ id: 1, name: 'A', type: 'personal' }, { id: 2, name: 'B', type: 'team' }],
        }),
        workspaceProjects,
      }),
      accessToken: 'token',
      localProjectIds: [],
    });
    expect(listing.projects.map((p) => p.designerProjectId)).toEqual(['remote-b']);
    expect(listing.workspaces).toEqual([
      { id: 1, name: 'A', type: 'personal', readable: false, projectIds: [] },
      { id: 2, name: 'B', type: 'team', readable: true, projectIds: ['remote-b'] },
    ]);
  });

  it('keeps a readable workspace that has no projects yet', async () => {
    const listing = await listNextoreProjects({
      client: client({
        workspaces: vi.fn().mockResolvedValue({
          workspaces: [{ id: 3, name: 'Empty team', type: 'team' }],
        }),
      }),
      accessToken: 'token',
      localProjectIds: [],
    });
    expect(listing.projects).toEqual([]);
    expect(listing.workspaces).toEqual([
      { id: 3, name: 'Empty team', type: 'team', readable: true, projectIds: [] },
    ]);
  });

  it('handles a member with no workspaces', async () => {
    const listing = await listNextoreProjects({
      client: client(),
      accessToken: 'token',
      localProjectIds: ['local-a'],
    });
    expect(listing.projects).toEqual([]);
    expect(listing.workspaces).toEqual([]);
    expect(listing.localWithoutRemote).toEqual(['local-a']);
  });
});
