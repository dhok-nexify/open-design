import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SnapshotRenderError,
  renderHtmlToPdf,
  resolveChromiumExecutable,
} from '../src/nextore/artifacts/snapshot-renderer.js';

let dir: string | null = null;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    dir = null;
  }
});

async function htmlFile(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'od-snapshot-src-'));
  const file = join(dir, 'artifact.html');
  await writeFile(file, '<html><body><h1>QA</h1></body></html>', 'utf8');
  return file;
}

describe('snapshot renderer', () => {
  it('renders through the Chromium binary and validates the PDF signature', async () => {
    const source = await htmlFile();
    const seen: { executable: string; args: string[] } = { executable: '', args: [] };
    const result = await renderHtmlToPdf(source, {
      executable: process.execPath,
      run: async (executable, args) => {
        seen.executable = executable;
        seen.args = args;
        const target = args.find((arg) => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
        await writeFile(target, '%PDF-1.7\n%fake\n', 'latin1');
      },
    });

    expect(result.bytes).toBeGreaterThan(0);
    expect(seen.args).toContain('--headless=new');
    expect(seen.args).toContain('--no-pdf-header-footer');
    expect(seen.args.some((arg) => arg.startsWith('file://'))).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    await rm(result.workDir, { recursive: true, force: true });
  });

  it('reports a missing binary instead of spawning', async () => {
    const source = await htmlFile();
    await expect(renderHtmlToPdf(source, { executable: join(source, 'nope') }))
      .rejects.toMatchObject({ code: 'chromium_missing' });
  });

  it('rejects a missing source file', async () => {
    await expect(renderHtmlToPdf('C:/definitely/not/here.html', { executable: process.execPath }))
      .rejects.toMatchObject({ code: 'source_missing' });
  });

  it('reports an empty render and cleans up the temp directory', async () => {
    const source = await htmlFile();
    const error = await renderHtmlToPdf(source, {
      executable: process.execPath,
      run: async () => {},
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SnapshotRenderError);
    expect((error as SnapshotRenderError).code).toBe('render_empty');
  });

  it('wraps a runner failure as render_failed', async () => {
    const source = await htmlFile();
    await expect(renderHtmlToPdf(source, {
      executable: process.execPath,
      run: async () => { throw new Error('boom'); },
    })).rejects.toMatchObject({ code: 'render_failed' });
  });

  it('resolves an explicit existing binary and rejects a missing one', () => {
    expect(resolveChromiumExecutable(process.execPath)).toBe(process.execPath);
    expect(resolveChromiumExecutable('C:/definitely/not/here')).toBeNull();
  });
});
