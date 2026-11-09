import http from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveNextoreSecrets } from '../src/nextore/auth/secrets.js';
import {
  ensureNextoreMcpSchema,
  listNextoreMcpServers,
  replaceNextoreMcpServers,
} from '../src/nextore/mcp/store.js';
import { registerNextoreMcpRoutes } from '../src/nextore/mcp/routes.js';
import { buildOpenCodeMcpConfigContent } from '../src/mcp-config.js';

const secrets = deriveNextoreSecrets('d21-test-secret-'.padEnd(40, 'x'));

let db: Database.Database;
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
          features: { mcp: req.header('x-test-mcp') !== '0' },
          rights: { manageMcp: req.header('x-test-manage-mcp') !== '0' },
        },
      };
    }
    next();
  });
  registerNextoreMcpRoutes(app, { db, secrets: () => secrets });
  return app;
}

async function request(
  method: string,
  url: string,
  member: number,
  options: {
    body?: unknown;
    mcpEnabled?: boolean;
    manageMcp?: boolean;
  } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(baseUrl + url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-member': String(member),
      'x-test-mcp': options.mcpEnabled === false ? '0' : '1',
      'x-test-manage-mcp': options.manageMcp === false ? '0' : '1',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  db = new Database(':memory:');
  ensureNextoreMcpSchema(db);
  await listen(buildApp());
});

afterEach(async () => {
  await closeServer();
  db.close();
});

describe('Nextore per-user MCP store', () => {
  it('keeps only http/sse and encrypts headers at rest', () => {
    const saved = replaceNextoreMcpServers(db, secrets, 42, [
      {
        id: 'remote-http',
        label: 'Remote HTTP',
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer secret-token' },
      },
      {
        id: 'remote-sse',
        transport: 'sse',
        url: 'https://mcp.example.test/sse',
      },
      {
        id: 'evil-stdio',
        transport: 'stdio',
        command: 'sh',
        args: ['-c', 'id'],
      },
      {
        id: 'file-url',
        transport: 'http',
        url: 'file:///etc/passwd',
      },
    ]);

    expect(saved.map((entry) => entry.id)).toEqual(['remote-http', 'remote-sse']);
    expect(saved.every((entry) => entry.transport === 'http' || entry.transport === 'sse')).toBe(true);
    expect(saved[0]?.headers).toEqual({ Authorization: 'Bearer secret-token' });
    expect(saved.every((entry) => entry.authMode === 'none')).toBe(true);

    const row = db
      .prepare('SELECT headers_enc FROM nextore_mcp_servers WHERE member_id = ? AND name = ?')
      .get(42, 'remote-http') as { headers_enc: Buffer | null };
    expect(row.headers_enc).toBeTruthy();
    expect(row.headers_enc!.toString('utf8')).not.toContain('secret-token');
  });

  it('isolates one member\'s servers from another', () => {
    replaceNextoreMcpServers(db, secrets, 42, [
      { id: 'alpha', transport: 'http', url: 'https://alpha.test/mcp' },
    ]);
    replaceNextoreMcpServers(db, secrets, 43, [
      { id: 'beta', transport: 'sse', url: 'https://beta.test/sse' },
    ]);

    expect(listNextoreMcpServers(db, secrets, 42).map((s) => s.id)).toEqual(['alpha']);
    expect(listNextoreMcpServers(db, secrets, 43).map((s) => s.id)).toEqual(['beta']);
  });

  it('injects the member servers into OpenCode as remote entries', () => {
    replaceNextoreMcpServers(db, secrets, 42, [
      {
        id: 'design-tools',
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer member-token' },
      },
    ]);
    const previousEdition = process.env.OD_EDITION;
    process.env.OD_EDITION = 'nextore';
    try {
      const content = buildOpenCodeMcpConfigContent(
        listNextoreMcpServers(db, secrets, 42),
        {},
        {},
      );
      expect(content).toBeTruthy();
      const parsed = JSON.parse(content!) as {
        mcp: Record<string, { type: string; url: string; headers?: Record<string, string> }>;
      };
      expect(parsed.mcp['design-tools']).toMatchObject({
        type: 'remote',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer member-token' },
      });
      expect(parsed.mcp['design-tools']).not.toHaveProperty('command');
    } finally {
      if (previousEdition === undefined) delete process.env.OD_EDITION;
      else process.env.OD_EDITION = previousEdition;
    }
  });
});

describe('Nextore MCP routes', () => {
  it('reports access from the module switch and the DesignerManageMcp right', async () => {
    const allowed = await request('GET', '/api/nextore/mcp/access', 42);
    expect(allowed.body).toEqual({ enabled: true, allowed: true });

    const noRight = await request('GET', '/api/nextore/mcp/access', 42, {
      manageMcp: false,
    });
    expect(noRight.body).toEqual({ enabled: true, allowed: false });

    const disabled = await request('GET', '/api/nextore/mcp/access', 42, {
      mcpEnabled: false,
    });
    expect(disabled.body).toEqual({ enabled: false, allowed: false });
  });

  it('refuses the server list without the right and accepts only remote rows', async () => {
    const forbidden = await request('GET', '/api/nextore/mcp/servers', 42, {
      manageMcp: false,
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('MCP_FORBIDDEN');

    const saved = await request('PUT', '/api/nextore/mcp/servers', 42, {
      body: {
        servers: [
          {
            id: 'remote',
            transport: 'http',
            url: 'https://mcp.example.test/mcp',
          },
          {
            id: 'stdio',
            transport: 'stdio',
            command: 'sh',
          },
        ],
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.servers.map((entry: { id: string }) => entry.id)).toEqual(['remote']);
    expect(saved.body.templates.every((tpl: { transport: string }) => tpl.transport !== 'stdio')).toBe(true);

    const otherMember = await request('GET', '/api/nextore/mcp/servers', 43);
    expect(otherMember.body.servers).toEqual([]);
  });
});
