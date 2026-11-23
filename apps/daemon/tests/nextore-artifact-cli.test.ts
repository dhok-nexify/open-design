import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
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
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: raw });
      const url = req.url ?? '';
      if (req.method === 'GET' && url === '/api/nextore/projects/p1/artifacts/a1/status') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ representations: [{ representation: 'source', artifact: { status: 'published', currentVersion: 3 } }] }));
        return;
      }
      if (url === '/api/nextore/projects/p1/share') {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') {
          res.end(JSON.stringify({ shared: true, url: 'https://share.test/PublicShare?key=abc' }));
          return;
        }
        if (req.method === 'POST') {
          res.end(JSON.stringify({ url: 'https://share.test/PublicShare?key=new' }));
          return;
        }
        if (req.method === 'DELETE') {
          res.end(JSON.stringify({ revoked: true }));
          return;
        }
      }
      if (req.method === 'GET' && url.startsWith('/api/nextore/projects/p1/artifacts/a1/download')) {
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-length', '9');
        res.end('html-body');
        return;
      }
      if (req.method === 'POST' && url === '/api/nextore/projects/p1/artifacts/a1/retry') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ representation: 'source', retried: true }));
        return;
      }
      if (req.method === 'POST' && url === '/api/nextore/projects/p1/artifacts/a1/share') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ url: 'https://share.test/s/xyz' }));
        return;
      }
      if (url === '/api/nextore/artifacts/backfill') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(req.method === 'GET'
          ? { paused: false, total: 3, done: 1, pending: 2 }
          : { action: 'start', ran: 2, done: 2, progress: { total: 3, done: 3, pending: 0 } }));
        return;
      }
      if (req.method === 'DELETE' && url === '/api/nextore/projects/p1/artifacts/a1/share') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ revoked: true }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
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
      timeout: 20_000,
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

describe('od nextore artifact CLI', () => {
  it('prints the artifact status as JSON', async () => {
    await startStub();

    const result = await runCli([
      'nextore', 'artifact', 'status', 'p1', 'a1',
      '--daemon-url', baseUrl, '--json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      representations: [{ representation: 'source', artifact: { status: 'published', currentVersion: 3 } }],
    });
  });

  it('downloads a representation to --out', async () => {
    await startStub();
    const dir = await mkdtemp(join(tmpdir(), 'od-nextore-dl-'));
    const out = join(dir, 'artifact.html');
    try {
      const result = await runCli([
        'nextore', 'artifact', 'download', 'p1', 'a1',
        '--out', out,
        '--representation', 'snapshot',
        '--version', '2',
        '--daemon-url', baseUrl,
      ]);

      expect(result.code).toBe(0);
      expect(await readFile(out, 'utf8')).toBe('html-body');
      const request = requests.find((item) => item.url.includes('/download'));
      expect(request?.url).toBe(
        '/api/nextore/projects/p1/artifacts/a1/download?representation=snapshot&version=2',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates a share link and prints the URL', async () => {
    await startStub();

    const result = await runCli([
      'nextore', 'artifact', 'share', 'p1', 'a1',
      '--expires-at', '2026-12-01T00:00:00Z',
      '--daemon-url', baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('https://share.test/s/xyz');
    const request = requests.find((item) => item.method === 'POST' && item.url.endsWith('/share'));
    expect(JSON.parse(request!.body)).toEqual({
      representation: 'snapshot',
      previewOnly: true,
      expiresAt: '2026-12-01T00:00:00Z',
    });
  });

  it('reports and starts the backfill from the CLI', async () => {
    await startStub();

    const status = await runCli([
      'nextore', 'backfill', 'status',
      '--daemon-url', baseUrl, '--json',
    ]);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ paused: false, total: 3, pending: 2 });

    const started = await runCli([
      'nextore', 'backfill', 'start',
      '--batch-size', '2',
      '--daemon-url', baseUrl, '--json',
    ]);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ ran: 2, done: 2 });
    const request = requests.find((item) => item.method === 'POST' && item.url.endsWith('/backfill'));
    expect(JSON.parse(request!.body)).toEqual({ action: 'start', batchSize: 2 });
  });

  it('re-queues a representation for retry', async () => {
    await startStub();

    const result = await runCli([
      'nextore', 'artifact', 'retry', 'p1', 'a1',
      '--daemon-url', baseUrl, '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ representation: 'source', retried: true });
    const request = requests.find((item) => item.url.endsWith('/retry'));
    expect(request?.method).toBe('POST');
  });

  it('manages the project folder link', async () => {
    await startStub();

    const status = await runCli(['nextore', 'project', 'status', 'p1', '--daemon-url', baseUrl, '--json']);
    expect(status.code, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ shared: true });

    const share = await runCli(['nextore', 'project', 'share', 'p1', '--daemon-url', baseUrl, '--json']);
    expect(share.code).toBe(0);
    expect(JSON.parse(share.stdout)).toMatchObject({ url: 'https://share.test/PublicShare?key=new' });

    const unshare = await runCli(['nextore', 'project', 'unshare', 'p1', '--daemon-url', baseUrl, '--json']);
    expect(unshare.code).toBe(0);
    expect(JSON.parse(unshare.stdout)).toMatchObject({ revoked: true });

    expect(requests.map((request) => request.method + ' ' + request.url)).toEqual([
      'GET /api/nextore/projects/p1/share',
      'POST /api/nextore/projects/p1/share',
      'DELETE /api/nextore/projects/p1/share',
    ]);
  });
});
