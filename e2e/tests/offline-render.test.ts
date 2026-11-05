import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

/**
 * T-D106 (NXD-D32) browser half: real Chromium renders of bundled examples with
 * every outbound request denied.
 *
 * `offline-content-assets.test.ts` proves the files on disk carry no public CDN
 * reference. That is necessary but not sufficient: a browser can still discover
 * a reference the scanner cannot see (CSS `@import`, runtime injection, a font
 * `url()`), and a broken `/vendor/*` surface would leave the page unstyled. This
 * spec closes HTML -> bytes -> browser: the shipped examples are served from
 * `apps/daemon/vendor` on a loopback origin, every request to any other origin
 * is aborted, and the assertions are the D32 runbook's pass conditions - no
 * request leaves the origin, the layout still paints, and the offline font map
 * is parsed from `/vendor/fonts@1.0.0/fonts.css`.
 *
 * Serving here is a plain static server on purpose: manifest allowlisting and
 * SHA-256 integrity are already pinned by the daemon vendor-routes tests, and
 * this spec must stay independent of daemon process lifecycle.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const VENDOR_DIR = path.join(repoRoot, 'apps', 'daemon', 'vendor');

const EXAMPLES = [
  {
    name: 'deck',
    file: path.join('design-templates', 'html-ppt-course-module', 'example.html'),
    expectsVendorFonts: true,
  },
  {
    name: 'prototype',
    file: path.join('design-templates', 'gamified-app', 'example.html'),
    expectsVendorFonts: true,
  },
  {
    name: 'dashboard with inlined avatars',
    file: path.join('design-templates', 'github-dashboard', 'example.html'),
    expectsVendorFonts: false,
  },
] as const;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/**
 * Prefer the pinned Playwright browser; fall back to the locally installed
 * Chrome when a developer machine has not downloaded the bundled headless shell.
 */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    try {
      return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      throw error;
    }
  }
}

let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (!requestPath.startsWith('/vendor/')) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const absolute = path.resolve(VENDOR_DIR, requestPath.slice('/vendor/'.length));
    if (absolute !== VENDOR_DIR && !absolute.startsWith(VENDOR_DIR + path.sep)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    try {
      const bytes = await readFile(absolute);
      res.setHeader('Content-Type', CONTENT_TYPES[path.extname(absolute)] ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.byteLength));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('vendor server did not bind');
  origin = 'http://127.0.0.1:' + address.port;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/**
 * `page.setContent` parses at about:blank, so root-absolute `/vendor/...` URLs
 * need an explicit base to resolve against the loopback origin.
 */
function withOriginBase(html: string): string {
  const base = '<base href="' + origin + '/">';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1>' + base) : base + html;
}

/**
 * True when the offline font map was parsed, whether the example links it
 * directly or pulls it in with a CSS `@import` (imported sheets are reachable
 * through CSSImportRule.styleSheet, not through `document.styleSheets`).
 * Self-contained so Playwright can serialize it into the page.
 */
function vendorFontSheetLoaded(): boolean {
  const seen = new Set<string>();
  const walk = (rules: CSSRuleList | undefined): void => {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      const imported = rule as CSSImportRule;
      if (typeof imported.href === 'string') seen.add(imported.href);
      if (imported.styleSheet) walk(imported.styleSheet.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) seen.add(sheet.href);
    try {
      walk(sheet.cssRules);
    } catch {
      // A cross-origin sheet hides its rules; nothing to inspect there.
    }
  }
  return Array.from(seen).some((href) => href.includes('/vendor/fonts@1.0.0/fonts.css'));
}

async function openExample(file: string, expectsVendorFonts: boolean) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const blocked: string[] = [];
  const pageErrors: string[] = [];

  await context.route('**/*', async (route) => {
    let parsed: URL;
    try {
      parsed = new URL(route.request().url());
    } catch {
      await route.abort('failed');
      return;
    }
    if (parsed.origin === origin || parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
      await route.continue();
      return;
    }
    blocked.push(parsed.href);
    await route.abort('internetdisconnected');
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const html = await readFile(path.join(repoRoot, file), 'utf8');
  await page.setContent(withOriginBase(html), { waitUntil: 'load' });
  // The font map arrives through a <link>/@import, which can settle after `load`.
  if (expectsVendorFonts) {
    await page.waitForFunction(vendorFontSheetLoaded, undefined, { timeout: 10_000 }).catch(() => undefined);
  }

  return { context, page, blocked, pageErrors };
}

describe('offline render', () => {
  for (const example of EXAMPLES) {
    test('renders the ' + example.name + ' example with no request leaving the origin', async () => {
      const opened = await openExample(example.file, example.expectsVendorFonts);
      try {
        expect(opened.blocked, 'no request may leave the origin').toEqual([]);
        expect(opened.pageErrors, 'the example must render without script errors').toEqual([]);

        const layout = await opened.page.evaluate(() => {
          const body = document.body;
          const visible = Array.from(body.querySelectorAll('h1, h2, h3, section, main, div')).some(
            (element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 40 && rect.height > 20;
            },
          );
          return {
            visible,
            textLength: body.innerText.trim().length,
            scrollHeight: body.scrollHeight,
          };
        });

        expect(layout.visible, 'the painted layout must have a visible block').toBe(true);
        expect(layout.textLength, 'the example must render readable content').toBeGreaterThan(0);
        expect(layout.scrollHeight, 'the page must have a non-trivial height').toBeGreaterThan(100);

        if (example.expectsVendorFonts) {
          const vendorFontSheet = await opened.page.evaluate(vendorFontSheetLoaded);
          expect(vendorFontSheet, 'the offline font map must load from /vendor').toBe(true);
        }
      } finally {
        await opened.context.close();
      }
    }, 60_000);
  }

  test('keeps a bundled example readable when /vendor is unavailable', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    await context.route('**/vendor/**', (route) => route.abort('failed'));
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const html = await readFile(path.join(repoRoot, EXAMPLES[1].file), 'utf8');
      await page.setContent(withOriginBase(html), { waitUntil: 'load' });

      expect(pageErrors, 'a missing vendor asset must not break the page').toEqual([]);
      const layout = await page.evaluate(() => ({
        textLength: document.body.innerText.trim().length,
        scrollHeight: document.body.scrollHeight,
      }));

      // Runbook fallback check: losing /vendor costs the embedded font map, not
      // the content. Shipped CSS plus local() families keep painting.
      expect(layout.textLength).toBeGreaterThan(0);
      expect(layout.scrollHeight).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  }, 60_000);
});
