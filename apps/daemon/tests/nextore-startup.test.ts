import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

const savedEnv = new Map<string, string | undefined>();
let nextoreServer: http.Server;
let designerServer: http.Server;
let designerBaseUrl: string;
let shutdown: (() => Promise<void> | void) | undefined;

function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  nextoreServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/designer/health') {
      res.end(JSON.stringify({ moduleVersion: '1.0.0', compat: { designer: '>=1.0 <2' } }));
      return;
    }
    if (req.url === '/api/designer/branding') {
      res.end(JSON.stringify({
        siteTitle: 'NexTore Designer',
        brandName: 'NexTore Designer',
        primaryColor: '#4F46E5',
        version: 1,
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const nextoreBaseUrl = await listen(nextoreServer);
  setEnv('OD_EDITION', 'nextore');
  setEnv('NEXTORE_BASE_URL', nextoreBaseUrl);
  setEnv('NEXTORE_OAUTH_CLIENT_ID', 'designer-client');
  setEnv('DESIGNER_BASE_URL', 'https://designer.example.com');
  setEnv('DESIGNER_SECRET_FILE', '/run/secrets/designer-test');

  const started = await startServer({ port: 0, returnServer: true }) as {
    url: string;
    server: http.Server;
    shutdown: () => Promise<void> | void;
  };
  designerServer = started.server;
  designerBaseUrl = started.url;
  shutdown = started.shutdown;
}, 60_000);

afterAll(async () => {
  await Promise.resolve(shutdown?.());
  if (designerServer) await new Promise<void>((resolve) => designerServer.close(() => resolve()));
  if (nextoreServer) await new Promise<void>((resolve) => nextoreServer.close(() => resolve()));
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('NexTore edition startup', () => {
  it('reports Designer health metadata for module version negotiation', async () => {
    const response = await fetch(`${designerBaseUrl}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      edition: 'nextore',
      compat: { module: '>=1.0 <2' },
    });
  });

  it('checks module health and branding through the configured NexTore origin', async () => {
    const response = await fetch(`${designerBaseUrl}/api/nextore/self-test`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
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
