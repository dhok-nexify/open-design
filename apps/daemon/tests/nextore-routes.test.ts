import { describe, expect, it, vi } from 'vitest';
import type {
  NextoreBrandingResponse,
  NextoreModuleHealthResponse,
  NextoreTier,
  NextoreTierModelsResponse,
} from '@open-design/contracts';
import { NextoreClientError, type NextoreClient } from '../src/nextore/client.js';
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

function modelsFor(...tiers: NextoreTier[]): NextoreTierModelsResponse {
  return {
    object: 'list',
    data: tiers.map((tier) => ({ id: tier, object: 'model', owned_by: 'nextore_designer' })),
  };
}

function selfTestClient(overrides: {
  health?: () => Promise<NextoreModuleHealthResponse>;
  branding?: () => Promise<NextoreBrandingResponse>;
  tierModels?: (token: string, tier: NextoreTier) => Promise<NextoreTierModelsResponse>;
} = {}): NextoreClient {
  return {
    health: overrides.health ?? (async () => ({ moduleVersion: '1.0.0' })),
    branding: overrides.branding ?? (async () => ({
      siteTitle: 'Designer',
      brandName: 'Designer',
      primaryColor: '#4F46E5',
      version: 1,
    })),
    tierModels: (overrides.tierModels
      ?? (async (_token: string, tier: NextoreTier) => modelsFor(tier))) as NextoreClient['tierModels'],
    bootstrap: async <T>() => ({} as T),
    projectAccess: async <T>() => ({} as T),
    projectPermissionUrl: async <T>() => ({} as T),
    workspaces: async <T>() => ({} as T),
    workspaceProjects: async <T>() => ({} as T),
    groups: async <T>() => ({} as T),
    createWorkspace: async <T>() => ({} as T),
    createProject: async <T>() => ({} as T),
    deleteProject: async <T>() => ({} as T),
  };
}

function responseStub(locals: Record<string, unknown> = {}) {
  const headers = new Map<string, string>();
  let body: unknown;
  const response = {
    locals,
    setHeader(name: string, value: string) {
      headers.set(name, value);
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
  };
  return { response, headers, body: () => body };
}

async function runSelfTest(
  client: NextoreClient,
  locals: Record<string, unknown> = {},
): Promise<{ headers: Map<string, string>; body: unknown }> {
  const handler = createNextoreSelfTestHandler(client);
  const stub = responseStub(locals);
  await handler({} as never, stub.response as never, (() => undefined) as never);
  return { headers: stub.headers, body: stub.body() };
}

describe('createNextoreSelfTestHandler', () => {
  it('keeps the anonymous deploy probe green and spends no model calls', async () => {
    const tierModels = vi.fn(async (_token: string, tier: NextoreTier) => modelsFor(tier));
    const { headers, body } = await runSelfTest(selfTestClient({ tierModels }));

    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      ok: true,
      edition: 'nextore',
      checks: {
        module: { status: 'ok' },
        branding: { status: 'ok' },
        authentication: { status: 'pending_session', code: 'session_required' },
        llm: { status: 'pending_session', code: 'session_required' },
      },
    });
    expect(tierModels).not.toHaveBeenCalled();
  });

  it('probes both tiers with the session token once authentication resolved', async () => {
    const tierModels = vi.fn(async (_token: string, tier: NextoreTier) => modelsFor(tier));
    const { body } = await runSelfTest(selfTestClient({ tierModels }), {
      nextoreSession: { accessToken: 'access-1' },
      nextoreSessionLookup: 'ok',
    });

    expect(tierModels.mock.calls).toEqual([
      ['access-1', 'fast'],
      ['access-1', 'expert'],
    ]);
    expect(body).toMatchObject({
      ok: true,
      checks: {
        authentication: { status: 'ok' },
        llm: { status: 'ok', tiers: { fast: { status: 'ok' }, expert: { status: 'ok' } } },
      },
    });
  });

  it('names the unconfigured tier instead of failing the whole model check', async () => {
    const tierModels = vi.fn(async (_token: string, tier: NextoreTier) =>
      tier === 'expert' ? modelsFor() : modelsFor('fast'));
    const { body } = await runSelfTest(selfTestClient({ tierModels }), {
      nextoreSession: { accessToken: 'access-1' },
    });

    expect(body).toMatchObject({
      ok: false,
      checks: {
        authentication: { status: 'ok' },
        llm: {
          status: 'unavailable',
          code: 'tier_not_configured',
          tiers: {
            fast: { status: 'ok' },
            expert: { status: 'unavailable', code: 'tier_not_configured' },
          },
        },
      },
    });
  });

  it('surfaces the upstream DesignerAccess rejection', async () => {
    const tierModels = vi.fn(async () => {
      throw new NextoreClientError('nextore_http_error', 'forbidden', 403, 'designer_access_required');
    });
    const { body } = await runSelfTest(selfTestClient({ tierModels }), {
      nextoreSession: { accessToken: 'access-1' },
    });

    expect(body).toMatchObject({
      ok: false,
      checks: {
        authentication: { status: 'ok' },
        llm: { status: 'unavailable', code: 'designer_access_required', statusCode: 403 },
      },
    });
  });

  it('marks both checks unavailable when NexTore cannot confirm the session', async () => {
    const tierModels = vi.fn(async (_token: string, tier: NextoreTier) => modelsFor(tier));
    const { body } = await runSelfTest(selfTestClient({ tierModels }), {
      nextoreSessionLookup: 'unavailable',
    });

    expect(body).toMatchObject({
      ok: false,
      checks: {
        authentication: { status: 'unavailable', code: 'session_unavailable' },
        llm: { status: 'unavailable', code: 'session_unavailable' },
      },
    });
    expect(tierModels).not.toHaveBeenCalled();
  });

  it('reports module failures and never leaks member identity', async () => {
    const handler = createNextoreSelfTestHandler(selfTestClient({
      health: async () => {
        throw new NextoreClientError('nextore_timeout', 'NexTore request timed out after 8000ms.');
      },
    }));
    const stub = responseStub({
      nextoreSession: {
        accessToken: 'access-1',
        member: { login: 'admin', email: 'admin@example.test' },
      },
      nextoreSessionLookup: 'ok',
    });

    await handler({} as never, stub.response as never, (() => undefined) as never);

    expect(stub.body()).toMatchObject({
      ok: false,
      checks: { module: { status: 'unavailable', code: 'nextore_timeout' } },
    });
    const serialized = JSON.stringify(stub.body());
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('@example.test');
  });
});
