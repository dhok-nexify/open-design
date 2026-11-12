import { describe, expect, it, vi } from 'vitest';

import { createNextoreClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';
import {
  MAX_TEAM_WORKSPACE_GRANTS,
  parseTeamWorkspaceRequest,
} from '../src/nextore/workspaces/routes.js';

const config: NextoreConfig = {
  baseUrl: 'https://nexample.test',
  oauthClientId: 'designer',
  designerBaseUrl: 'https://designer.test',
  secretFile: '/tmp/secret',
  trustProxy: null,
};

describe('parseTeamWorkspaceRequest', () => {
  it('normalizes a valid payload', () => {
    const result = parseTeamWorkspaceRequest({
      name: '  Content Team  ',
      grants: [
        { groupId: 4, role: 'manager' },
        { groupId: 5, role: 'editor' },
        { groupId: 6, role: 'reader' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Content Team',
        grants: [
          { groupId: 4, role: 'manager' },
          { groupId: 5, role: 'editor' },
          { groupId: 6, role: 'reader' },
        ],
      },
    });
  });

  it('rejects a missing payload', () => {
    expect(parseTeamWorkspaceRequest(null)).toMatchObject({ ok: false });
    expect(parseTeamWorkspaceRequest({})).toMatchObject({ ok: false });
  });

  it('rejects a blank or overlong name', () => {
    expect(parseTeamWorkspaceRequest({ name: ' ', grants: [{ groupId: 1, role: 'reader' }] }))
      .toMatchObject({ ok: false });
    expect(parseTeamWorkspaceRequest({
      name: 'x'.repeat(129),
      grants: [{ groupId: 1, role: 'reader' }],
    })).toMatchObject({ ok: false });
  });

  it('rejects missing, duplicate or invalid grants', () => {
    expect(parseTeamWorkspaceRequest({ name: 'Team', grants: [] })).toMatchObject({ ok: false });
    expect(parseTeamWorkspaceRequest({
      name: 'Team',
      grants: [
        { groupId: 4, role: 'manager' },
        { groupId: 4, role: 'reader' },
      ],
    })).toMatchObject({ ok: false });
    expect(parseTeamWorkspaceRequest({
      name: 'Team',
      grants: [{ groupId: 0, role: 'reader' }],
    })).toMatchObject({ ok: false });
    expect(parseTeamWorkspaceRequest({
      name: 'Team',
      grants: [{ groupId: 4, role: 'owner' }],
    })).toMatchObject({ ok: false });
  });

  it('caps the number of grants', () => {
    const grants = Array.from({ length: MAX_TEAM_WORKSPACE_GRANTS + 1 }, (_, index) => ({
      groupId: index + 1,
      role: 'reader',
    }));

    expect(parseTeamWorkspaceRequest({ name: 'Team', grants })).toMatchObject({ ok: false });
  });
});

describe('NextoreClient.createWorkspace', () => {
  it('posts the role grants to the module workspaces endpoint', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 91, name: 'Content Team', type: 'team' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = createNextoreClient({ config, fetch: fetchImpl as typeof fetch });
    const created = await client.createWorkspace('token-1', {
      name: 'Content Team',
      grants: [{ groupId: 4, role: 'manager' }],
    });

    expect(created).toEqual({ id: 91, name: 'Content Team', type: 'team' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://nexample.test/api/designer/workspaces');
    expect(requests[0]!.init?.method).toBe('POST');
    const headers = requests[0]!.init?.headers as Record<string, string>;
    expect(headers.APIkey).toBe('token-1');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      name: 'Content Team',
      grants: [{ groupId: 4, role: 'manager' }],
    });
  });
});
