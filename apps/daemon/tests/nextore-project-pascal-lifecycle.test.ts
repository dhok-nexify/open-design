import http from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNextoreClient } from '../src/nextore/client.js';
import { listNextoreProjects } from '../src/nextore/projects/list-projects.js';
import { registerNextoreProject } from '../src/nextore/projects/register-project.js';
import { normalizeAccess, normalizePermissionUrl } from '../src/nextore/wire.js';

let server: http.Server | undefined;
let baseUrl = '';

beforeEach(async () => {
  server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/api/designer/workspaces') {
      return send(200, {
        Workspaces: [{ Id: 286041, Name: 'admin Workspace', Type: 'personal' }],
      });
    }
    if (req.method === 'GET' && url === '/api/designer/workspaces/286041/projects') {
      return send(200, {
        Projects: [{
          Id: 10,
          Name: 'Landing page',
          DesignerProjectId: 'local-1',
          DesignSystemId: 'nextore',
          SkillId: null,
          Status: 'active',
        }],
      });
    }
    if (req.method === 'POST' && url === '/api/designer/projects') {
      return send(200, { Id: 10 });
    }
    if (req.method === 'GET' && url === '/api/designer/projects/10/access') {
      return send(200, {
        Exists: true,
        CanRead: true,
        CanEdit: true,
        CanDelete: false,
        CanManage: false,
        CanDownload: true,
      });
    }
    if (req.method === 'GET' && url.startsWith('/api/designer/projects/10/permission-url')) {
      return send(200, { Url: 'https://nextore.test/permissions/10' });
    }
    return send(404, { Error: 'not_found' });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('fake module did not bind');
  baseUrl = 'http://127.0.0.1:' + address.port;
});

afterEach(async () => {
  const current = server;
  server = undefined;
  await new Promise<void>((resolve) => current?.close(() => resolve()));
});

function client() {
  return createNextoreClient({
    config: {
      baseUrl,
      oauthClientId: 'client-1',
      designerBaseUrl: 'https://designer.test',
      secretFile: '/tmp/secret',
      trustProxy: null,
    },
    timeoutMs: 2000,
  });
}

describe('NexTore PascalCase lifecycle', () => {
  it('creates and lists through the live module shapes', async () => {
    const nextore = client();
    const created = await registerNextoreProject({
      client: nextore,
      accessToken: 'nex-token',
      project: { id: 'local-1', name: 'Landing page', designSystemId: 'nextore', skillId: null },
    });
    expect(created).toEqual({ ok: true, nextoreProjectId: '10', workspaceId: 286041 });

    const listing = await listNextoreProjects({
      client: nextore,
      accessToken: 'nex-token',
      localProjectIds: ['local-1'],
    });
    expect(listing.projects[0]).toMatchObject({
      nextoreProjectId: '10',
      designerProjectId: 'local-1',
      hasLocalContent: true,
      workspaceId: 286041,
    });
  });

  it('normalizes access and permission URLs from the live module', async () => {
    const nextore = client();
    const access = await nextore.projectAccess<unknown>('nex-token', '10');
    expect(normalizeAccess(access)).toMatchObject({ canRead: true, canEdit: true, canDownload: true });
    const permission = await nextore.projectPermissionUrl<unknown>('nex-token', '10');
    expect(normalizePermissionUrl(permission)).toBe('https://nextore.test/permissions/10');
  });
});
