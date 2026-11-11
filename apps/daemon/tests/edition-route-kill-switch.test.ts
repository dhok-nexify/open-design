import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditionRouteKillSwitch,
  disabledFeatureForPath,
} from '../src/edition/route-kill-switch.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function listen(app: express.Express): Promise<string> {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
  return `http://127.0.0.1:${address.port}`;
}

describe('disabledFeatureForPath', () => {
  it('matches complete path segments only', () => {
    // The list endpoint is the UI's availability probe; only management
    // subroutes stay closed in the edition.
    expect(disabledFeatureForPath('/api/agents')).toBeNull();
    expect(disabledFeatureForPath('/api/agents/status')).toBe('agent-picker');
    expect(disabledFeatureForPath('/api/agents-archive')).toBeNull();
  });

  it('matches parameterized project routes without blocking unrelated projects APIs', () => {
    expect(disabledFeatureForPath('/api/projects/project-1/deploy')).toBe('deploy');
    expect(disabledFeatureForPath('/api/projects/project-1/terminals/main')).toBe('terminals');
    expect(disabledFeatureForPath('/api/projects/project-1/media/generate')).toBe('media-generation');
    expect(disabledFeatureForPath('/api/projects/project-1/files')).toBeNull();
  });

  it('closes the media settings surface while generation stays internal', () => {
    expect(disabledFeatureForPath('/api/media/config')).toBe('media-providers');
    expect(disabledFeatureForPath('/api/media/models')).toBe('media-providers');
    expect(disabledFeatureForPath('/api/media/providers')).toBe('media-providers');
  });
  it('leaves process health endpoints available', () => {
    expect(disabledFeatureForPath('/api/health')).toBeNull();
    expect(disabledFeatureForPath('/api/version')).toBeNull();
  });
});

describe('createEditionRouteKillSwitch', () => {
  it('returns the stable disabled-feature response in the NexTore edition', async () => {
    const app = express();
    app.use(createEditionRouteKillSwitch('nextore'));
    app.get('/api/connectors', (_req, res) => res.json({ reached: true }));
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'feature_disabled',
      feature: 'connectors',
    });
  });

  it('does not change upstream routing', async () => {
    const app = express();
    app.use(createEditionRouteKillSwitch('upstream'));
    app.get('/api/connectors', (_req, res) => res.json({ reached: true }));
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reached: true });
  });
});
