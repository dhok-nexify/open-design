import { describe, expect, it } from 'vitest';
import type { NextoreClient } from '../src/nextore/client.js';
import {
  createNextoreSelfTestHandler,
  nextoreHealthMetadata,
} from '../src/nextore/routes.js';

describe('nextoreHealthMetadata', () => {
  it('adds edition and module compatibility to the Designer health response', () => {
    expect(nextoreHealthMetadata('nextore', '1.2.3')).toEqual({
      edition: 'nextore',
      compat: { module: '>=1.0 <2' },
      version: '1.2.3',
    });
  });

  it('keeps upstream health unchanged', () => {
    expect(nextoreHealthMetadata('upstream', '1.2.3')).toEqual({});
  });
});

describe('createNextoreSelfTestHandler', () => {
  it('reports module and branding reachability without claiming auth or model checks', async () => {
    const client: NextoreClient = {
      health: async () => ({ moduleVersion: '1.0.0' }),
      branding: async () => ({
        siteTitle: 'Designer',
        brandName: 'Designer',
        primaryColor: '#4F46E5',
        version: 1,
      }),
      bootstrap: async <T>() => ({} as T),
      projectAccess: async <T>() => ({} as T),
      projectPermissionUrl: async <T>() => ({} as T),
      workspaces: async <T>() => ({} as T),
      workspaceProjects: async <T>() => ({} as T),
      createProject: async <T>() => ({} as T),
      deleteProject: async <T>() => ({} as T),
    };
    const handler = createNextoreSelfTestHandler(client);
    const headers = new Map<string, string>();
    let body: unknown;
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    };

    await handler({} as never, response as never, (() => undefined) as never);

    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      ok: true,
      edition: 'nextore',
      checks: {
        module: { status: 'ok' },
        branding: { status: 'ok' },
        authentication: { status: 'pending_session' },
        llm: { status: 'pending_session' },
      },
    });
  });
});
