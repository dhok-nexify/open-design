import { describe, expect, it, vi } from 'vitest';

import { NextoreClientError, type NextoreClient } from '../src/nextore/client.js';
import {
  pickWorkspaceId,
  registerNextoreProject,
} from '../src/nextore/projects/register-project.js';

function client(overrides: Partial<NextoreClient> = {}): NextoreClient {
  return {
    health: vi.fn(),
    branding: vi.fn(),
    bootstrap: vi.fn(),
    projectAccess: vi.fn(),
    projectPermissionUrl: vi.fn(),
    workspaces: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    ...overrides,
  } as unknown as NextoreClient;
}

const project = { id: 'local-1', name: 'Landing page', designSystemId: 'nextore', skillId: null };

describe('pickWorkspaceId', () => {
  it('prefers the personal workspace', () => {
    expect(pickWorkspaceId([
      { id: 9, name: 'Team', type: 'team' },
      { id: 3, name: 'Me', type: 'personal' },
    ])).toBe(3);
  });

  it('falls back to the first workspace and to null', () => {
    expect(pickWorkspaceId([{ id: 9, name: 'Team', type: 'team' }])).toBe(9);
    expect(pickWorkspaceId([])).toBeNull();
  });
});

describe('registerNextoreProject', () => {
  it('resolves the workspace and creates the record with the local id', async () => {
    const workspaces = vi.fn().mockResolvedValue({
      workspaces: [{ id: 4, name: 'Me', type: 'personal' }],
    });
    const createProject = vi.fn().mockResolvedValue({ id: 77 });

    const result = await registerNextoreProject({
      client: client({ workspaces, createProject }),
      accessToken: 'token',
      project,
    });

    expect(result).toEqual({ ok: true, nextoreProjectId: '77', workspaceId: 4 });
    expect(createProject).toHaveBeenCalledWith('token', {
      workspaceId: 4,
      name: 'Landing page',
      designerProjectId: 'local-1',
      designSystemId: 'nextore',
      skillId: null,
      designerUrl: null,
    });
  });

  it('skips the workspace lookup when an id is supplied', async () => {
    const workspaces = vi.fn();
    const createProject = vi.fn().mockResolvedValue({ id: 5 });
    await registerNextoreProject({
      client: client({ workspaces, createProject }),
      accessToken: 'token',
      project,
      workspaceId: 11,
    });
    expect(workspaces).not.toHaveBeenCalled();
    expect(createProject).toHaveBeenCalledWith('token', expect.objectContaining({ workspaceId: 11 }));
  });

  it('refuses when the member has no workspace', async () => {
    const result = await registerNextoreProject({
      client: client({ workspaces: vi.fn().mockResolvedValue({ workspaces: [] }) }),
      accessToken: 'token',
      project,
    });
    expect(result).toMatchObject({ ok: false, code: 'NO_WORKSPACE' });
  });

  it('reports a module failure instead of pretending the project exists', async () => {
    const result = await registerNextoreProject({
      client: client({ createProject: vi.fn().mockRejectedValue(new Error('boom')) }),
      accessToken: 'token',
      project,
      workspaceId: 1,
    });
    expect(result).toMatchObject({ ok: false, code: 'NEXTORE_ERROR' });
  });

  it('names a taken project name as a conflict, not an outage', async () => {
    const createProject = vi.fn().mockRejectedValue(
      new NextoreClientError(
        'nextore_http_error',
        'A project named "Landing page" already exists in this workspace.',
        409,
        'project_name_conflict',
      ),
    );

    const result = await registerNextoreProject({
      client: client({ createProject }),
      accessToken: 'token',
      project,
      workspaceId: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'PROJECT_NAME_CONFLICT',
      message: expect.stringContaining('already exists'),
    });
  });

  it('rejects a created record with no id', async () => {
    const result = await registerNextoreProject({
      client: client({ createProject: vi.fn().mockResolvedValue({}) }),
      accessToken: 'token',
      project,
      workspaceId: 1,
    });
    expect(result).toMatchObject({ ok: false, code: 'NEXTORE_ERROR' });
  });
});
