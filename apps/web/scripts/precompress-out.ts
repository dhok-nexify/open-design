#!/usr/bin/env node
/**
 * Generate `.gz` and `.br` siblings for the static export so the daemon can
 * serve precompressed text assets without a runtime compression dependency.
 *
 * Runs as the web package's `postbuild` step, after `next build` writes `out/`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..', 'out');
const EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
  '.xml',
  '.webmanifest',
  '.ttf',
]);
const MIN_BYTES = 1024;
const MAX_BYTES = 20 * 1024 * 1024;

async function collect(dir: string, files: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full, files);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  try {
    await fs.access(ROOT);
  } catch {
    console.log('[precompress] no out/ directory yet; skipping');
    return;
  }

  const files = await collect(ROOT);
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  let written = 0;

  for (const file of files) {
    const buffer = await fs.readFile(file);
    if (buffer.byteLength < MIN_BYTES || buffer.byteLength > MAX_BYTES) continue;
    const gzip = gzipSync(buffer, { level: 9 });
    const brotli = brotliCompressSync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.byteLength,
      },
    });
    await fs.writeFile(file + '.gz', gzip);
    await fs.writeFile(file + '.br', brotli);
    rawBytes += buffer.byteLength;
    gzipBytes += gzip.byteLength;
    brotliBytes += brotli.byteLength;
    written += 1;
  }

  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  console.log(
    '[precompress] ' +
      written +
      ' files: ' +
      mb(rawBytes) +
      ' MB -> ' +
      mb(gzipBytes) +
      ' MB gzip / ' +
      mb(brotliBytes) +
      ' MB brotli',
  );
}

await main();
