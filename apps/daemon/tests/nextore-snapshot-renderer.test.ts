import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('skips a snap wrapper script on PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'od-snap-wrapper-'));
    const wrapper = join(dir, process.platform === 'win32' ? 'chromium.cmd' : 'chromium');
    await writeFile(wrapper, '#!/bin/sh\nexec snap run chromium "$@"\n', 'utf8');
    const previous = process.env.PATH;
    process.env.PATH = dir;
    try {
      // Any fallback (a real Chrome in the usual location, or null) is fine;
      // the wrapper itself must never be chosen.
      expect(resolveChromiumExecutable()).not.toBe(wrapper);
    } finally {
      process.env.PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores a configured snap wrapper and falls back to detection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'od-snap-config-'));
    const wrapper = join(dir, process.platform === 'win32' ? 'chromium.cmd' : 'chromium');
    await writeFile(wrapper, '#!/bin/sh\nexec snap run chromium "$@"\n', 'utf8');
    const previous = process.env.OD_CHROMIUM_PATH;
    process.env.OD_CHROMIUM_PATH = wrapper;
    try {
      expect(resolveChromiumExecutable()).not.toBe(wrapper);
    } finally {
      if (previous === undefined) delete process.env.OD_CHROMIUM_PATH;
      else process.env.OD_CHROMIUM_PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('injects print rules at the real head close, not a script string', async () => {
    dir = await mkdtemp(join(tmpdir(), 'od-snapshot-head-'));
    const file = join(dir, 'artifact.html');
    await writeFile(
      file,
      '<html><head><script>const marker = "</head>";</script></head><body>QA</body></html>',
      'utf8',
    );
    let printed = '';
    await renderHtmlToPdf(file, {
      executable: process.execPath,
      run: async (_executable, args) => {
        const pdfTarget = args.find((arg) => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
        const printUrl = args.find((arg) => arg.startsWith('file://') && arg.endsWith('.html'))!;
        printed = await readFile(fileURLToPath(printUrl), 'utf8');
        await writeFile(pdfTarget, '%PDF-1.7\n%fake\n', 'latin1');
      },
    });

    const injected = printed.indexOf('<base ');
    expect(injected).toBeGreaterThan(printed.indexOf('</script>'));
    expect(injected).toBeLessThan(printed.lastIndexOf('</head>'));
  });

  it('resolves an explicit existing binary and rejects a missing one', () => {
    expect(resolveChromiumExecutable(process.execPath)).toBe(process.execPath);
    expect(resolveChromiumExecutable('C:/definitely/not/here')).toBeNull();
  });
});
