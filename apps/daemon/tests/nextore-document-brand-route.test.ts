import type http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase } from '../src/db.js';
import { startServer } from '../src/server.js';

const projectId = 'proj-document-brand';

const LEGACY_DOCUMENT = [
  '# Document',
  '',
  '## Goal',
  '',
  '说明希望 OpenDesign 基于这份文档生成、修改或判断什么。',
  '',
  '## How to use this document',
  '',
  '- OpenDesign agent 可以读取、编辑这份文件，并把它作为项目上下文。',
  '',
  '## Next step',
  '',
  '检查并编辑这份文档，然后让 OpenDesign 基于它生成、修改或执行操作。',
  '',
].join('\n');

describe('document files expose the configured product brand', () => {
  let server: http.Server;
  let baseUrl: string;
  let projectDir: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
    const dataDir = process.env.OD_DATA_DIR!;
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId }),
    });
    expect(created.status).toBe(200);
    projectDir = path.join(dataDir, 'projects', projectId);
    await mkdir(projectDir, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    closeDatabase();
  });

  it('rewrites legacy template phrases served from the raw route', async () => {
    await writeFile(path.join(projectDir, 'document.md'), LEGACY_DOCUMENT, 'utf8');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/raw/document.md`);
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain('OpenDesign');
    expect(body.match(/NexTore Designer/g)).toHaveLength(3);
    expect(body).toContain('# Document');
  });

  it('rewrites legacy template phrases served from the text-preview route', async () => {
    await writeFile(path.join(projectDir, 'document-preview.md'), LEGACY_DOCUMENT, 'utf8');

    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/text-preview/document-preview.md`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string };

    expect(body.text).not.toContain('OpenDesign');
    expect(body.text.match(/NexTore Designer/g)).toHaveLength(3);
  });

  it('keeps user prose that mentions the upstream product', async () => {
    const prose = '# Notes\n\nOpenDesign is the upstream project behind this deployment.\n';
    await writeFile(path.join(projectDir, 'notes.md'), prose, 'utf8');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/raw/notes.md`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(prose);
  });
});
