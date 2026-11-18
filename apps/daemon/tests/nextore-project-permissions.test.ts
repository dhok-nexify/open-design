import { describe, expect, it, vi } from 'vitest';

import { createNextoreClient, type NextorePermissionClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'designer-client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
};

describe('NexTore project permission client', () => {
  it('proxies reads, writes, group tree and member search with the session token', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const requestUrl = input instanceof URL ? input : new URL(String(input));
      calls.push((init?.method ?? 'GET') + ' ' + requestUrl.pathname + requestUrl.search);
      expect(new Headers(init?.headers).get('APIkey')).toBe('access-token');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createNextoreClient({ config, fetch: fetchMock as typeof fetch }) as ReturnType<typeof createNextoreClient> & NextorePermissionClient;

    await client.projectPermissions('access-token', '42');
    await client.saveProjectPermissions('access-token', '42', {
      isInherit: true,
      applyToAllChildren: false,
      items: [],
    });
    await client.permissionGroups('access-token', '42', 'design');
    await client.permissionMembers('access-token', '42', 'ann');

    expect(calls).toEqual([
      'GET /api/designer/projects/42/permissions',
      'POST /api/designer/projects/42/permissions',
      'GET /api/designer/projects/42/permission-groups?query=design',
      'GET /api/designer/projects/42/permission-members?query=ann',
    ]);
  });
});
