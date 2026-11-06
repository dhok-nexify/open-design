import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNextoreClient } from '../src/nextore/client.js';
import { listNextoreProjects } from '../src/nextore/projects/list-projects.js';
import { registerNextoreProject } from '../src/nextore/projects/register-project.js';

/**
 * Contract test between the daemon's NexTore client and the module's project
 * API (NXD-D08). The fake server speaks the shapes NexToreDesignerModule
 * returns, so create -> list -> delete is exercised end to end without a real
 * site: transport (POST/DELETE + APIkey header), workspace resolution, the
 * listing merge and the delete call.
 */
interface FakeProject {
  id: number;
  name: string;
  designerProjectId: string;
  designSystemId: string;
  skillId: string;
  status: string;
}

let server: http.Server | undefined;
let baseUrl = '';
let projects: FakeProject[] = [];
let nextId = 100;
const seen: Array<{ method: string; url: string; apiKey: string | undefined }> = [];

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

beforeEach(async () => {
  projects = [];
  nextId = 100;
  seen.length = 0;
  server = http.createServer(async (req, res) => {
    const apiKey = req.headers['apikey'];
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      apiKey: typeof apiKey === 'string' ? apiKey : undefined,
    });
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
      return undefined;
    };

    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/api/designer/workspaces') {
      return send(200, { workspaces: [{ id: 1, name: 'Me', type: 'personal', ownerMemberId: 7 }] });
    }
    if (req.method === 'GET' && url === '/api/designer/workspaces/1/projects') {
      return send(200, { projects });
    }
    if (req.method === 'POST' && url === '/api/designer/projects') {
      const body = JSON.parse(await readBody(req)) as {
        workspaceId: number;
        name: string;
        designerProjectId: string;
        designSystemId?: string | null;
        skillId?: string | null;
      };
      if (!projects.some((project) => project.designerProjectId === body.designerProjectId)) {
        projects.push({
          id: nextId++,
          name: body.name,
          designerProjectId: body.designerProjectId,
          designSystemId: body.designSystemId ?? '',
          skillId: body.skillId ?? '',
          status: 'active',
        });
      }
      const created = projects.find((p) => p.designerProjectId === body.designerProjectId)!;
      return send(200, { id: created.id });
    }
    const deleteMatch = /^\/api\/designer\/projects\/(\d+)$/.exec(url);
    if (req.method === 'DELETE' && deleteMatch) {
      const id = Number(deleteMatch[1]);
      const before = projects.length;
      projects = projects.filter((project) => project.id !== id);
      return send(projects.length === before ? 404 : 200, { ok: true });
    }
    const accessMatch = /^\/api\/designer\/projects\/(\d+)\/access$/.exec(url);
    if (req.method === 'GET' && accessMatch) {
      return send(200, {
        exists: true,
        canRead: true,
        canEdit: true,
        canDelete: true,
        canManage: true,
        canDownload: true,
      });
    }
    const permissionMatch = /^\/api\/designer\/projects\/(\d+)\/permission-url/.exec(url);
    if (req.method === 'GET' && permissionMatch) {
      return send(200, { url: 'https://nextore.test/permissions/' + permissionMatch[1] });
    }
    return send(404, { error: 'not_found' });
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

describe('NexTore project lifecycle', () => {
  it('creates, lists and deletes a project through the module API', async () => {
    const nextore = client();

    const created = await registerNextoreProject({
      client: nextore,
      accessToken: 'nex-token',
      project: { id: 'local-1', name: 'Landing page', designSystemId: 'nextore', skillId: null },
    });
    expect(created).toMatchObject({ ok: true, nextoreProjectId: '100', workspaceId: 1 });

    const beforeContent = await listNextoreProjects({
      client: nextore,
      accessToken: 'nex-token',
      localProjectIds: [],
    });
    expect(beforeContent.projects).toHaveLength(1);
    expect(beforeContent.projects[0]).toMatchObject({
      designerProjectId: 'local-1',
      hasLocalContent: false,
    });
    expect(beforeContent.remoteWithoutLocal).toEqual(['local-1']);

    const withContent = await listNextoreProjects({
      client: nextore,
      accessToken: 'nex-token',
      localProjectIds: ['local-1'],
    });
    expect(withContent.projects[0]?.hasLocalContent).toBe(true);
    expect(withContent.localWithoutRemote).toEqual([]);

    await nextore.deleteProject('nex-token', '100');
    const after = await listNextoreProjects({
      client: nextore,
      accessToken: 'nex-token',
      localProjectIds: ['local-1'],
    });
    expect(after.projects).toEqual([]);
    expect(after.localWithoutRemote).toEqual(['local-1']);

    // Every module call carried the session key, never a body/query credential.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((call) => call.apiKey === 'nex-token')).toBe(true);
    expect(seen.some((call) => call.method === 'POST' && call.url === '/api/designer/projects')).toBe(true);
    expect(seen.some((call) => call.method === 'DELETE' && call.url === '/api/designer/projects/100')).toBe(true);
  });

  it('reads effective rights and the permission URL for a project', async () => {
    const nextore = client();
    const access = await nextore.projectAccess<{ canEdit: boolean }>('nex-token', '42');
    expect(access.canEdit).toBe(true);
    const permission = await nextore.projectPermissionUrl<{ url: string }>(
      'nex-token',
      '42',
      'https://designer.test/projects/local-1',
    );
    expect(permission.url).toBe('https://nextore.test/permissions/42');
    expect(seen.some((call) => call.url.includes('returnUrl='))).toBe(true);
  });
});
