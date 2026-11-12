import { describe, expect, it, vi } from 'vitest';

import type { NextoreClient } from '../src/nextore/client.js';
import { listNextoreProjects } from '../src/nextore/projects/list-projects.js';
import { registerNextoreProject } from '../src/nextore/projects/register-project.js';

function client(overrides: Partial<NextoreClient> = {}): NextoreClient {
  return {
    health: vi.fn(),
    branding: vi.fn(),
    bootstrap: vi.fn(),
    projectAccess: vi.fn(),
    projectPermissionUrl: vi.fn(),
    workspaces: vi.fn().mockResolvedValue({ Workspaces: [] }),
    workspaceProjects: vi.fn().mockResolvedValue({ Projects: [] }),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    ...overrides,
  } as unknown as NextoreClient;
}

const project = { id: 'local-1', name: 'Landing page', designSystemId: 'nextore', skillId: null };

describe('NexTore project wire compatibility', () => {
  it('creates a project against the live PascalCase workspace envelope', async () => {
    const workspaces = vi.fn().mockResolvedValue({
      Workspaces: [{ Id: 286041, Name: 'admin Workspace', Type: 'personal' }],
    });
    const createProject = vi.fn().mockResolvedValue({ Id: 77 });

    const result = await registerNextoreProject({
      client: client({ workspaces, createProject }),
      accessToken: 'token',
      project,
    });

    expect(result).toEqual({ ok: true, nextoreProjectId: '77', workspaceId: 286041 });
    expect(createProject).toHaveBeenCalledWith('token', expect.objectContaining({
      workspaceId: 286041,
      designerProjectId: 'local-1',
    }));
  });

  it('lists live PascalCase workspaces and projects', async () => {
    const workspaces = vi.fn().mockResolvedValue({
      Workspaces: [
        { Id: 286041, Name: 'admin Workspace', Type: 'personal' },
        { Id: 286042, Name: 'Team', Type: 'team' },
      ],
    });
    const workspaceProjects = vi.fn()
      .mockResolvedValueOnce({
        Projects: [{
          Id: 10,
          Name: 'Local project',
          DesignerProjectId: 'local-a',
          DesignSystemId: 'nextore',
          SkillId: '',
          Status: 'active',
        }],
      })
      .mockResolvedValueOnce({
        Projects: [{
          Id: 11,
          Name: 'Remote project',
          DesignerProjectId: 'remote-b',
          DesignSystemId: null,
          SkillId: null,
          Status: 'active',
        }],
      });

    const listing = await listNextoreProjects({
      client: client({ workspaces, workspaceProjects }),
      accessToken: 'token',
      localProjectIds: ['local-a'],
    });

    expect(listing.workspaces).toEqual([
      { id: 286041, name: 'admin Workspace', type: 'personal', readable: true, projectIds: ['local-a'], sharedOnly: false },
      { id: 286042, name: 'Team', type: 'team', readable: true, projectIds: ['remote-b'], sharedOnly: false },
    ]);
    expect(listing.projects[0]).toMatchObject({
      nextoreProjectId: '10',
      designerProjectId: 'local-a',
      hasLocalContent: true,
      workspaceId: 286041,
    });
    expect(listing.projects[1]).toMatchObject({
      nextoreProjectId: '11',
      designerProjectId: 'remote-b',
      hasLocalContent: false,
      workspaceId: 286042,
    });
    expect(listing.remoteWithoutLocal).toEqual(['remote-b']);
  });
});
