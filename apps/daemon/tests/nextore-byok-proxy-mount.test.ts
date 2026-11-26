import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

const savedEnv = new Map<string, string | undefined>();
let designerServer: http.Server;
let designerBaseUrl: string;
let shutdown: (() => Promise<void> | void) | undefined;

function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

beforeAll(async () => {
  setEnv('OD_EDITION', 'nextore');
  setEnv('OD_BYOK_PROXY', 'on');
  setEnv('OD_SANDBOX', 'noop');
  setEnv('NEXTORE_BASE_URL', 'http://127.0.0.1:9');
  setEnv('NEXTORE_OAUTH_CLIENT_ID', 'mount-test-client');
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
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('NexTore BYOK proxy mount order', () => {
  // Regression: the proxy was registered after the NexTore session gate, so
  // every model call answered 401 SESSION_REQUIRED and the per-run capability
  // token was never read.
  it('answers an unknown capability before the session gate', async () => {
    const response = await fetch(`${designerBaseUrl}/api/byok/proxy/nope/messages`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'proxy_target_unknown' });
  });

  it('keeps the rest of /api behind the session gate', async () => {
    const response = await fetch(`${designerBaseUrl}/api/projects`);

    expect(response.status).toBe(401);
  });
});
