import express from 'express';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerProjectRoutes } from '../../src/routes/project/index.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

function noop() {}

function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      return property in target ? target[property as string] : noop;
    },
  });
}

// The mapping is what points a local project at the NexTore ACL, so a patch
// that rebuilds metadata must never be able to drop it or repoint it.
const MAPPED_METADATA = {
  kind: 'prototype',
  nextoreProjectId: '286139',
};

function buildDeps(input: {
  updateProject: ReturnType<typeof vi.fn>;
  existingMetadata?: Record<string, unknown> | null;
}) {
  return {
    db: {
      transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => fn(...args),
    },
    design: {},
    http: {
      createSseResponse: noop,
      sendApiError: (
        res: express.Response,
        status: number,
        code: string,
        message: string,
      ) => res.status(status).json({ error: { code, message } }),
    },
    paths: {
      DESIGN_SYSTEMS_DIR: '',
      PROJECTS_DIR: '',
      SKILLS_DIR: '',
      BRANDS_DIR: '',
      USER_DESIGN_SYSTEMS_DIR: '',
    },
    projectStore: functionProxy({
      insertProject: vi.fn(),
      updateProject: input.updateProject,
      validateLinkedDirs: () => ({ dirs: [] }),
      getProject: () => ({
        id: 'mapped-project',
        name: 'Mapped project',
        skillId: null,
        designSystemId: null,
        metadata: input.existingMetadata ?? MAPPED_METADATA,
        createdAt: 1,
        updatedAt: 1,
      }),
      getWorkspaceProject: () => null,
      getWorkspaceProjectByProjectId: () => null,
      listWorkspaceProjects: () => [],
      listProjects: () => [],
    }),
    projectFiles: functionProxy({
      listFiles: () => [],
      listTabs: () => [],
      resolveProjectDir: () => '',
    }),
    conversations: functionProxy({ insertConversation: vi.fn() }),
    templates: functionProxy({ listTemplates: () => [] }),
    status: functionProxy({
      listLatestProjectRunStatuses: () => new Map(),
      listProjectsAwaitingInput: () => new Set(),
      listProjects: () => [],
      listUnboundProjects: () => [],
    }),
    events: functionProxy({ activeProjectEventSinks: new Map() }),
    ids: { randomId: () => 'conversation-id' },
    telemetry: { reportFinalizedMessage: noop },
    appConfig: { readAppConfig: async () => ({}), writeAppConfig: noop },
    agents: {},
    validation: {
      validateProjectDesignSystemId: vi.fn(async (id: string) => ({ ok: true, id })),
      validateProjectSkillId: vi.fn(async (id: string) => ({ ok: true, id })),
    },
    collabSync: functionProxy(),
    authorizeProjectRequest: vi.fn(async () => true),
    fetchProjectCreationWorkspaceDirectory: vi.fn(async () => ({ ok: false, items: [] })),
    pluginScope: {
      loadRegistry: vi.fn(async () => ({
        skills: [],
        designSystems: [],
        craft: [],
        atoms: [],
        scenarios: [],
      })),
      getPlugin: vi.fn(async () => ({})),
    },
  } as unknown as Parameters<typeof registerProjectRoutes>[1];
}

async function start(deps: Parameters<typeof registerProjectRoutes>[1]) {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, deps);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function patch(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/projects/mapped-project`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/projects/:id and the NexTore mapping', () => {
  it('keeps the mapping when a metadata patch omits it', async () => {
    const updateProject = vi.fn((_: unknown, id: string, patchBody: Record<string, unknown>) => ({
      id,
      ...patchBody,
    }));
    const base = await start(buildDeps({ updateProject }));

    const res = await patch(base, { metadata: { kind: 'prototype', nameSource: 'agent' } });

    expect(res.status).toBe(200);
    const sent = updateProject.mock.calls[0]?.[2] as { metadata: Record<string, unknown> };
    expect(sent.metadata.nextoreProjectId).toBe('286139');
    expect(sent.metadata.nameSource).toBe('agent');
  });

  it('refuses a patch that repoints the mapping', async () => {
    const updateProject = vi.fn();
    const base = await start(buildDeps({ updateProject }));

    const res = await patch(base, { metadata: { nextoreProjectId: '999999' } });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('nextoreProjectId is daemon-owned');
    expect(updateProject).not.toHaveBeenCalled();
  });
});
