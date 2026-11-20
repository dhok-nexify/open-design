import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

/**
 * Headless HTML → PDF for the artifact snapshot representation (P04-S).
 *
 * The daemon has no renderer of its own: `/export/pdf-image` funnels into the
 * desktop Electron renderer and answers 501 in a bare daemon, and the platform
 * converter returns an empty stream for HTML (measured 2026-11-20). Chromium's
 * own `--print-to-pdf` is the same engine the desktop path uses, is BSD-3
 * licensed, and needs no npm dependency - only a Chromium binary on the host.
 */

export type SnapshotRenderErrorCode =
  | 'chromium_missing'
  | 'source_missing'
  | 'render_timeout'
  | 'render_failed'
  | 'render_empty';

export class SnapshotRenderError extends Error {
  constructor(readonly code: SnapshotRenderErrorCode, message: string) {
    super(message);
    this.name = 'SnapshotRenderError';
  }
}

export interface ChromiumRenderOptions {
  /** Explicit binary; otherwise OD_CHROMIUM_PATH, then a PATH/common-location lookup. */
  executable?: string | null;
  timeoutMs?: number;
  /** Print page size in CSS pixels; defaults to 1200 x 1600 (desktop width). */
  pageWidth?: number;
  pageHeight?: number;
  /** Containers without a user namespace need this; off unless asked for. */
  noSandbox?: boolean;
  log?: (message: string) => void;
  /** Test seam: replaces the child process with a stub. */
  run?: (executable: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<void>;
}

export interface RenderedPdf {
  path: string;
  bytes: number;
  /** Temp directory that owns `path`; the caller removes it when done. */
  workDir: string;
}

/** Names tried on PATH and in the usual install locations, in order. */
const BINARY_NAMES = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome',
  'msedge',
];

/** Paths tried on Linux when nothing usable is on PATH (snap builds excluded). */
const LINUX_LOCATIONS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/**
 * The Ubuntu snap build cannot start under systemd ("cannot create
 * XDG_RUNTIME_DIR folder /run/user/<uid>/snap.chromium"), so it is never
 * chosen automatically - only through OD_CHROMIUM_PATH when an operator
 * insists.
 */
function isSnapBinary(candidate: string): boolean {
  try {
    if (realpathSync(candidate).startsWith('/snap/')) return true;
    // Ubuntu's /usr/bin/chromium-browser is a small wrapper script that execs
    // the snap, so its realpath is not under /snap/. Real browsers are large
    // binaries; anything script-sized that mentions snap is the wrapper.
    if (statSync(candidate).size < 64 * 1024) {
      return /snap/i.test(readFileSync(candidate, 'latin1').slice(0, 4096));
    }
    return false;
  } catch {
    return candidate.startsWith('/snap/');
  }
}

const WINDOWS_LOCATIONS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function fromPath(name: string): string | null {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate) && !isSnapBinary(candidate)) return candidate;
  }
  return null;
}

/** Resolve a Chromium-family binary, or null when the host has none. */
export function resolveChromiumExecutable(explicit?: string | null): string | null {
  const configured = (explicit ?? process.env.OD_CHROMIUM_PATH ?? '').trim();
  if (configured) return existsSync(configured) ? configured : null;
  // A real deb Chrome wins over PATH, because PATH on Ubuntu may only hold the
  // snap wrapper.
  if (process.platform === 'linux') {
    for (const candidate of LINUX_LOCATIONS) {
      if (existsSync(candidate) && !isSnapBinary(candidate)) return candidate;
    }
  }
  for (const name of BINARY_NAMES) {
    const found = fromPath(name);
    if (found) return found;
  }
  if (process.platform === 'win32') {
    for (const candidate of WINDOWS_LOCATIONS) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function runChromium(
  executable: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(env ? { env } : {}),
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SnapshotRenderError('render_timeout',
        'Chromium did not finish the PDF within ' + timeoutMs + ' ms.'));
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new SnapshotRenderError('render_failed', error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(); return; }
      reject(new SnapshotRenderError('render_failed',
        'Chromium exited with code ' + code + ': ' + stderr.trim().slice(0, 400)));
    });
  });
}

