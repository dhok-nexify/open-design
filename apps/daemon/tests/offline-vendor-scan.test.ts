import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { composeSystemPrompt } from '@open-design/contracts';
import { describe, expect, it } from 'vitest';

import { findVendorAsset } from '../src/vendor/manifest.js';

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const CDN_PATTERN =
  /https?:\/\/(?:unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/i;

function htmlFilesUnder(dir: string): string[] {
  const root = path.join(REPO_ROOT, dir);
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.html'))
    .map((entry) => path.join(root, entry));
}

describe('offline vendor scan (T-D106, module side)', () => {
  const files = [...htmlFilesUnder('skills'), ...htmlFilesUnder('design-templates')];

  it('ships skills and design-template examples with no external CDN reference', () => {
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      if (CDN_PATTERN.test(readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every /vendor URL an example references is in the manifest', () => {
    const missing = new Set<string>();
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(/\/vendor\/([^"'()\s?#]+)/g)) {
        const relativePath = match[1] ?? '';
        if (!findVendorAsset(relativePath)) missing.add(relativePath);
      }
    }

    expect([...missing]).toEqual([]);
  });

  it('the composed NexTore prompt contains no external CDN URL', () => {
    const prompt = composeSystemPrompt({ edition: 'nextore' });

    expect(prompt).toContain('/vendor/react@18.3.1/umd/react.development.js');
    expect(prompt).toContain('## Offline runtime assets');
    expect(prompt).toContain('## Offline fonts');
    expect(prompt).not.toMatch(CDN_PATTERN);
  });
});
