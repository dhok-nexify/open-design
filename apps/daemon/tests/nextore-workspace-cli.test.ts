import { execFile } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

let server: http.Server | null = null;
let baseUrl = '';
let requests: CapturedRequest[] = [];

async function startStub(): Promise<void> {
  requests = [];
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: raw });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/nextore/workspaces') {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 91, name: 'Content Team', type: 'team' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/projects') {
        res.statusCode = 201;
        res.end(JSON.stringify({
          project: { id: 'project-1', name: 'Landing' },
          conversationId: 'conversation-1',
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub failed to bind');
  baseUrl = 'http://127.0.0.1:' + address.port;
}

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number | null };
    return {
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
      code: typeof failed.code === 'number' ? failed.code : 1,
    };
  }
}

describe('od nextore CLI', () => {
  it('creates a team workspace with one role per group', async () => {
    await startStub();

    const result = await runCli([
      'nextore', 'workspace', 'create',
      '--name', 'Content Team',
      '--group', '4:manager',
      '--group', '5:reader',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const request = requests.find((item) => item.url === '/api/nextore/workspaces');
    expect(request?.method).toBe('POST');
    expect(JSON.parse(request!.body)).toEqual({
      name: 'Content Team',
      grants: [
        { groupId: 4, role: 'manager' },
        { groupId: 5, role: 'reader' },
      ],
    });
  });

  it('rejects a malformed group role', async () => {
    await startStub();

    const result = await runCli([
      'nextore', 'workspace', 'create',
      '--name', 'Content Team',
      '--group', '4:owner',
      '--daemon-url', baseUrl,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('<id:manager|editor|reader>');
    expect(requests).toHaveLength(0);
  });

  it('documents the team workspace command', async () => {
    const result = await runCli(['nextore', 'help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('od nextore workspace create');
    expect(result.stdout).toContain('--group <id:manager|editor|reader>');
  });
});

describe('od project create --nextore-workspace', () => {
  it('sends the target workspace id', async () => {
    await startStub();

    const result = await runCli([
      'project', 'create',
      '--name', 'Landing',
      '--nextore-workspace', '7',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    const request = requests.find((item) => item.url === '/api/projects');
    expect(JSON.parse(request!.body)).toMatchObject({ nextoreWorkspaceId: 7 });
  });
});