/**
 * Render one HTML file to a PDF in a private temp directory.
 *
 * The caller owns `workDir` and must remove it (the daemon streams the file
 * then deletes it). Every failure is a SnapshotRenderError with a stable code,
 * so the API can answer 409/501 instead of a generic 500.
 */
export async function renderHtmlToPdf(
  htmlPath: string,
  options: ChromiumRenderOptions = {},
): Promise<RenderedPdf> {
  if (!existsSync(htmlPath)) {
    throw new SnapshotRenderError('source_missing', 'The artifact file does not exist.');
  }
  const executable = resolveChromiumExecutable(options.executable);
  if (!executable) {
    throw new SnapshotRenderError('chromium_missing',
      'No Chromium binary was found. Set OD_CHROMIUM_PATH to a headless Chrome/Chromium build.');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'od-snapshot-'));
  const pdfPath = join(workDir, 'snapshot.pdf');
  const profileDir = join(workDir, 'profile');
  // The Ubuntu snap build refuses to start without a private XDG runtime dir
  // owned by the service user: "cannot create XDG_RUNTIME_DIR folder
  // /run/user/998/snap.chromium". Giving each render its own 0700 directory
  // keeps snap-confined Chromium working under systemd.
  const xdgDir = join(workDir, 'xdg');
  await mkdir(xdgDir, { recursive: true, mode: 0o700 }).catch(() => {});
  // Render a copy that carries the print rules: a page the width of the design
  // (nothing clipped or scaled), no browser header/footer, and exact colours
  // (artifacts use gradients and dark surfaces). The <base> keeps relative
  // CSS/images/fonts resolving from the artifact's own directory.
  const pageWidth = options.pageWidth ?? 1200;
  const pageHeight = options.pageHeight ?? 1600;
  const printCss = '<style data-od-print>@page{size:' + pageWidth + 'px ' + pageHeight
    + 'px;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}'
    + '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style>';
  let sourceHtml = await readFile(htmlPath, 'utf8');
  const baseHref = pathToFileURL(dirname(htmlPath) + sep).href;
  const baseTag = '<base href="' + baseHref + '">';
  sourceHtml = sourceHtml.includes('</head>')
    ? sourceHtml.replace('</head>', baseTag + printCss + '</head>')
    : baseTag + printCss + sourceHtml;
  const printPath = join(workDir, 'print-' + randomUUID() + '.html');
  await writeFile(printPath, sourceHtml, 'utf8');

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--disable-extensions',
    '--user-data-dir=' + profileDir,
    // Local assets (CSS, images, fonts) sit next to the HTML file.
    '--allow-file-access-from-files',
    '--virtual-time-budget=5000',
    '--print-to-pdf=' + pdfPath,
    ...((options.noSandbox ?? process.env.OD_CHROMIUM_NO_SANDBOX === '1') ? ['--no-sandbox'] : []),
    pathToFileURL(printPath).href,
  ];

  try {
    const run = options.run ?? runChromium;
    const childEnv: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: xdgDir };
    await run(executable, args, options.timeoutMs ?? 60_000, childEnv);
    const info = await stat(pdfPath).catch(() => null);
    if (!info || info.size === 0) {
      throw new SnapshotRenderError('render_empty', 'Chromium produced an empty PDF.');
    }
    const handle = await open(pdfPath, 'r');
    try {
      const head = Buffer.alloc(5);
      await handle.read(head, 0, 5, 0);
      if (head.toString('latin1') !== '%PDF-') {
        throw new SnapshotRenderError('render_empty', 'Chromium produced a non-PDF file.');
      }
    } finally {
      await handle.close();
    }
    return { path: pdfPath, bytes: info.size, workDir };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof SnapshotRenderError) throw error;
    throw new SnapshotRenderError('render_failed',
      error instanceof Error ? error.message : 'Snapshot rendering failed.');
  }
}
