import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NextoreClientError, createNextoreClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';
import type { NextoreArtifactPublishRequest } from '@open-design/contracts';

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'designer-client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempFile(name: string, bytes = '<html></html>'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'p04a-client-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes, 'utf8');
  return path;
}

function metadata(representation: NextoreArtifactPublishRequest['representation']): NextoreArtifactPublishRequest {
  return {
    representation,
    relativePath: 'index.html',
    contentHash: 'hash-1',
    idempotencyKey: 'project-1:artifact-1:source:hash-1',
  };
}

describe('NextoreClient.publishArtifact', () => {
  it('sends metadata and the file as multipart without setting content-type', async () => {
    const path = await tempFile('landing.html');
    const request = metadata('source');
    const result = {
      representation: 'source',
      treeObjectId: 101,
      version: 1,
      versionLabel: '1',
      auditId: 'audit-1',
    };

    const fetchMock = async (input: URL | string, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      expect(url.origin).toBe('http://nextore.test');
      expect(url.pathname).toBe(
        '/api/designer/projects/project-1/artifacts/artifact-1/publish',
      );

      const headers = new Headers(init?.headers);
      expect(headers.get('APIkey')).toBe('token-1');
      expect(headers.get('content-type')).toBeNull();

      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('metadata')).toBe(JSON.stringify(request));
      const filePart = form.get('file');
      expect(filePart).toBeInstanceOf(Blob);
      expect((filePart as Blob).size).toBe(Buffer.byteLength('<html></html>'));
      expect((filePart as Blob).type).toBe('text/html');
      expect((filePart as unknown as { name?: string }).name).toBe('landing.html');

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createNextoreClient({ config, fetch: fetchMock as typeof fetch });
    await expect(client.publishArtifact(
      'token-1',
      'project-1',
      'artifact-1',
      request,
      { path, name: 'landing.html', mimeType: 'text/html' },
    )).resolves.toEqual(result);
  });

  it('does not base64-encode a 50 MB artifact', async () => {
    const path = await tempFile('large.html');
    await truncate(path, 50 * 1024 * 1024);
    const request = metadata('source');
    const fiftyMb = 50 * 1024 * 1024;

    const fetchMock = async (_input: URL | string, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      const rawMetadata = String(form.get('metadata'));
      expect(rawMetadata).not.toContain('contentBase64');
      expect(rawMetadata.length).toBeLessThan(2_048);
      const filePart = form.get('file');
      expect(filePart).toBeInstanceOf(Blob);
      expect((filePart as Blob).size).toBe(fiftyMb);
      return new Response(JSON.stringify({
        representation: 'source',
        treeObjectId: 101,
        version: 1,
        versionLabel: '1',
        auditId: 'audit-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const client = createNextoreClient({ config, fetch: fetchMock as typeof fetch });
    await expect(client.publishArtifact(
      'token-1',
      'project-1',
      'artifact-1',
      request,
      { path, name: 'large.html', mimeType: 'text/html' },
    )).resolves.toMatchObject({ treeObjectId: 101 });
  });

  it('parses a stable artifact error code from a rejected upload', async () => {
    const path = await tempFile('landing.html');
    const fetchMock = async () => new Response(JSON.stringify({
      error: { code: 'name_conflict_race', message: 'The name was taken concurrently.' },
    }), { status: 409, headers: { 'content-type': 'application/json' } });

    const client = createNextoreClient({ config, fetch: fetchMock as typeof fetch });
    const error = await client.publishArtifact(
      'token-1',
      'project-1',
      'artifact-1',
      metadata('snapshot'),
      { path, name: 'landing.html', mimeType: 'text/html' },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NextoreClientError);
    expect(error).toMatchObject({
      code: 'nextore_http_error',
      statusCode: 409,
      upstreamCode: 'name_conflict_race',
    });
    expect(String(error)).toContain('taken concurrently');
  });
});
