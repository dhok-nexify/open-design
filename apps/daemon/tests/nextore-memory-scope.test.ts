import { promises as fsp } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NextoreConfig } from '../src/nextore/config.js';
import {
  memoryRootFor,
  memoryScopeId,
  nextoreFastMemoryProvider,
  readNextoreMemorySession,
} from '../src/nextore/memory/scoped-memory.js';
import { registerMemoryRoutes } from '../src/routes/memory.js';
import {
  __resetExtractionsForTests,
  listExtractions,
  recordHeuristic,
} from '../src/memory-extractions.js';

const config: NextoreConfig = {
  baseUrl: 'https://nextore.test',
  oauthClientId: 'designer-client',
  designerBaseUrl: 'https://designer.test',
  secretFile: '/unused',
  trustProxy: null,
};

let runtimeDataDir = '';
let server: http.Server | undefined;
let baseUrl = '';

async function listen(app: express.Express): Promise<void> {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function closeServer(): Promise<void> {
  if (!server) return;
  const current = server;
  server = undefined;
  if (!current.listening) return;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const member = req.header('x-test-member');
    if (member) {
      res.locals.nextoreSession = {
        memberId: Number(member),
        accessToken: 'access-token',
        member: {
          features: { memory: req.header('x-test-memory') !== '0' },
        },
      };
    }
    next();
  });
  registerMemoryRoutes(app, {
    http: {
      createSseResponse: () => ({ send() {}, end() {} }),
      isLocalSameOrigin: () => true,
      requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
      resolvedPortRef: { current: 0 },
      sendApiError: () => undefined,
      sendLiveArtifactRouteError: () => undefined,
      sendMulterError: () => undefined,
    },
    paths: {
      RUNTIME_DATA_DIR: runtimeDataDir,
      PROJECT_ROOT: runtimeDataDir,
      PROJECTS_DIR: runtimeDataDir,
    },
    appConfig: {
      readAppConfig: async () => ({}),
    },
    nextore: { edition: 'nextore', config },
  } as never);
  return app;
}

async function jsonRequest(
  method: string,
  url: string,
  member: number,
  body?: unknown,
  memoryEnabled = true,
): Promise<{ status: number; body: any }> {
  const response = await fetch(baseUrl + url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-member': String(member),
      'x-test-memory': memoryEnabled ? '1' : '0',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

beforeEach(async () => {
  runtimeDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'od-nextore-memory-'));
  __resetExtractionsForTests();
  await listen(buildApp());
});

afterEach(async () => {
  await closeServer();
  await fsp.rm(runtimeDataDir, { recursive: true, force: true });
});

describe('Nextore memory scope helpers', () => {
  it('places each member under nextore/members/<id>', () => {
    expect(memoryRootFor('/data', 42)).toBe(path.join('/data', 'nextore', 'members', '42'));
    expect(memoryScopeId(memoryRootFor('/data', 42))).toBe('member:42');
    expect(memoryScopeId('/data')).toBe('global');
  });

  it('rejects non-positive member ids instead of writing a shared root', () => {
    expect(() => memoryRootFor('/data', 0)).toThrow('positive integer');
    expect(() => memoryRootFor('/data', 1.5)).toThrow('positive integer');
  });

  it('reads the module MemoryEnabled flag from the session, defaulting on', () => {
    expect(readNextoreMemorySession({
      locals: {
        nextoreSession: {
          memberId: 9,
          member: { features: { memory: false } },
        },
      },
    })).toEqual({ memberId: 9, memoryEnabled: false });

    expect(readNextoreMemorySession({
      locals: { nextoreSession: { memberId: 9, member: {} } },
    })).toEqual({ memberId: 9, memoryEnabled: true });

    expect(readNextoreMemorySession({ locals: {} })).toBeNull();
  });

  it('resolves extraction to the Fast tier with the session token', () => {
    const provider = nextoreFastMemoryProvider(config, 'access-token');
    expect(provider).toMatchObject({
      kind: 'openai',
      apiKey: 'access-token',
      model: 'fast',
      baseUrl: 'https://nextore.test/api/designer/llm/fast/v1',
      credentialSource: 'nextore',
    });
    expect(nextoreFastMemoryProvider(config, '')).toBeNull();
    expect(nextoreFastMemoryProvider(null, 'access-token')).toBeNull();
  });
});

describe('Nextore memory routes', () => {
  it('keeps each member\'s entries and index isolated', async () => {
    const created = await jsonRequest('POST', '/api/memory', 42, {
      name: 'Alpha preference',
      description: 'Only member 42',
      type: 'user',
      body: '- Prefers compact layouts',
    });
    expect(created.status).toBe(200);

    const own = await jsonRequest('GET', '/api/memory', 42);
    expect(own.body.moduleEnabled).toBe(true);
    expect(own.body.entries).toHaveLength(1);
    expect(own.body.entries[0].name).toBe('Alpha preference');

    const other = await jsonRequest('GET', '/api/memory', 43);
    expect(other.body.entries).toHaveLength(0);
    expect(other.body.index).not.toContain('Alpha preference');
  });

  it('returns a disabled surface and rejects writes when MemoryEnabled is off', async () => {
    const listed = await jsonRequest('GET', '/api/memory', 42, undefined, false);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      moduleEnabled: false,
      enabled: false,
      entries: [],
      index: '',
    });

    const write = await jsonRequest('POST', '/api/memory', 42, {
      name: 'Blocked',
      type: 'user',
      body: '- should not land',
    }, false);
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('MEMORY_DISABLED');
  });

  it('removes the connector source from the edition', async () => {
    const response = await jsonRequest('POST', '/api/memory/connectors/suggest', 42, {
      connectorIds: ['notion'],
    });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'feature_disabled', feature: 'connectors' });
  });

  it('keeps extraction history per member', async () => {
    recordHeuristic({
      userMessage: 'remember: alpha',
      writtenCount: 1,
      writtenIds: ['user_alpha'],
      scope: 'member:42',
    });
    recordHeuristic({
      userMessage: 'remember: beta',
      writtenCount: 1,
      writtenIds: ['user_beta'],
      scope: 'member:43',
    });

    expect(listExtractions('member:42').map((row) => row.userMessagePreview))
      .toEqual(['remember: alpha']);
    expect(listExtractions('member:43').map((row) => row.userMessagePreview))
      .toEqual(['remember: beta']);

    const response = await jsonRequest('GET', '/api/memory/extractions', 42);
    expect(response.body.extractions).toHaveLength(1);
    expect(response.body.extractions[0].userMessagePreview).toBe('remember: alpha');
  });
});
