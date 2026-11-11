import { describe, expect, it, vi } from 'vitest';
import { NextoreClientError, createNextoreClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'designer-client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
};

describe('createNextoreClient', () => {
  it('calls only the configured origin and sends the APIkey header for authenticated reads', async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const requestUrl = input instanceof URL ? input : new URL(String(input));
      expect(requestUrl.origin).toBe('http://nextore.test');
      expect(requestUrl.pathname).toBe('/api/designer/bootstrap');
      expect(new Headers(init?.headers).get('APIkey')).toBe('access-token');
      return new Response(JSON.stringify({ member: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createNextoreClient({ config, fetch: fetchMock as typeof fetch });

    await expect(client.bootstrap('access-token')).resolves.toEqual({ member: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps upstream HTTP failures without exposing the request token', async () => {
    const fetchMock = async () => new Response(
      JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }),
      { status: 401 },
    );
    const client = createNextoreClient({ config, fetch: fetchMock });

    const error = await client.bootstrap('secret-token').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NextoreClientError);
    expect(error).toMatchObject({
      code: 'nextore_http_error',
      statusCode: 401,
      upstreamCode: 'TOKEN_EXPIRED',
    });
    expect(String(error)).not.toContain('secret-token');
  });

  it('keeps the message the module attached to a rejected call', async () => {
    const fetchMock = async () => new Response(
      JSON.stringify({
        error: 'project_name_conflict',
        message: 'A project named "Landing page" already exists in this workspace.',
      }),
      { status: 409 },
    );
    const client = createNextoreClient({ config, fetch: fetchMock });

    const error = await client
      .createProject('token', {
        workspaceId: 1,
        name: 'Landing page',
        designerProjectId: 'local-1',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NextoreClientError);
    expect(error).toMatchObject({
      code: 'nextore_http_error',
      statusCode: 409,
      upstreamCode: 'project_name_conflict',
    });
    expect(String(error)).toContain('already exists');
  });

  it('maps malformed JSON to a stable client error', async () => {
    const client = createNextoreClient({
      config,
      fetch: async () => new Response('<html>bad</html>', { status: 200 }),
    });

    await expect(client.health()).rejects.toMatchObject({
      code: 'nextore_response_invalid',
    });
  });
});
