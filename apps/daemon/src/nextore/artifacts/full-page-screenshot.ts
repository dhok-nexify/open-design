import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { SnapshotRenderError, resolveChromiumExecutable } from './snapshot-renderer.js';

/**
 * Full-page PNG for `Export > Export as image`.
 *
 * A headless daemon has no compositor, so the web client used to fall back to
 * capturing the visible preview pane - one screen. Chrome's own screenshot mode
 * also captures only the window unless it is told the document height, so this
 * drives the DevTools protocol directly: navigate, read the layout metrics, then
 * capture beyond the viewport. Node 24 ships a WebSocket client, so no
 * puppeteer dependency is needed.
 */

export type FullPageImageFormat = 'png' | 'jpeg' | 'webp';

export interface FullPageScreenshotOptions {
  executable?: string | null;
  /** Output format; CDP renders all three natively. */
  format?: FullPageImageFormat;
  /** JPEG/WebP quality (0-100). */
  quality?: number;
  width?: number;
  /** Extra CSS is appended before capture (print rules, exact colours). */
  css?: string;
  timeoutMs?: number;
}

export interface FullPageScreenshot {
  path: string;
  bytes: number;
  width: number;
  height: number;
  format: FullPageImageFormat;
  workDir: string;
}

interface CdpReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

async function launchDevtools(executable: string, profileDir: string, timeoutMs: number): Promise<{
  wsUrl: string;
  stop: () => void;
}> {
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profileDir,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  return await new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new SnapshotRenderError('render_timeout', 'Chrome did not expose a DevTools endpoint in time.'));
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ wsUrl: match[1]!, stop: () => { try { child.kill('SIGKILL'); } catch { /* gone */ } } });
      }
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SnapshotRenderError('render_failed', error.message));
    });
  });
}

function cdpClient(wsUrl: string, timeoutMs: number) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: CdpReply) => void; reject: (error: Error) => void }>();

  socket.addEventListener('message', (event) => {
    let reply: CdpReply;
    try {
      reply = JSON.parse(String((event as MessageEvent).data)) as CdpReply;
    } catch {
      return;
    }
    if (typeof reply.id !== 'number') return;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.error) entry.reject(new Error(reply.error.message ?? 'CDP error'));
    else entry.resolve(reply);
  });

  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP socket timeout')), timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP socket failed')); }, { once: true });
  });

  const send = async (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<CdpReply> => {
    const id = nextId++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    const result = new Promise<CdpReply>((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify(payload));
    return result;
  };

  return { opened, send, close: () => socket.close() };
}

export async function captureFullPageImage(
  htmlPath: string,
  options: FullPageScreenshotOptions = {},
): Promise<FullPageScreenshot> {
  if (!existsSync(htmlPath)) {
    throw new SnapshotRenderError('source_missing', 'The artifact file does not exist.');
  }
  const executable = resolveChromiumExecutable(options.executable);
  if (!executable) {
    throw new SnapshotRenderError('chromium_missing',
      'No Chromium binary was found. Set OD_CHROMIUM_PATH to a headless Chrome/Chromium build.');
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const width = options.width ?? 1200;
  const format: FullPageImageFormat = options.format ?? 'png';
  const quality = Math.min(100, Math.max(1, options.quality ?? 90));
  const workDir = await mkdtemp(join(tmpdir(), 'od-shot-'));
  const profileDir = join(workDir, 'profile');
  const extension = format === 'jpeg' ? 'jpg' : format;
  const imagePath = join(workDir, 'page.' + extension);
  await mkdir(profileDir, { recursive: true });

  let stop = () => {};
  try {
    const devtools = await launchDevtools(executable, profileDir, Math.min(timeoutMs, 20_000));
    stop = devtools.stop;
    const client = cdpClient(devtools.wsUrl, Math.min(timeoutMs, 20_000));
    await client.opened;
    try {
      const created = await client.send('Target.createTarget', { url: 'about:blank' });
      const targetId = String((created.result as { targetId?: unknown })?.targetId ?? '');
      const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
      const sessionId = String((attached.result as { sessionId?: unknown })?.sessionId ?? '');
      await client.send('Page.enable', {}, sessionId);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: false,
      }, sessionId);
      await client.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
      // Give fonts, images and the artifact's own scripts time to settle.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      if (options.css) {
        await client.send('Runtime.evaluate', {
          expression: '(() => { const s = document.createElement("style"); s.textContent = '
            + JSON.stringify(options.css)
            + '; document.head.appendChild(s); })()',
        }, sessionId);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const metrics = await client.send('Page.getLayoutMetrics', {}, sessionId);
      const size = (metrics.result as { cssContentSize?: { width?: number; height?: number } })?.cssContentSize;
      const height = Math.max(1, Math.ceil(size?.height ?? 900));
      const shot = await client.send('Page.captureScreenshot', {
        format,
        ...(format === 'png' ? {} : { quality }),
        captureBeyondViewport: true,
        optimizeForSpeed: false,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }, sessionId);
      const data = String((shot.result as { data?: unknown })?.data ?? '');
      if (!data) throw new SnapshotRenderError('render_empty', 'Chrome returned an empty screenshot.');
      const buffer = Buffer.from(data, 'base64');
      if (buffer.length === 0) throw new SnapshotRenderError('render_empty', 'Chrome returned an empty screenshot.');
      await writeFile(imagePath, buffer);
      const check = await readFile(imagePath);
      const magic = format === 'png'
        ? check.length > 8 && check[0] === 0x89 && check[1] === 0x50 && check[2] === 0x4e
        : format === 'jpeg'
          ? check.length > 3 && check[0] === 0xff && check[1] === 0xd8 && check[2] === 0xff
          : check.length > 12 && check.toString('latin1', 0, 4) === 'RIFF'
            && check.toString('latin1', 8, 12) === 'WEBP';
      if (!magic) throw new SnapshotRenderError('render_empty', 'Chrome did not produce a ' + format + ' image.');
      return { path: imagePath, bytes: buffer.length, width, height, format, workDir };
    } finally {
      client.close();
    }
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof SnapshotRenderError) throw error;
    throw new SnapshotRenderError('render_failed',
      error instanceof Error ? error.message : 'Full-page capture failed.');
  } finally {
    stop();
  }
}
