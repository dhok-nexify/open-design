#!/usr/bin/env -S pnpm exec tsx
/**
 * Materialize the baked plugin-preview clips next to their manifest.
 *
 * Why this exists
 * ---------------
 * `data/plugin-previews/manifest.json` is committed; the clips it names are
 * published to the public asset host by the bake workflow and are deliberately
 * NOT committed (see specs/change/20260618-plugin-preview-bake-pipeline).
 *
 * The Nextore edition refuses to call that public host at runtime, and the
 * daemon only resolves a baked preview when BOTH the video and the poster exist
 * on disk (apps/daemon/src/plugins/plugin-preview-bakes.ts). A Nextore package
 * built from a clean checkout therefore ships a manifest that resolves to
 * nothing, and every preview silently degrades.
 *
 * This script closes that gap at BUILD time: it downloads the clips the manifest
 * names into the manifest's own directory, where the packaging steps already
 * copy them from (tools/pack resource trees, deploy/nextore Dockerfile + tarball).
 * The runtime stays offline; only the build host reaches the asset host, and
 * `--base` points that at an internal mirror for air-gapped builds.
 *
 * Usage
 * -----
 *   pnpm exec tsx scripts/fetch-plugin-previews.ts                 # download what is missing
 *   pnpm exec tsx scripts/fetch-plugin-previews.ts --check         # verify only (build gate)
 *   pnpm exec tsx scripts/fetch-plugin-previews.ts --base https://mirror.example/plugin-previews
 *   pnpm exec tsx scripts/fetch-plugin-previews.ts --only example-pm-spec --limit 5
 *
 * Exit codes: 0 complete, 1 incomplete or download failure, 2 usage/manifest error.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = 'https://repo-assets.open-design.ai/plugin-previews';
const DEFAULT_OUT = 'data/plugin-previews';
const MANIFEST_NAME = 'manifest.json';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_ATTEMPTS = 3;

export type PreviewFile = { id: string; key: string; kind: 'video' | 'poster' };

/**
 * Flatten the manifest into the files it names, and report malformed entries
 * instead of silently skipping them: a gate that ignores an entry is worse than
 * no gate, because the package then ships one plugin's empty box and passes.
 */
export function previewFiles(manifest: unknown): { files: PreviewFile[]; problems: string[] } {
  const files: PreviewFile[] = [];
  const problems: string[] = [];
  const previews = (manifest as { previews?: unknown } | null)?.previews;
  if (!previews || typeof previews !== 'object') {
    return { files, problems: ['manifest has no "previews" object'] };
  }
  for (const [id, raw] of Object.entries(previews as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') {
      problems.push(`${id}: entry is not an object`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    for (const kind of ['video', 'poster'] as const) {
      const key = entry[kind];
      if (typeof key !== 'string' || key.length === 0) {
        problems.push(`${id}: missing "${kind}"`);
        continue;
      }
      files.push({ id, key, kind });
    }
  }
  return { files, problems };
}

/** Reject absolute, traversal or backslash keys so a manifest cannot escape the output dir. */
export function isSafeKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('\0')) return false;
  return key.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Files that are absent (or empty) on disk. Sizes cannot be known without the network. */
export async function findMissing(
  files: PreviewFile[],
  outDir: string,
  sizeOf: (path: string) => Promise<number | null> = async (path) => {
    try {
      return (await stat(path)).size;
    } catch {
      return null;
    }
  },
): Promise<PreviewFile[]> {
  const missing: PreviewFile[] = [];
  for (const file of files) {
    const size = await sizeOf(join(outDir, file.key));
    if (size === null || size === 0) missing.push(file);
  }
  return missing;
}

async function download(url: string, target: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(declared) && declared > 0 && bytes.byteLength !== declared) {
    throw new Error(`size mismatch: got ${bytes.byteLength}, expected ${declared}`);
  }
  if (bytes.byteLength === 0) throw new Error('empty response');
  await mkdir(dirname(target), { recursive: true });
  // Stage then rename, so an interrupted run never leaves a truncated clip that
  // the next `--check` would accept as present.
  const staged = `${target}.part`;
  await writeFile(staged, bytes);
  await rename(staged, target);
  return bytes.byteLength;
}

