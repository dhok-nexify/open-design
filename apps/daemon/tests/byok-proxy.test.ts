import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createByokProxyRegistry } from '../src/byok/proxy-registry.js';
import { registerByokProxyRoutes } from '../src/byok/proxy-routes.js';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

describe('byok proxy (P01 path A)', () => {
  it('issues unique, expiring capabilities', () => {
    let now = 1_000;
    const registry = createByokProxyRegistry({ now: () => now });
    const first = registry.issue({ baseUrl: 'https://api.example.com/v1', ttlMs: 50 });
    const second = registry.issue({ baseUrl: 'https://api.example.com/v1' });

    expect(first).not.toBe(second);
    expect(registry.resolve(first)?.baseUrl).toBe('https://api.example.com/v1');
    now += 51;
    expect(registry.resolve(first)).toBeNull();
    expect(registry.resolve('not-a-token')).toBeNull();
    expect(registry.size()).toBe(1);
  });

  it('forwards the path, query and body to the issued upstream only', async () => {
    const upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: req.url, method: req.method, body }));
      });
    });
    const upstreamPort = await listen(upstream);

    const registry = createByokProxyRegistry();
    const app = express();
    registerByokProxyRoutes(app, { registry });
    const proxyPort = await listen(createServer(app));

    const token = registry.issue({ baseUrl: 'http://127.0.0.1:' + upstreamPort + '/v1' });
    const response = await fetch(
      'http://127.0.0.1:' + proxyPort + '/api/byok/proxy/' + token + '/messages?beta=1',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"hello":"world"}' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: '/v1/messages?beta=1',
      method: 'POST',
      body: '{"hello":"world"}',
    });
  });

  it('keeps the issued base query and merges the request query', async () => {
    const upstream = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url }));
    });
    const upstreamPort = await listen(upstream);

    const registry = createByokProxyRegistry();
    const app = express();
    registerByokProxyRoutes(app, { registry });
    const proxyPort = await listen(createServer(app));

    const token = registry.issue({
      baseUrl: 'http://127.0.0.1:' + upstreamPort + '/openai/v1?api-version=2024-10-21',
    });
    const response = await fetch(
      'http://127.0.0.1:' + proxyPort + '/api/byok/proxy/' + token + '/deployments/one?stream=true',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: '/openai/v1/deployments/one?api-version=2024-10-21&stream=true',
    });
  });

  it('refuses an unknown capability', async () => {
    const registry = createByokProxyRegistry();
    const app = express();
    registerByokProxyRoutes(app, { registry });
    const proxyPort = await listen(createServer(app));

    const response = await fetch('http://127.0.0.1:' + proxyPort + '/api/byok/proxy/nope/messages');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'proxy_target_unknown' });
  });
});