async function downloadWithRetry(url: string, target: string): Promise<number> {
  let last: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await download(url, target);
    } catch (error) {
      last = error;
      await rm(`${target}.part`, { force: true });
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise((done) => setTimeout(done, attempt * 500));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function takeFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function takeFlags(argv: string[], name: string): string[] {
  const values: string[] = [];
  argv.forEach((value, index) => {
    if (value === `--${name}` && argv[index + 1]) values.push(argv[index + 1]!);
  });
  return values;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function main(argv: string[]): Promise<number> {
  const checkOnly = argv.includes('--check');
  const force = argv.includes('--force');
  const outDir = resolve(takeFlag(argv, 'out') ?? DEFAULT_OUT);
  const base = (takeFlag(argv, 'base') ?? process.env.OD_PLUGIN_PREVIEWS_BASE_URL ?? DEFAULT_BASE)
    .replace(/\/+$/, '');
  const concurrency = Math.max(1, Number(takeFlag(argv, 'concurrency') ?? 6) || 6);
  const limit = Number(takeFlag(argv, 'limit') ?? 0) || 0;
  const only = new Set(takeFlags(argv, 'only'));

  const manifestPath = join(outDir, MANIFEST_NAME);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`[previews] cannot read ${manifestPath}: ${(error as Error).message}`);
    return 2;
  }

  const parsed = previewFiles(manifest);
  if (parsed.problems.length > 0) {
    console.error('[previews] manifest is malformed:');
    for (const problem of parsed.problems.slice(0, 20)) console.error(`  - ${problem}`);
    if (parsed.problems.length > 20) console.error(`  ... and ${parsed.problems.length - 20} more`);
    return 2;
  }

  const unsafe = parsed.files.filter((file) => !isSafeKey(file.key));
  if (unsafe.length > 0) {
    console.error('[previews] manifest names unsafe paths:');
    for (const file of unsafe.slice(0, 10)) console.error(`  - ${file.id}: ${file.key}`);
    return 2;
  }

  let files = parsed.files;
  if (only.size > 0) files = files.filter((file) => only.has(file.id));
  if (limit > 0) {
    const keep = new Set([...new Set(files.map((file) => file.id))].slice(0, limit));
    files = files.filter((file) => keep.has(file.id));
  }

  const missing = force ? files : await findMissing(files, outDir);
  const entries = new Set(files.map((file) => file.id)).size;

  if (checkOnly) {
    if (missing.length === 0) {
      console.log(`[previews] ok: ${entries} entries, ${files.length} files present under ${outDir}`);
      return 0;
    }
    const ids = [...new Set(missing.map((file) => file.id))];
    console.error(`[previews] incomplete: ${missing.length} files missing for ${ids.length} of ${entries} entries.`);
    console.error(`[previews]   out: ${outDir}`);
    for (const id of ids.slice(0, 10)) console.error(`  - ${id}`);
    if (ids.length > 10) console.error(`  ... and ${ids.length - 10} more`);
    console.error('[previews] run: pnpm exec tsx scripts/fetch-plugin-previews.ts');
    return 1;
  }

  if (missing.length === 0) {
    console.log(`[previews] nothing to do: ${entries} entries, ${files.length} files already present`);
    return 0;
  }

  console.log(`[previews] fetching ${missing.length} files for ${entries} entries from ${base}`);
  let done = 0;
  let bytes = 0;
  const failures: { file: PreviewFile; error: string }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const file = missing[index];
      if (!file) return;
      try {
        const written = await downloadWithRetry(`${base}/${file.key}`, join(outDir, file.key));
        // Add AFTER the await: reading the counter before it lets two concurrent
        // workers write back the same pre-download value and undercount.
        bytes += written;
      } catch (error) {
        failures.push({ file, error: (error as Error).message });
      }
      done += 1;
      if (done % 25 === 0 || done === missing.length) {
        console.log(`[previews] ${done}/${missing.length} (${formatBytes(bytes)})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()));

  if (failures.length > 0) {
    console.error(`[previews] ${failures.length} downloads failed:`);
    for (const failure of failures.slice(0, 10)) {
      console.error(`  - ${failure.file.id} (${failure.file.kind}): ${failure.error}`);
    }
    return 1;
  }

  const stillMissing = await findMissing(files, outDir);
  if (stillMissing.length > 0) {
    console.error(`[previews] ${stillMissing.length} files still missing after download`);
    return 1;
  }
  console.log(`[previews] done: ${missing.length} files, ${formatBytes(bytes)}; ${entries} entries complete`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
